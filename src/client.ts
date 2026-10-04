/**
 * The LifeAstro client: configuration, the core request method used by every
 * resource namespace, and a generic escape hatch (`request` / `get`) for
 * endpoints not yet covered by a typed method.
 */
import {
  performRequest,
  type FetchLike,
  type RequestOptions,
  type ResolvedConfig,
} from "./http.js";
import type { QueryParams } from "./types.js";
import { Resources } from "./resources/index.js";

/** SDK version, surfaced in the User-Agent header. */
export const VERSION = "0.2.0";

const DEFAULT_BASE_URL = "https://api.lifeastroapi.com";

export interface LifeAstroOptions {
  /**
   * API key (`dv_live_...`). Falls back to the `LIFEASTRO_API_KEY` environment
   * variable when omitted. Get one at https://lifeastroapi.com/dashboard/keys
   */
  apiKey?: string;
  /** Override the API base URL (e.g. `http://localhost:8080` for local dev). */
  baseUrl?: string;
  /** Per-request timeout in milliseconds. Default 30000. */
  timeoutMs?: number;
  /** Max automatic retries on 429/5xx/network errors. Default 2. */
  maxRetries?: number;
  /** Inject a custom `fetch` implementation (older runtimes, tests, proxies). */
  fetch?: FetchLike;
  /** Extra headers sent on every request. */
  defaultHeaders?: Record<string, string>;
}

/** The minimal surface a resource namespace needs from the client. @internal */
export interface ClientCore {
  request<T = unknown>(path: string, query: QueryParams, opts?: RequestOptions): Promise<T>;
}

function resolveConfig(options: LifeAstroOptions | string): ResolvedConfig {
  const opts: LifeAstroOptions = typeof options === "string" ? { apiKey: options } : (options ?? {});
  const envKey =
    typeof process !== "undefined" ? process.env?.LIFEASTRO_API_KEY : undefined;
  const apiKey = opts.apiKey ?? envKey;
  if (!apiKey) {
    throw new Error(
      "LifeAstro: an API key is required. Pass { apiKey } or set LIFEASTRO_API_KEY. " +
        "Get one at https://lifeastroapi.com/dashboard/keys",
    );
  }

  const fetchImpl = opts.fetch ?? (globalThis.fetch as FetchLike | undefined);
  if (!fetchImpl) {
    throw new Error(
      "LifeAstro: no global `fetch` available. Use Node 18+ or pass a `fetch` implementation.",
    );
  }

  return {
    apiKey,
    baseUrl: (opts.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, ""),
    timeoutMs: opts.timeoutMs ?? 30_000,
    maxRetries: Math.max(0, opts.maxRetries ?? 2),
    fetch: fetchImpl,
    userAgent: `lifeastroapi-node/${VERSION}`,
    defaultHeaders: opts.defaultHeaders ?? {},
  };
}

/**
 * The LifeAstroAPI client.
 *
 * @example
 * ```ts
 * import { LifeAstro } from "lifeastroapi";
 *
 * const client = new LifeAstro({ apiKey: "dv_live_..." });
 *
 * const tithi = await client.panchang.tithi({
 *   lat: 28.6139, lon: 77.209, tz: "Asia/Kolkata",
 * });
 *
 * const planets = await client.chart.planets({
 *   date: "1990-01-15", time: "10:30", tz: "Asia/Kolkata",
 *   lat: 19.076, lon: 72.8777,
 * });
 * ```
 */
export class LifeAstro extends Resources implements ClientCore {
  readonly #config: ResolvedConfig;

  constructor(options: LifeAstroOptions | string = {}) {
    const config = resolveConfig(options);
    // Build the core before `super()` — it only closes over `config`, not `this`.
    const core: ClientCore = {
      request: (path, query, opts) => performRequest(config, path, query, opts),
    };
    super(core);
    this.#config = config;
  }

  /**
   * Generic escape hatch: call any `/v1/*` endpoint directly. Returns the
   * response payload.
   *
   * @example
   * ```ts
   * const data = await client.request("/v1/panchang/tithi", {
   *   lat: 28.61, lon: 77.20, tz: "Asia/Kolkata",
   * });
   * ```
   */
  request<T = unknown>(path: string, query: QueryParams = {}, opts?: RequestOptions): Promise<T> {
    return performRequest<T>(this.#config, path, query, opts);
  }

  /** Alias for {@link LifeAstro.request}. */
  get<T = unknown>(path: string, query: QueryParams = {}, opts?: RequestOptions): Promise<T> {
    return this.request<T>(path, query, opts);
  }
}
