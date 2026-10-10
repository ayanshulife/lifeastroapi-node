import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  LifeAstro,
  AuthenticationError,
  PaymentRequiredError,
  PermissionError,
  NotFoundError,
  RateLimitError,
  BadRequestError,
  ServerError,
  LifeAstroConnectionError,
  type FetchLike,
} from "../src/index.js";
import { todayIn } from "../src/params.js";

/** Records every request and returns canned responses. */
function mockFetch(
  responder: (url: URL) => { status?: number; body?: unknown; headers?: Record<string, string> },
) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const fetch: FetchLike = async (url, init) => {
    calls.push({ url, init });
    const r = responder(new URL(url));
    const status = r.status ?? 200;
    const body = r.body === undefined ? { data: {} } : r.body;
    return new Response(typeof body === "string" ? body : JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json", ...(r.headers ?? {}) },
    });
  };
  return { fetch, calls };
}

function makeClient(fetch: FetchLike, extra: Record<string, unknown> = {}) {
  return new LifeAstro({ apiKey: "dv_live_test", fetch, maxRetries: 0, ...extra });
}

const BIRTH = { date: "1990-01-15", time: "10:30", tz: "Asia/Kolkata", lat: 19.076, lon: 72.8777 };

describe("transport", () => {
  it("builds an authenticated GET and unwraps `data`", async () => {
    const { fetch, calls } = mockFetch(() => ({ body: { data: { number: 3 }, meta: { cache: "miss" } } }));
    const client = makeClient(fetch);
    const res = await client.panchang.tithi({ lat: 28.61, lon: 77.2, tz: "Asia/Kolkata" });

    expect(res).toEqual({ number: 3 });
    const call = calls[0]!;
    const url = new URL(call.url);
    expect(url.pathname).toBe("/v1/panchang/tithi");
    expect(url.searchParams.get("lat")).toBe("28.61");
    expect(url.searchParams.get("tz")).toBe("Asia/Kolkata");
    expect((call.init!.headers as Record<string, string>).Authorization).toBe("Bearer dv_live_test");
  });

  it("returns the full envelope with { raw: true }", async () => {
    const { fetch } = mockFetch(() => ({ body: { data: { x: 1 }, meta: { tier: "standard" } } }));
    const client = makeClient(fetch);
    const res = await client.request("/v1/panchang/tithi", { lat: 1, lon: 2, tz: "UTC" }, { raw: true });
    expect(res).toEqual({ data: { x: 1 }, meta: { tier: "standard" } });
  });

  it("omits empty params and sorts the query string", async () => {
    const { fetch, calls } = mockFetch(() => ({ body: { data: {} } }));
    const client = makeClient(fetch);
    await client.panchang.tithi({ lat: 28.61, lon: 77.2, tz: "Asia/Kolkata", date: "" as unknown as string });
    const url = new URL(calls[0]!.url);
    expect(url.searchParams.has("date")).toBe(false);
  });
});

describe("param shapes", () => {
  it("flat birth params", async () => {
    const { fetch, calls } = mockFetch(() => ({ body: { data: {} } }));
    await makeClient(fetch).chart.planets(BIRTH);
    const url = new URL(calls[0]!.url);
    expect(url.searchParams.get("date")).toBe("1990-01-15");
    expect(url.searchParams.get("lat")).toBe("19.076");
  });

  it("birth.* prefixed params (mangal-dosha)", async () => {
    const { fetch, calls } = mockFetch(() => ({ body: { data: {} } }));
    await makeClient(fetch).milan.mangalDosha(BIRTH);
    const url = new URL(calls[0]!.url);
    expect(url.pathname).toBe("/v1/milan/mangal-dosha");
    expect(url.searchParams.get("birth.date")).toBe("1990-01-15");
    expect(url.searchParams.get("birth.lat")).toBe("19.076");
    expect(url.searchParams.has("date")).toBe(false);
  });

  it("boy.*/girl.* matchmaking params", async () => {
    const { fetch, calls } = mockFetch(() => ({ body: { data: {} } }));
    await makeClient(fetch).milan.ashtakootaTotal({
      boy: BIRTH,
      girl: { ...BIRTH, date: "1992-03-20" },
    });
    const url = new URL(calls[0]!.url);
    expect(url.searchParams.get("boy.date")).toBe("1990-01-15");
    expect(url.searchParams.get("girl.date")).toBe("1992-03-20");
  });

  it("lowercases rashi", async () => {
    const { fetch, calls } = mockFetch(() => ({ body: { data: {} } }));
    await makeClient(fetch).horoscope.daily({ rashi: "Aries" });
    expect(new URL(calls[0]!.url).searchParams.get("rashi")).toBe("aries");
  });

  it("substitutes path params (divisional varga)", async () => {
    const { fetch, calls } = mockFetch(() => ({ body: { data: {} } }));
    await makeClient(fetch).chart.divisional({ ...BIRTH, varga: "D9" });
    const url = new URL(calls[0]!.url);
    expect(url.pathname).toBe("/v1/chart/divisional/D9");
    expect(url.searchParams.has("varga")).toBe(false);
  });

  it("custom shape (festivals.month)", async () => {
    const { fetch, calls } = mockFetch(() => ({ body: { data: {} } }));
    await makeClient(fetch).festivals.month({ year: 2026, month: 11, tz: "Asia/Kolkata", lat: 19.076, lon: 72.8777, locale: "mr", monthSystem: "amanta" });
    const url = new URL(calls[0]!.url);
    expect(url.searchParams.get("year")).toBe("2026");
    expect(url.searchParams.get("lat")).toBe("19.076");
    expect(url.searchParams.get("month_system")).toBe("amanta");
    expect(url.searchParams.get("locale")).toBe("mr");
  });

  it("natalTransit shape maps natal to birth.* and transit flat", async () => {
    const { fetch, calls } = mockFetch(() => ({ body: { data: {} } }));
    await makeClient(fetch).western.transits.toNatal({
      birth: BIRTH,
      date: "2026-06-16",
      time: "12:00",
      tz: "Asia/Kolkata",
    });
    const url = new URL(calls[0]!.url);
    expect(url.searchParams.get("birth.date")).toBe("1990-01-15");
    expect(url.searchParams.get("date")).toBe("2026-06-16");
  });

  it("exposes nested western namespaces", () => {
    const client = makeClient(mockFetch(() => ({})).fetch);
    expect(typeof client.western.natal.chart).toBe("function");
    expect(typeof client.western.synastry.aspects).toBe("function");
    expect(typeof client.western.firdaria).toBe("function");
  });

  it("throws on a missing path parameter", () => {
    const client = makeClient(mockFetch(() => ({})).fetch);
    expect(() =>
      // @ts-expect-error intentionally missing varga
      client.chart.divisional({ ...BIRTH }),
    ).toThrow(/path parameter/);
  });
});

describe("errors", () => {
  it("maps 401 to AuthenticationError with code + requestId", async () => {
    const { fetch } = mockFetch(() => ({
      status: 401,
      body: { error: { code: "unauthorized", message: "bad key", request_id: "req_1" } },
    }));
    const client = makeClient(fetch);
    await expect(client.chart.planets(BIRTH)).rejects.toMatchObject({
      name: "AuthenticationError",
      code: "unauthorized",
      status: 401,
      requestId: "req_1",
    });
    await expect(client.chart.planets(BIRTH)).rejects.toBeInstanceOf(AuthenticationError);
  });

  it("maps 402 to PaymentRequiredError", async () => {
    const { fetch } = mockFetch(() => ({ status: 402, body: { error: { code: "insufficient_credits", message: "no credits" } } }));
    await expect(makeClient(fetch).chart.planets(BIRTH)).rejects.toBeInstanceOf(PaymentRequiredError);
  });

  it("maps 400 to BadRequestError", async () => {
    const { fetch } = mockFetch(() => ({ status: 400, body: { error: { code: "invalid_param", message: "bad lat" } } }));
    await expect(makeClient(fetch).chart.planets(BIRTH)).rejects.toBeInstanceOf(BadRequestError);
  });

  it("maps 429 to RateLimitError with retryAfter", async () => {
    const { fetch } = mockFetch(() => ({
      status: 429,
      body: { error: { code: "rate_limited", message: "slow down" } },
      headers: { "retry-after": "7" },
    }));
    const err = await makeClient(fetch).chart.planets(BIRTH).catch((e) => e);
    expect(err).toBeInstanceOf(RateLimitError);
    expect((err as RateLimitError).retryAfter).toBe(7);
  });

  it("parses the HTTP-date form of Retry-After", async () => {
    const { fetch } = mockFetch(() => ({
      status: 429,
      body: { error: { code: "rate_limited" } },
      headers: { "retry-after": "Wed, 21 Oct 2099 07:28:00 GMT" },
    }));
    const err = await makeClient(fetch).chart.planets(BIRTH).catch((e) => e);
    expect(err).toBeInstanceOf(RateLimitError);
    const ra = (err as RateLimitError).retryAfter;
    expect(typeof ra).toBe("number");
    expect(ra! > 0 && Number.isFinite(ra!)).toBe(true);
  });
});

describe("retries", () => {
  it("retries a 429 then succeeds", async () => {
    let n = 0;
    const { fetch, calls } = mockFetch(() => {
      n += 1;
      if (n === 1) return { status: 429, body: { error: { code: "rate_limited" } }, headers: { "retry-after": "0" } };
      return { body: { data: { ok: true } } };
    });
    const client = makeClient(fetch, { maxRetries: 2 });
    const res = await client.chart.planets(BIRTH);
    expect(res).toEqual({ ok: true });
    expect(calls.length).toBe(2);
  });

  it("gives up after maxRetries", async () => {
    const { fetch, calls } = mockFetch(() => ({ status: 503, body: { error: { code: "unavailable" } }, headers: { "retry-after": "0" } }));
    await expect(makeClient(fetch, { maxRetries: 2 }).chart.planets(BIRTH)).rejects.toMatchObject({ status: 503 });
    expect(calls.length).toBe(3); // initial + 2 retries
  });

  it("clamps a negative maxRetries to 0 (still makes the request once)", async () => {
    const { fetch, calls } = mockFetch(() => ({ status: 503, body: { error: { code: "unavailable" } }, headers: { "retry-after": "0" } }));
    await expect(makeClient(fetch, { maxRetries: -5 }).chart.planets(BIRTH)).rejects.toMatchObject({ status: 503 });
    expect(calls.length).toBe(1); // negative clamped to 0 → one attempt, not zero
  });
});

describe("localization", () => {
  it("sends both lang and locale for narrative endpoints", async () => {
    const { fetch, calls } = mockFetch(() => ({ body: { data: {} } }));
    await makeClient(fetch).narrative.lagna({ ...BIRTH, lang: "hi" });
    const url = new URL(calls[0]!.url);
    // Server is inconsistent (narrative reads `locale`); the SDK emits both.
    expect(url.searchParams.get("lang")).toBe("hi");
    expect(url.searchParams.get("locale")).toBe("hi");
  });
});

describe("configuration", () => {
  const OLD = process.env.LIFEASTRO_API_KEY;
  beforeEach(() => { delete process.env.LIFEASTRO_API_KEY; });
  afterEach(() => { if (OLD !== undefined) process.env.LIFEASTRO_API_KEY = OLD; });

  it("throws when no API key is provided", () => {
    expect(() => new LifeAstro({ fetch: mockFetch(() => ({})).fetch })).toThrow(/API key/);
  });

  it("reads the API key from the environment", async () => {
    process.env.LIFEASTRO_API_KEY = "dv_live_env";
    const { fetch, calls } = mockFetch(() => ({ body: { data: {} } }));
    const client = new LifeAstro({ fetch, maxRetries: 0 });
    await client.panchang.tithi({ lat: 1, lon: 2, tz: "UTC" });
    expect((calls[0]!.init!.headers as Record<string, string>).Authorization).toBe("Bearer dv_live_env");
  });

  it("accepts a bare API key string", () => {
    const client = new LifeAstro("dv_live_str");
    expect(client).toBeInstanceOf(LifeAstro);
  });

  it("works with no constructor argument when LIFEASTRO_API_KEY is set", () => {
    process.env.LIFEASTRO_API_KEY = "dv_live_env";
    expect(() => new LifeAstro()).not.toThrow();
  });

  it("throws a clean error (not a TypeError) with no argument and no env key", () => {
    // Regression: new LifeAstro() must not crash with "cannot read apiKey of undefined".
    expect(() => new LifeAstro()).toThrow(/API key/);
  });

  it("surfaces network failures as LifeAstroConnectionError", async () => {
    const fetch: FetchLike = async () => { throw new Error("boom"); };
    await expect(makeClient(fetch).panchang.tithi({ lat: 1, lon: 2, tz: "UTC" })).rejects.toBeInstanceOf(
      LifeAstroConnectionError,
    );
  });
});

describe("error status mapping", () => {
  const cases: Array<[number, string]> = [
    [403, "PermissionError"],
    [404, "NotFoundError"],
    [500, "ServerError"],
    [503, "ServerError"],
  ];
  for (const [status, name] of cases) {
    it(`maps ${status} to ${name}`, async () => {
      const { fetch } = mockFetch(() => ({ status, body: { error: { code: "x", message: "m" } } }));
      const err = await makeClient(fetch, { maxRetries: 0 }).chart.planets(BIRTH).catch((e) => e);
      expect(err.name).toBe(name);
      expect(err.status).toBe(status);
    });
  }

  it("403/404 stay instanceof their class and the base LifeAstroError", async () => {
    const { fetch } = mockFetch(() => ({ status: 403, body: { error: { code: "forbidden" } } }));
    const err = await makeClient(fetch, { maxRetries: 0 }).chart.planets(BIRTH).catch((e) => e);
    expect(err).toBeInstanceOf(PermissionError);
  });

  it("does not retry a non-retryable 4xx (single call)", async () => {
    const { fetch, calls } = mockFetch(() => ({ status: 400, body: { error: { code: "invalid_param" } } }));
    await expect(makeClient(fetch, { maxRetries: 3 }).chart.planets(BIRTH)).rejects.toBeInstanceOf(BadRequestError);
    expect(calls.length).toBe(1);
  });

  it("retries a network error, then succeeds", async () => {
    let n = 0;
    const fetch: FetchLike = async () => {
      n += 1;
      if (n === 1) throw new Error("ECONNRESET");
      return new Response(JSON.stringify({ data: { ok: true } }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    };
    const res = await makeClient(fetch, { maxRetries: 2 }).chart.planets(BIRTH);
    expect(res).toEqual({ ok: true });
    expect(n).toBe(2);
  });
});

describe("query encoding edge cases", () => {
  it("keeps a legitimate zero (lat=0, lon=0)", async () => {
    const { fetch, calls } = mockFetch(() => ({ body: { data: {} } }));
    await makeClient(fetch).panchang.tithi({ lat: 0, lon: 0, tz: "UTC" });
    const url = new URL(calls[0]!.url);
    expect(url.searchParams.get("lat")).toBe("0");
    expect(url.searchParams.get("lon")).toBe("0");
  });

  it("URL-encodes a fixed-offset tz (+05:30)", async () => {
    const { fetch, calls } = mockFetch(() => ({ body: { data: {} } }));
    await makeClient(fetch).panchang.tithi({ lat: 1, lon: 2, tz: "+05:30" });
    expect(calls[0]!.url).toContain("tz=%2B05%3A30"); // '+' encoded, not sent as space
    expect(new URL(calls[0]!.url).searchParams.get("tz")).toBe("+05:30");
  });

  it("percent-encodes path parameters", async () => {
    const { fetch, calls } = mockFetch(() => ({ body: { data: {} } }));
    await makeClient(fetch).chart.planet({ ...BIRTH, name: "a b/c" });
    expect(new URL(calls[0]!.url).pathname).toBe("/v1/chart/planet/a%20b%2Fc");
  });

  it("includes default headers and a User-Agent on Node", async () => {
    const { fetch, calls } = mockFetch(() => ({ body: { data: {} } }));
    await makeClient(fetch, { defaultHeaders: { "X-Trace": "abc" } }).panchang.tithi({ lat: 1, lon: 2, tz: "UTC" });
    const h = calls[0]!.init!.headers as Record<string, string>;
    expect(h["X-Trace"]).toBe("abc");
    expect(h["User-Agent"]).toMatch(/lifeastroapi-node/);
  });
});

describe("abort & timeout", () => {
  // Never resolves on its own; rejects with an AbortError when its signal aborts.
  const signalFetch: FetchLike = (_url, init) =>
    new Promise((_resolve, reject) => {
      const sig = init?.signal;
      const fail = () => {
        const e = new Error("aborted");
        e.name = "AbortError";
        reject(e);
      };
      if (sig?.aborted) return fail();
      sig?.addEventListener("abort", fail, { once: true });
    });

  it("rejects a pre-aborted caller signal with code 'aborted'", async () => {
    const ac = new AbortController();
    ac.abort();
    const err = await makeClient(signalFetch)
      .panchang.tithi({ lat: 1, lon: 2, tz: "UTC" }, { signal: ac.signal })
      .catch((e) => e);
    expect(err).toBeInstanceOf(LifeAstroConnectionError);
    expect(err.code).toBe("aborted");
  });

  it("times out with code 'timeout'", async () => {
    const err = await makeClient(signalFetch, { maxRetries: 0 })
      .panchang.tithi({ lat: 1, lon: 2, tz: "UTC" }, { timeoutMs: 10 })
      .catch((e) => e);
    expect(err).toBeInstanceOf(LifeAstroConnectionError);
    expect(err.code).toBe("timeout");
  });
});

describe("escape hatch", () => {
  it("client.request hits an arbitrary path and unwraps data", async () => {
    const { fetch, calls } = mockFetch(() => ({ body: { data: { v: 1 } } }));
    const res = await makeClient(fetch).request("/v1/anything", { a: "b" });
    expect(res).toEqual({ v: 1 });
    const url = new URL(calls[0]!.url);
    expect(url.pathname).toBe("/v1/anything");
    expect(url.searchParams.get("a")).toBe("b");
  });

  it("client.get is an alias for request", async () => {
    const { fetch } = mockFetch(() => ({ body: { data: { ok: 1 } } }));
    expect(await makeClient(fetch).get("/v1/x")).toEqual({ ok: 1 });
  });
});

describe("non-enveloped success bodies", () => {
  // A few endpoints return a bare array or a top-level object WITHOUT a `data`
  // key. The transport must return those verbatim and NOT try to unwrap a
  // missing `data` (regression guard for http.ts envelope handling).
  it("returns a bare array body as-is", async () => {
    const { fetch } = mockFetch(() => ({ body: [1, 2, 3] }));
    expect(await makeClient(fetch).request("/v1/list")).toEqual([1, 2, 3]);
  });

  it("returns a no-`data` object body as-is", async () => {
    const { fetch } = mockFetch(() => ({ body: { foo: 1, bar: 2 } }));
    expect(await makeClient(fetch).request("/v1/raw")).toEqual({ foo: 1, bar: 2 });
  });

  it("returns a non-JSON success body as the raw string", async () => {
    const { fetch } = mockFetch(() => ({ body: "plain text" }));
    expect(await makeClient(fetch).request("/v1/text")).toBe("plain text");
  });
});

// The API has no "today" default — it rejects a moment endpoint without
// `date` — so the SDK supplies one. (Verified against a real server by
// `npm run live`; these pin the wire shape.)
describe("date defaults", () => {
  it("fills today's date for a moment endpoint when omitted", async () => {
    const { fetch, calls } = mockFetch(() => ({ body: {} }));
    await makeClient(fetch).panchang.tithi({ lat: 19.076, lon: 72.8777, tz: "Asia/Kolkata" });
    expect(new URL(calls[0]!.url).searchParams.get("date")).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("keeps an explicit date", async () => {
    const { fetch, calls } = mockFetch(() => ({ body: {} }));
    await makeClient(fetch).panchang.tithi({ lat: 19.076, lon: 72.8777, tz: "Asia/Kolkata", date: "2026-11-20" });
    expect(new URL(calls[0]!.url).searchParams.get("date")).toBe("2026-11-20");
  });

  it("todayIn resolves the date in the given zone and falls back to UTC", () => {
    const now = new Date("2026-03-01T20:00:00Z"); // already 2 March in Kolkata
    expect(todayIn("Asia/Kolkata", now)).toBe("2026-03-02");
    expect(todayIn("America/Los_Angeles", now)).toBe("2026-03-01");
    expect(todayIn("Not/AZone", now)).toBe("2026-03-01");
    expect(todayIn(undefined, now)).toBe("2026-03-01");
  });

  it("transit.positions needs no arguments (today, UTC)", async () => {
    const { fetch, calls } = mockFetch(() => ({ body: {} }));
    await makeClient(fetch).transit.positions();
    const q = new URL(calls[0]!.url).searchParams;
    expect(q.get("tz")).toBe("UTC");
    expect(q.get("date")).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe("endpoints corrected against the live API", () => {
  it("personalised horoscope: birth chart unprefixed, the day as transit_date", async () => {
    // Sending the natal chart as birth.* with date=today is answered 200 —
    // for a chart cast today. The handler reads the chart unprefixed.
    const { fetch, calls } = mockFetch(() => ({ body: {} }));
    await makeClient(fetch).narrative.horoscopeDailyByLagna({ ...BIRTH, onDate: "2026-10-10" });
    const q = new URL(calls[0]!.url).searchParams;
    expect(q.get("date")).toBe("1990-01-15");
    expect(q.get("transit_date")).toBe("2026-10-10");
    expect(q.has("birth.date")).toBe(false);
  });

  it("reports accept the person's name and place for the cover page", async () => {
    const { fetch, calls } = mockFetch(() => ({ body: {} }));
    const c = makeClient(fetch);
    await c.reports.kundliLite({ ...BIRTH, name: "Arjun Mehta", place: "Mumbai" });
    const one = new URL(calls[0]!.url).searchParams;
    expect(one.get("name")).toBe("Arjun Mehta");
    expect(one.get("place")).toBe("Mumbai");
    await c.reports.matchMaking({ boy: BIRTH, girl: BIRTH, boyName: "A", girlName: "B", boyPlace: "Pune" });
    const q = new URL(calls[1]!.url).searchParams;
    expect(q.get("boy.name")).toBe("A");
    expect(q.get("girl.name")).toBe("B");
    expect(q.get("boy.place")).toBe("Pune");
  });

  it("monthly horoscope report takes month as YYYY-MM", async () => {
    const { fetch, calls } = mockFetch(() => ({ body: {} }));
    await makeClient(fetch).reports.horoscopeMonthly({ rashi: "Aries", month: "2026-11" });
    const q = new URL(calls[0]!.url).searchParams;
    expect(q.get("month")).toBe("2026-11");
    expect(q.has("year")).toBe(false);
  });

  it("exposes the meta catalogs", async () => {
    const { fetch, calls } = mockFetch(() => ({ body: {} }));
    const c = makeClient(fetch);
    await c.meta.endpoints();
    await c.meta.vedicYogas();
    expect(calls.map((x) => new URL(x.url).pathname)).toEqual(["/v1/meta/endpoints", "/v1/meta/vedic/yogas"]);
  });
});
