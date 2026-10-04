/**
 * Low-level HTTP transport: URL + query building, bearer auth, timeout via
 * AbortController, JSON envelope unwrapping, typed error mapping, and bounded
 * retries with exponential backoff + `Retry-After` honouring.
 *
 * Uses the global `fetch` (Node 18+, Bun, Deno, browsers). A custom `fetch`
 * may be injected via client options for older runtimes or testing.
 */
import {
  LifeAstroConnectionError,
  errorFromResponse,
  type LifeAstroError,
} from "./errors.js";
import type { QueryParams, ResponseEnvelope } from "./types.js";

export type FetchLike = (
  input: string,
  init?: RequestInit,
) => Promise<Response>;

export interface ResolvedConfig {
  apiKey: string;
  baseUrl: string;
  timeoutMs: number;
  maxRetries: number;
  fetch: FetchLike;
  userAgent: string;
  defaultHeaders: Record<string, string>;
}

export interface RequestOptions {
  /** Per-call abort signal (in addition to the timeout). */
  signal?: AbortSignal;
  /** Override the client timeout for this call. */
  timeoutMs?: number;
  /** Return the response body exactly as received, without unwrapping a `{ data, meta }` envelope if one is present. */
  raw?: boolean;
}

const RETRYABLE_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);

/** Encode query params, skipping empty values, into a stable query string. */
export function encodeQuery(params: QueryParams): string {
  const usp = new URLSearchParams();
  for (const key of Object.keys(params).sort()) {
    const value = params[key];
    if (value === undefined || value === null || value === "") continue;
    usp.append(key, String(value));
  }
  const s = usp.toString();
  return s ? `?${s}` : "";
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new LifeAstroConnectionError("Request aborted", { code: "aborted" }));
      return;
    }
    // Remove the abort listener on BOTH paths — `{ once: true }` only auto-removes
    // after the listener fires, so a normally-completing sleep would otherwise leak
    // a listener on a long-lived caller signal (MaxListenersExceededWarning).
    const onAbort = () => {
      clearTimeout(t);
      reject(new LifeAstroConnectionError("Request aborted", { code: "aborted" }));
    };
    const t = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

function backoffMs(attempt: number, retryAfter?: number): number {
  if (retryAfter !== undefined && Number.isFinite(retryAfter)) {
    return Math.min(retryAfter * 1000, 30_000);
  }
  const base = Math.min(500 * 2 ** attempt, 8_000);
  return base + Math.floor(Math.random() * 250); // jitter
}

function parseRetryAfter(res: Response): number | undefined {
  const h = res.headers.get("retry-after");
  if (!h) return undefined;
  const secs = Number(h);
  if (Number.isFinite(secs)) return Math.max(0, secs);
  // RFC 7231 also permits an HTTP-date form (e.g. "Wed, 21 Oct 2025 07:28:00 GMT").
  const at = Date.parse(h);
  if (!Number.isNaN(at)) return Math.max(0, (at - Date.now()) / 1000);
  return undefined;
}

/**
 * Build request headers. The bearer token is header-only (never in the URL or
 * logs). `User-Agent` is set only on Node — browsers and Web Workers forbid it
 * (fetch throws or silently drops it). `defaultHeaders` are applied last so a
 * caller can override anything, including Authorization.
 */
function buildHeaders(config: ResolvedConfig): Record<string, string> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${config.apiKey}`,
    Accept: "application/json",
  };
  if (typeof process !== "undefined" && process.versions?.node) {
    headers["User-Agent"] = config.userAgent;
  }
  Object.assign(headers, config.defaultHeaders);
  return headers;
}

/**
 * Perform a GET against the API and return the unwrapped `data` (or the full
 * envelope when `opts.raw` is set). Throws a {@link LifeAstroError} subclass on
 * any non-2xx response and {@link LifeAstroConnectionError} on transport/timeout.
 */
export async function performRequest<T>(
  config: ResolvedConfig,
  path: string,
  query: QueryParams,
  opts: RequestOptions = {},
): Promise<T> {
  const url = config.baseUrl + (path.startsWith("/") ? path : `/${path}`) + encodeQuery(query);
  const timeoutMs = opts.timeoutMs ?? config.timeoutMs;

  let lastError: LifeAstroError | undefined;

  for (let attempt = 0; attempt <= config.maxRetries; attempt++) {
    const controller = new AbortController();
    const onAbort = () => controller.abort();
    if (opts.signal) {
      if (opts.signal.aborted) onAbort();
      else opts.signal.addEventListener("abort", onAbort, { once: true });
    }
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    let res: Response;
    let text: string;
    try {
      res = await config.fetch(url, {
        method: "GET",
        headers: buildHeaders(config),
        signal: controller.signal,
      });
      // Read the body INSIDE the timeout window, so a slow/large body download
      // is bounded by `timeoutMs` too — not just the connection + headers.
      text = await res.text();
    } catch (cause) {
      // Distinguish a user/timeout abort from a genuine network error.
      const aborted = (cause as { name?: string })?.name === "AbortError";
      if (aborted && opts.signal?.aborted) {
        throw new LifeAstroConnectionError("Request aborted by caller", { cause, code: "aborted" });
      }
      lastError = new LifeAstroConnectionError(
        aborted ? `Request timed out after ${timeoutMs}ms` : "Network request failed",
        { cause, code: aborted ? "timeout" : "connection_error" },
      );
      if (attempt < config.maxRetries) {
        await sleep(backoffMs(attempt), opts.signal);
        continue;
      }
      throw lastError;
    } finally {
      clearTimeout(timer);
      opts.signal?.removeEventListener("abort", onAbort);
    }

    let body: unknown;
    try {
      body = text ? JSON.parse(text) : undefined;
    } catch {
      body = text;
    }

    if (res.ok) {
      if (opts.raw) return body as T;
      const envelope = body as ResponseEnvelope<T> | undefined;
      // The API returns bare JSON today. A { data, meta } envelope is unwrapped
      // if a response ever carries one, so adding it server-side is not breaking.
      if (envelope && typeof envelope === "object" && "data" in envelope) {
        return envelope.data;
      }
      return body as T;
    }

    const retryAfter = parseRetryAfter(res);
    lastError = errorFromResponse(res.status, body, retryAfter);
    if (RETRYABLE_STATUS.has(res.status) && attempt < config.maxRetries) {
      await sleep(backoffMs(attempt, retryAfter), opts.signal);
      continue;
    }
    throw lastError;
  }

  // Exhausted retries.
  throw lastError ?? new LifeAstroConnectionError("Request failed after retries");
}
