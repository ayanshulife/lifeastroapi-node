import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  LifeAstro,
  VERSION,
  AuthenticationError,
  PaymentRequiredError,
  PermissionError,
  NotFoundError,
  RateLimitError,
  BadRequestError,
  ServerError,
  LifeAstroConnectionError,
  type FetchLike,
  type Locale,
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

  const NOW = { lat: 19.076, lon: 72.8777, tz: "Asia/Kolkata", date: "2027-01-15" };
  const GIRL = { date: "1992-03-20", time: "08:15", tz: "Asia/Kolkata", lat: 28.6139, lon: 77.209 };
  type Api = InstanceType<typeof LifeAstro>;

  // One method per Vedic group; `both` is false where the shape's own builder sends `lang` only.
  const vedic: [string, string, (c: Api) => Promise<unknown>, boolean][] = [
    ["panchang.basic", "/v1/panchang/basic", (c) => c.panchang.basic({ ...NOW, lang: "gu" }), true],
    ["panchang.panchaka", "/v1/panchang/panchaka", (c) => c.panchang.panchaka({ ...NOW, lang: "gu" }), true],
    ["calendar.ritu", "/v1/calendar/ritu", (c) => c.calendar.ritu({ date: NOW.date, tz: NOW.tz, lang: "gu" }), true],
    ["festivals.month", "/v1/festivals/month", (c) => c.festivals.month({ year: 2027, month: 1, lang: "gu" }), true],
    ["eclipses.all", "/v1/eclipses/all", (c) => c.eclipses.all({ startDate: "2027-01-01", endDate: "2027-12-31", lang: "gu" }), true],
    ["planetMoments.ingress", "/v1/planet-moments/ingress", (c) => c.planetMoments.ingress({ planet: "Jupiter", date: NOW.date, tz: NOW.tz, lang: "gu" }), true],
    ["transit.positions", "/v1/transit/positions", (c) => c.transit.positions({ lang: "gu" }), true],
    ["transit.tarabala", "/v1/transit/tarabala", (c) => c.transit.tarabala({ birth: BIRTH, date: NOW.date, time: "06:00", tz: NOW.tz, lang: "gu" }), true],
    ["milan.ashtakoota", "/v1/milan/ashtakoota", (c) => c.milan.ashtakoota({ boy: BIRTH, girl: GIRL, lang: "gu" }), true],
    ["muhurta.vivah", "/v1/muhurta/vivah", (c) => c.muhurta.vivah({ ...NOW, lang: "gu" }), true],
    ["muhurta.bestTime", "/v1/muhurta/best-time", (c) => c.muhurta.bestTime({ lat: NOW.lat, lon: NOW.lon, tz: NOW.tz, startDate: "2027-01-15", endDate: "2027-01-17", lang: "gu" }), true],
    ["chart.planets", "/v1/chart/planets", (c) => c.chart.planets({ ...BIRTH, lang: "gu" }), true],
    ["chart.kundliFacts", "/v1/chart/kundli-facts", (c) => c.chart.kundliFacts({ ...BIRTH, lang: "gu" }), true],
    ["prashna.chart", "/v1/prashna/chart", (c) => c.prashna.chart({ ...NOW, time: "12:00", lang: "gu" }), true],
    ["numerology.driver", "/v1/numerology/driver", (c) => c.numerology.driver({ dob: "1990-01-15", lang: "gu" }), true],
    ["numerology.full", "/v1/numerology/full", (c) => c.numerology.full({ name: "Arjun Mehta", dob: "1990-01-15", lang: "gu" }), false],
    ["dasha.vimshottari", "/v1/dasha/vimshottari", (c) => c.dasha.vimshottari({ ...BIRTH, lang: "gu" }), true],
    ["varshaphal.chart", "/v1/varshaphal/chart", (c) => c.varshaphal.chart({ ...BIRTH, year: 2026, lang: "gu" }), true],
    ["ashtakavarga.bhinna", "/v1/ashtakavarga/bhinna/Jupiter", (c) => c.ashtakavarga.bhinna({ ...BIRTH, planet: "Jupiter", lang: "gu" }), true],
    ["lalkitab.chart", "/v1/lalkitab/chart", (c) => c.lalkitab.chart({ ...BIRTH, lang: "gu" }), true],
    ["horoscope.daily", "/v1/horoscope/daily", (c) => c.horoscope.daily({ rashi: "aries", lang: "gu" }), false],
    ["reports.kundliLite", "/v1/reports/kundli/lite", (c) => c.reports.kundliLite({ ...BIRTH, lang: "gu" }), true],
    ["narrative.yearlyBhavishyafal", "/v1/vedic/narrative/yearly-bhavishyafal", (c) => c.narrative.yearlyBhavishyafal({ ...BIRTH, year: 2027, lang: "gu" }), true],
    ["remedies.forGraha", "/v1/vedic/remedies/for-graha", (c) => c.remedies.forGraha({ graha: "saturn", lang: "gu" }), true],
  ];
  for (const [name, path, call, both] of vedic) {
    it(`${name} sends the language`, async () => {
      const { fetch, calls } = mockFetch(() => ({ body: {} }));
      await call(makeClient(fetch));
      const url = new URL(calls[0]!.url);
      expect(url.pathname).toBe(path);
      expect(url.searchParams.get("lang")).toBe("gu");
      if (both) expect(url.searchParams.get("locale")).toBe("gu");
    });
  }

  it("accepts every Locale value, including pa", async () => {
    const { fetch, calls } = mockFetch(() => ({ body: {} }));
    const client = makeClient(fetch);
    const all: Locale[] = ["en", "hi", "mr", "te", "ta", "kn", "ml", "gu", "bn", "pa"];
    for (const lang of all) await client.panchang.tithi({ ...NOW, lang });
    expect(calls.map((c) => new URL(c.url).searchParams.get("locale"))).toEqual(all);
  });

  it("sends no language param when lang is omitted", async () => {
    const { fetch, calls } = mockFetch(() => ({ body: {} }));
    await makeClient(fetch).panchang.basic(NOW);
    const url = new URL(calls[0]!.url);
    expect(url.searchParams.has("lang")).toBe(false);
    expect(url.searchParams.has("locale")).toBe(false);
  });

  it("keeps the existing `locale` input working, and `lang` wins when both are given", async () => {
    const { fetch, calls } = mockFetch(() => ({ body: {} }));
    const client = makeClient(fetch);
    await client.festivals.month({ year: 2027, month: 1, locale: "hi" });
    await client.panchang.monthly({ lat: NOW.lat, lon: NOW.lon, year: 2027, month: 1, locale: "hi", lang: "gu" });
    const a = new URL(calls[0]!.url);
    expect(a.searchParams.get("locale")).toBe("hi");
    expect(a.searchParams.has("lang")).toBe(false);
    const b = new URL(calls[1]!.url);
    expect(b.searchParams.get("locale")).toBe("gu");
    expect(b.searchParams.get("lang")).toBe("gu");
  });

  // English-only products and Vedic endpoints with nothing to localize take no
  // `lang` (a type error in TypeScript); from untyped JavaScript it is dropped.
  const noLang: [string, (c: any) => Promise<unknown>][] = [
    ["western.natal.planets", (c) => c.western.natal.planets({ ...BIRTH, lang: "gu" })],
    ["western.synastry.aspects", (c) => c.western.synastry.aspects({ personA: BIRTH, personB: GIRL, lang: "gu" })],
    ["western.transits.positions", (c) => c.western.transits.positions({ date: NOW.date, time: "12:00", tz: NOW.tz, lang: "gu" })],
    ["tarot.daily", (c) => c.tarot.daily({ lang: "gu" })],
    ["geo.search", (c) => c.geo.search({ q: "Mumbai", lang: "gu" })],
    ["meta.version", (c) => c.meta.version({ lang: "gu" })],
    ["panchang.rahuKaal", (c) => c.panchang.rahuKaal({ ...NOW, lang: "gu" })],
    ["chart.yogas", (c) => c.chart.yogas({ ...BIRTH, lang: "gu" })],
    ["transit.windows", (c) => c.transit.windows({ planet: "saturn", lang: "gu" })],
  ];
  for (const [name, call] of noLang) {
    it(`${name} does not send a language`, async () => {
      const { fetch, calls } = mockFetch(() => ({ body: {} }));
      await call(makeClient(fetch));
      const url = new URL(calls[0]!.url);
      expect(url.searchParams.has("lang")).toBe(false);
      expect(url.searchParams.has("locale")).toBe(false);
    });
  }

  it("Western narrative keeps its own lang (en / hi / mr)", async () => {
    const { fetch, calls } = mockFetch(() => ({ body: {} }));
    await makeClient(fetch).western.narrative.sabian({ degree: 100, lang: "hi" });
    expect(new URL(calls[0]!.url).searchParams.get("lang")).toBe("hi");
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

  // React Native's fetch rejects an aborted request with a TypeError, not an AbortError.
  const rnFetch: FetchLike = (_url, init) =>
    new Promise((_resolve, reject) => {
      const fail = () => reject(new TypeError("Network request failed"));
      if (init?.signal?.aborted) return fail();
      init?.signal?.addEventListener("abort", fail, { once: true });
    });

  it("times out with code 'timeout' when fetch rejects with a TypeError (React Native)", async () => {
    const err = await makeClient(rnFetch, { maxRetries: 0 })
      .panchang.tithi({ lat: 1, lon: 2, tz: "UTC" }, { timeoutMs: 10 })
      .catch((e) => e);
    expect(err).toBeInstanceOf(LifeAstroConnectionError);
    expect(err.code).toBe("timeout");
    expect(err.message).toBe("Request timed out after 10ms");
  });

  it("reports a caller abort as 'aborted' when fetch rejects with a TypeError (React Native)", async () => {
    const ac = new AbortController();
    ac.abort();
    const err = await makeClient(rnFetch)
      .panchang.tithi({ lat: 1, lon: 2, tz: "UTC" }, { signal: ac.signal })
      .catch((e) => e);
    expect(err.code).toBe("aborted");
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

describe("natal chart + transit moment are separate (0.5.0)", () => {
  const MOMENT = { birth: BIRTH, date: "2027-01-15", time: "06:00", tz: "Asia/Kolkata" };

  const cases: [string, (c: LifeAstro) => Promise<unknown>, boolean][] = [
    ["/v1/vedic/narrative/transit-phal", (c) => c.narrative.transitPhal(MOMENT), true],
    ["/v1/vedic/narrative/dasha-phal", (c) => c.narrative.dashaPhal(MOMENT), true],
    ["/v1/vedic/narrative/transit-double", (c) => c.narrative.transitDouble(MOMENT), false],
    ["/v1/vedic/narrative/sade-sati-status", (c) => c.narrative.sadeSatiStatus(MOMENT), false],
    ["/v1/vedic/narrative/sade-sati-phase", (c) => c.narrative.sadeSatiPhase(MOMENT), false],
    ["/v1/vedic/narrative/sade-sati-history", (c) => c.narrative.sadeSatiHistory(MOMENT), false],
    ["/v1/ashtakavarga/kaksha", (c) => c.ashtakavarga.kaksha(MOMENT), false],
    ["/v1/ashtakavarga/transit-score", (c) => c.ashtakavarga.transitScore(MOMENT), false],
    ["/v1/transit/small-panoti", (c) => c.transit.smallPanoti(MOMENT), false],
  ];

  for (const [path, call, place] of cases) {
    it(`${path}: birth.* is the chart, date is the transit moment`, async () => {
      const { fetch, calls } = mockFetch(() => ({ body: {} }));
      await call(makeClient(fetch));
      const url = new URL(calls[0]!.url);
      expect(url.pathname).toBe(path);
      const q = url.searchParams;
      expect(q.get("birth.date")).toBe("1990-01-15");
      expect(q.get("birth.time")).toBe("10:30");
      expect(q.get("birth.lat")).toBe("19.076");
      expect(q.get("date")).toBe("2027-01-15");
      expect(q.get("tz")).toBe("Asia/Kolkata");
      // Endpoints that cast the natal lagna read the birth place unprefixed.
      expect(q.get("lat")).toBe(place ? "19.076" : null);
    });
  }

  it("narrative.prashna sends the question moment, topic and house", async () => {
    const { fetch, calls } = mockFetch(() => ({ body: {} }));
    await makeClient(fetch).narrative.prashna({ lat: 19.076, lon: 72.8777, tz: "Asia/Kolkata", date: "2027-01-15", time: "10:00", topic: "career", questionHouse: 10, lang: "hi" });
    const q = new URL(calls[0]!.url).searchParams;
    expect(new URL(calls[0]!.url).pathname).toBe("/v1/vedic/narrative/prashna");
    expect(q.get("date")).toBe("2027-01-15");
    expect(q.get("time")).toBe("10:00");
    expect(q.get("topic")).toBe("career");
    expect(q.get("question_house")).toBe("10");
    expect(q.get("locale")).toBe("hi");
  });
});

describe("chart, transit, remedy and milan data endpoints (0.5.0)", () => {
  const GIRL = { date: "1992-03-20", time: "08:15", tz: "Asia/Kolkata", lat: 28.6139, lon: 77.209 };

  async function query(call: (c: LifeAstro) => Promise<unknown>) {
    const { fetch, calls } = mockFetch(() => ({ body: {} }));
    await call(makeClient(fetch));
    const url = new URL(calls[0]!.url);
    return { path: url.pathname, q: url.searchParams };
  }

  it("chart.kundliFacts / yogas / doshas / sensitivity read the birth chart unprefixed", async () => {
    const cases: [string, (c: LifeAstro) => Promise<unknown>, Record<string, string>][] = [
      ["/v1/chart/kundli-facts", (c) => c.chart.kundliFacts({ ...BIRTH, vargas: "D9,D10", include: "all", gender: "male" }), { vargas: "D9,D10", include: "all", gender: "male" }],
      ["/v1/chart/yogas", (c) => c.chart.yogas({ ...BIRTH, all: true }), { all: "true" }],
      ["/v1/chart/doshas", (c) => c.chart.doshas({ ...BIRTH, gender: "female" }), { gender: "female" }],
      ["/v1/chart/sensitivity", (c) => c.chart.sensitivity({ ...BIRTH, window: 60, vargas: "D9", topocentricMoon: true }), { window: "60", vargas: "D9", topocentric_moon: "true" }],
    ];
    for (const [path, call, extra] of cases) {
      const { path: got, q } = await query(call);
      expect(got).toBe(path);
      expect(q.get("date")).toBe("1990-01-15");
      expect(q.get("time")).toBe("10:30");
      expect(q.get("lat")).toBe("19.076");
      expect(q.get("birth.date")).toBeNull();
      for (const [k, v] of Object.entries(extra)) expect(q.get(k)).toBe(v);
    }
  });

  it("transit.sadeSatiWindows sends birth.* plus unprefixed from/tz", async () => {
    const { path, q } = await query((c) =>
      c.transit.sadeSatiWindows({ birth: { date: "1990-01-15", time: "10:30", tz: "Asia/Kolkata" }, from: "2027-01-15", tz: "UTC", years: 30, includePast: true }),
    );
    expect(path).toBe("/v1/transit/sade-sati/windows");
    expect(q.get("birth.date")).toBe("1990-01-15");
    expect(q.get("birth.time")).toBe("10:30");
    expect(q.get("birth.tz")).toBe("Asia/Kolkata");
    expect(q.get("birth.lat")).toBeNull();
    expect(q.get("date")).toBeNull();
    expect(q.get("from")).toBe("2027-01-15");
    expect(q.get("tz")).toBe("UTC");
    expect(q.get("years")).toBe("30");
    expect(q.get("include_past")).toBe("true");
  });

  it("transit.windows: planet required, birth optional", async () => {
    let r = await query((c) => c.transit.windows({ planet: "jupiter", from: "2027-01-15", years: 12 }));
    expect(r.path).toBe("/v1/transit/windows");
    expect(r.q.get("planet")).toBe("jupiter");
    expect(r.q.get("from")).toBe("2027-01-15");
    expect(r.q.get("years")).toBe("12");
    expect([...r.q.keys()].some((k) => k.startsWith("birth."))).toBe(false);
    r = await query((c) => c.transit.windows({ planet: "saturn", birth: BIRTH }));
    expect(r.q.get("birth.date")).toBe("1990-01-15");
    expect(r.q.get("birth.lat")).toBe("19.076");
    expect(r.q.get("birth.lon")).toBe("72.8777");
    expect(r.q.get("lat")).toBeNull();
  });

  it("remedies.forGraha maps graha, reason, include, category and language", async () => {
    const { path, q } = await query((c) => c.remedies.forGraha({ graha: "saturn", reason: "dosha:sade_sati", include: "pooja,yantra", category: "mantra", lang: "hi" }));
    expect(path).toBe("/v1/vedic/remedies/for-graha");
    expect(q.get("graha")).toBe("saturn");
    expect(q.get("reason")).toBe("dosha:sade_sati");
    expect(q.get("include")).toBe("pooja,yantra");
    expect(q.get("category")).toBe("mantra");
    expect(q.get("locale")).toBe("hi");
  });

  it("milan.overlay / summary send boy.* and girl.*", async () => {
    let r = await query((c) => c.milan.overlay({ boy: BIRTH, girl: GIRL }));
    expect(r.path).toBe("/v1/milan/overlay");
    expect(r.q.get("boy.date")).toBe("1990-01-15");
    expect(r.q.get("girl.date")).toBe("1992-03-20");
    expect(r.q.get("girl.lat")).toBe("28.6139");
    r = await query((c) => c.milan.summary({ boy: BIRTH, girl: GIRL, from: "2027-01-15", tz: "Asia/Kolkata", include: "kundli_facts" }));
    expect(r.path).toBe("/v1/milan/summary");
    expect(r.q.get("boy.time")).toBe("10:30");
    expect(r.q.get("girl.time")).toBe("08:15");
    expect(r.q.get("from")).toBe("2027-01-15");
    expect(r.q.get("tz")).toBe("Asia/Kolkata");
    expect(r.q.get("include")).toBe("kundli_facts");
  });

  it("milan.dashaSync maps the timeline options and the check moment", async () => {
    const { path, q } = await query((c) =>
      c.milan.dashaSync({ boy: BIRTH, girl: GIRL, timeline: true, years: 5, from: "2027-01-15", marriageWindows: true, date: "2027-02-01", tz: "Asia/Kolkata" }),
    );
    expect(path).toBe("/v1/milan/dasha-sync");
    expect(q.get("boy.lat")).toBe("19.076");
    expect(q.get("girl.lon")).toBe("77.209");
    expect(q.get("timeline")).toBe("true");
    expect(q.get("years")).toBe("5");
    expect(q.get("from")).toBe("2027-01-15");
    expect(q.get("marriage_windows")).toBe("true");
    expect(q.get("date")).toBe("2027-02-01");
    expect(q.get("tz")).toBe("Asia/Kolkata");
  });
});

describe("params the API reads that the manifest lacked", () => {
  async function query(call: (c: LifeAstro) => Promise<unknown>) {
    const { fetch, calls } = mockFetch(() => ({ body: {} }));
    await call(makeClient(fetch));
    const url = new URL(calls[0]!.url);
    return { path: url.pathname, q: url.searchParams };
  }

  it("muhurta.bestTime sends purpose, top_n and birth_date", async () => {
    const { path, q } = await query((c) =>
      c.muhurta.bestTime({ lat: 19.076, lon: 72.8777, tz: "Asia/Kolkata", startDate: "2027-01-15", endDate: "2027-01-31", purpose: "vivah", topN: 3, birthDate: "1990-01-15" }),
    );
    expect(path).toBe("/v1/muhurta/best-time");
    expect(q.get("purpose")).toBe("vivah");
    expect(q.get("top_n")).toBe("3");
    expect(q.get("birth_date")).toBe("1990-01-15");
    expect(q.get("start_date")).toBe("2027-01-15");
  });

  it("dasha.charCurrent and lalkitab.dashaCurrent send `at`", async () => {
    let r = await query((c) => c.dasha.charCurrent({ ...BIRTH, at: "2027-01-15T06:00:00Z" }));
    expect(r.path).toBe("/v1/dasha/char/current");
    expect(r.q.get("at")).toBe("2027-01-15T06:00:00Z");
    r = await query((c) => c.lalkitab.dashaCurrent({ ...BIRTH, at: "2027-01-15" }));
    expect(r.path).toBe("/v1/lalkitab/dasha/current");
    expect(r.q.get("at")).toBe("2027-01-15");
  });

  it("reports.horoscopeWeekly sends week", async () => {
    const { path, q } = await query((c) => c.reports.horoscopeWeekly({ rashi: "Aries", week: "2026-W47" }));
    expect(path).toBe("/v1/reports/horoscope/weekly");
    expect(q.get("week")).toBe("2026-W47");
    expect(q.get("rashi")).toBe("aries");
  });

  it("VERSION (User-Agent) matches package.json", async () => {
    const { readFileSync } = await import("node:fs");
    const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
    expect(VERSION).toBe(pkg.version);
  });
});

describe("optional calculation settings the API reads", () => {
  const GIRL = { date: "1992-03-20", time: "08:15", tz: "Asia/Kolkata", lat: 28.6139, lon: 77.209 };
  async function query(call: (c: LifeAstro) => Promise<unknown>) {
    const { fetch, calls } = mockFetch(() => ({ body: {} }));
    await call(makeClient(fetch));
    return new URL(calls[0]!.url).searchParams;
  }

  it("Western aspect orbs, rulership and house system", async () => {
    let q = await query((c) => c.western.natal.chart({ ...BIRTH, orbTrine: 6, orbSextile: 4, rulership: "traditional" }));
    expect(q.get("orb_trine")).toBe("6");
    expect(q.get("orb_sextile")).toBe("4");
    expect(q.get("rulership")).toBe("traditional");
    q = await query((c) => c.western.synastry.aspects({ personA: BIRTH, personB: GIRL, houseSystem: "koch", orbConjunction: 8 }));
    expect(q.get("house_system")).toBe("koch");
    expect(q.get("orb_conjunction")).toBe("8");
    expect(q.get("personA.date")).toBe("1990-01-15");
    q = await query((c) => c.western.transits.toNatal({ birth: BIRTH, date: "2027-01-15", time: "06:00", tz: "UTC", orbSquare: 5 }));
    expect(q.get("orb_square")).toBe("5");
    expect(q.get("birth.date")).toBe("1990-01-15");
  });

  it("composite method and return relocation", async () => {
    let q = await query((c) => c.western.composite.chart({ personA: BIRTH, personB: GIRL, compositeMethod: "midpoint_cusps" }));
    expect(q.get("composite_method")).toBe("midpoint_cusps");
    q = await query((c) => c.western.returns.solar({ ...BIRTH, returnYear: 2027, relocateLat: 51.5, relocateLon: -0.12 }));
    expect(q.get("relocate_lat")).toBe("51.5");
    expect(q.get("relocate_lon")).toBe("-0.12");
  });

  it("ayanamsa on calendar / planet moments / best-time", async () => {
    let q = await query((c) => c.calendar.ritu({ date: "2027-01-15", tz: "Asia/Kolkata", ayanamsa: "raman" }));
    expect(q.get("ayanamsa")).toBe("raman");
    q = await query((c) => c.planetMoments.ingress({ planet: "Jupiter", date: "2027-01-15", tz: "Asia/Kolkata", ayanamsa: "krishnamurti" }));
    expect(q.get("ayanamsa")).toBe("krishnamurti");
    q = await query((c) => c.muhurta.bestTime({ lat: 19.076, lon: 72.8777, tz: "Asia/Kolkata", startDate: "2027-01-15", endDate: "2027-01-31", ayanamsa: "raman" }));
    expect(q.get("ayanamsa")).toBe("raman");
  });
});
