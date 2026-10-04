# lifeastroapi

Official **Node.js / TypeScript SDK** for [LifeAstroAPI](https://lifeastroapi.com) — a
B2B Vedic & Western astrology API with DrikPanchang-level precision and
pay-per-call billing.

- ✅ **310 endpoints**, fully typed, across 23 namespaces — panchang, charts, dashas,
  matchmaking, transits, horoscopes, numerology, tarot, muhurta, reports, narratives,
  and a complete Western (tropical) module.
- ✅ **Zero runtime dependencies** — uses the platform `fetch` (Node 18+, Bun, Deno,
  and edge / serverless runtimes). Server-side by design — see [Authentication](#authentication).
- ✅ **ESM + CommonJS** with bundled `.d.ts` types.
- ✅ Typed errors, automatic retries (429/5xx) with `Retry-After`, timeouts, and a
  generic escape hatch for any endpoint.
- ✅ **Branded PDF reports** (optional) — turn report JSON into white-label,
  print-ready kundli / matchmaking / numerology / horoscope PDFs. See
  [Branded PDF reports](#branded-pdf-reports).

```bash
npm install lifeastroapi
```

Get an API key at **https://lifeastroapi.com/dashboard/keys**.

## Quick start

```ts
import { LifeAstro } from "lifeastroapi";

const client = new LifeAstro({ apiKey: "dv_live_..." });
// or: new LifeAstro({ apiKey: process.env.LIFEASTRO_API_KEY })
// or just: new LifeAstro("dv_live_...")

// Today's panchang for a location
const tithi = await client.panchang.tithi({
  lat: 28.6139,
  lon: 77.209,
  tz: "Asia/Kolkata",
});

// A Vedic birth chart
const planets = await client.chart.planets({
  date: "1990-01-15",
  time: "10:30",
  tz: "Asia/Kolkata",
  lat: 19.076,
  lon: 72.8777,
});

// Kundli matchmaking score
const match = await client.milan.ashtakootaTotal({
  boy:  { date: "1988-05-04", time: "06:15", tz: "Asia/Kolkata", lat: 28.61, lon: 77.20 },
  girl: { date: "1992-03-20", time: "21:40", tz: "Asia/Kolkata", lat: 19.07, lon: 72.87 },
});
```

> CommonJS works too: `const { LifeAstro } = require("lifeastroapi");`

## Authentication

Your API key (`dv_live_…`) authenticates every request and is sent as a
`Authorization: Bearer …` header. Provide it in any of three ways:

```ts
new LifeAstro({ apiKey: "dv_live_..." });   // 1. explicit (recommended)
new LifeAstro("dv_live_...");                // 2. shorthand
new LifeAstro();                             // 3. reads process.env.LIFEASTRO_API_KEY
```

If no key is found (neither argument nor env var), the constructor throws a clear
error. Get a key at **https://lifeastroapi.com/dashboard/keys**.

> ### 🔒 Keep your key secret — use the SDK server-side
> A `dv_live_…` key carries your account's **full billing access**. Use this SDK from a
> **server, serverless function, or edge runtime** — and load the key from an environment
> variable / secrets manager, never hard-coded. **Do not embed the key in browser, mobile,
> desktop, or any client-side code**, where end users could extract it and run up your bill.
> For client apps, call LifeAstroAPI from your own backend and forward the results.
>
> (Need PDFs in the browser? The dependency-free `lifeastroapi/pdf` `render*Html`
> functions take **no key** and are safe to run anywhere — see [Branded PDF reports](#branded-pdf-reports).)

## Configuration

```ts
const client = new LifeAstro({
  apiKey: "dv_live_...",          // or set LIFEASTRO_API_KEY
  baseUrl: "https://api.lifeastroapi.com", // override for local dev (http://localhost:8080)
  timeoutMs: 30_000,              // per-request timeout (default 30s)
  maxRetries: 2,                  // retries on 429 / 5xx / network (default 2)
  defaultHeaders: {},             // extra headers on every request
  fetch: myFetch,                 // inject a custom fetch (older runtimes / proxies / tests)
});
```

## Input shapes

Most methods accept one of a few ergonomic input objects. The SDK maps these to the
exact wire parameters the API expects (`birth.lat`, `boy.date`, `start_date`, …) for you.

| Shape | Used by | Example fields |
|-------|---------|----------------|
| **Moment** | `panchang.*`, `muhurta.*` (single date), `prashna.*` | `{ lat, lon, tz, date?, time? }` |
| **Instant** | `transit.positions`, `transit.doubleTransit`, `meta.ayanamsas` | `{ date?, time?, tz? }` |
| **Birth** | `chart.*`, `dasha.*`, `numerology`, narratives, reports | `{ date, time, tz, lat, lon }` |
| **Boy/Girl** | `milan.*`, `reports.matchMaking` | `{ boy: Birth, girl: Birth }` |
| **Two-person** | `western.synastry.*`, `western.composite.*` | `{ personA: Birth, personB: Birth }` |
| **Rashi** | `horoscope.*` | `{ rashi: "aries", date?, lang? }` |
| **Date range** | `eclipses.*`, `western.ingresses` | `{ startDate, endDate }` |
| **Muhurta (search)** | `muhurta.bestTime` | `{ lat, lon, tz, startDate, endDate }` |
| **Natal + transit** | `transit.tarabala`, `transit.vedha`, `western.transits.toNatal` | `{ birth: Birth, date, time, tz }` |

**Dates.** The API requires a `date` on every moment endpoint — it has no "today"
default. Where a shape marks `date?` optional, the SDK sends today's date in the `tz`
you gave. The per-purpose muhurta methods (`muhurta.vivah`, `grahaPravesh`, …) score
**one** date per call; to search a range for the best dates use `muhurta.bestTime`.

**Personalised horoscopes** (`narrative.horoscopeDailyByLagna`, `…ByMoon`, `…Tamil`,
`horoscopeWeeklyBy…`) take the **birth** chart as their input; pass `onDate`
(`YYYY-MM-DD`) to read a day other than today.

Vedic endpoints also accept optional calculation settings: `ayanamsa`
(`"lahiri"` default, `"krishnamurti"`, `"raman"`, …) and `houseSystem`.

```ts
await client.chart.planets({ ...birth, ayanamsa: "krishnamurti", houseSystem: "placidus" });
```

## Namespaces

`client.<namespace>.<method>(input)` — every method returns the response payload.

| Namespace | What it covers |
|-----------|----------------|
| `panchang` | tithi, nakshatra, yoga, karana, vara, sunrise/sunset, rahu-kaal, choghadiya, hora, muhurtas, monthly calendar, composite `basic`/`advanced` |
| `chart` | planets, ascendant, houses, divisional (D1–D60), dignity, aspects, shadbala, ashtakvarga, avakhada, KP, astro-details |
| `dasha` | full + current Vimshottari (5-level drill-down) and Yogini |
| `milan` | Ashtakoota (total / full / per-koota), mangal/nadi/shani dosha, navamsa & dasha compatibility |
| `transit` | positions, sade-sati, ashtakavarga, tarabala, vedha, double-transit, small-panoti |
| `horoscope` | daily / weekly / monthly by rashi |
| `numerology` | driver, conductor, soul, personality, destiny, full, advanced, challenges, personalPeriods |
| `muhurta` | vivah, naamkaran, griha-pravesh, vyapar, yatra, best-time, … |
| `varshaphal` | annual chart, lord, muntha, mudda-dasha, harsha-bala, tajika yogas |
| `prashna` | horary answer, chart, arudha, significators |
| `eclipses` | solar / lunar / all (date range, optional visibility) |
| `calendar` | Hindu month, ritu, samvatsara, adhik-maas |
| `festivals` | festivals by month / on a date |
| `planetMoments` | retrograde windows, ingress, combustion window, speed |
| `ashtakavarga` | sarva, bhinna (per planet), kaksha, transit-score |
| `geo` | place search, reverse geocode, timezone, place by id |
| `tarot` | cards, single card, daily, spread, yes/no |
| `reports` | kundli (lite/detailed/brihad), match-making, mangal-dosha, sade-sati, varshaphal, numerology, horoscopes |
| `narrative` | authored Vedic interpretations (lagna, planets, yogas, doshas, dasha-phal, outlooks, …) in `en/hi/mr/bn/kn/ta/te/gu` |
| `remedies` | remedies by rule id; mantra / pooja / vrat / daan / rudraksha / yantra detail; Lal Kitab remedies |
| `lalkitab` | Lal Kitab chart and dasha |
| `meta` | free catalogs: `endpoints` (credit cost of every route), `ayanamsas`, `vedicYogas`, `vedicDoshas`, `vedicLocales`, `version` |
| `western` | full tropical module (see below) |

### Western (tropical)

Nested under `client.western.*`:

```ts
await client.western.natal.chart({ date, time, tz, lat, lon, houseSystem: "placidus" });
await client.western.synastry.score({ personA, personB });
await client.western.transits.toNatal({ birth, date: "2026-06-16", time: "12:00", tz: "UTC" });
await client.western.returns.solar({ date, time, tz, lat, lon, returnYear: 2026 });
await client.western.profections.annual({ birthDate: "1990-01-15", ascSign: "capricorn" });
```

Sub-namespaces: `natal`, `horoscope`, `synastry`, `composite`, `davison`, `transits`,
`progressions`, `solarArc`, `returns`, `dignities`, `profections`, `zodiacalReleasing`,
`primaryDirections`, `interpretation`, `narrative`, `heliocentric`, `astrocartography`,
`eclipses`, `lunar`, `compatibility`, plus `firdaria`, `ingresses`, `retrogradeWindow`.

## Error handling

Every non-2xx response throws a typed error carrying the API's `code`, HTTP `status`,
and `request_id`:

```ts
import { LifeAstro, PaymentRequiredError, RateLimitError, LifeAstroError } from "lifeastroapi";

try {
  await client.chart.planets(birth);
} catch (err) {
  if (err instanceof PaymentRequiredError) {
    // 402 — out of credits / trial exhausted
  } else if (err instanceof RateLimitError) {
    console.log(`retry after ${err.retryAfter}s`);
  } else if (err instanceof LifeAstroError) {
    console.error(err.code, err.status, err.message, err.requestId);
  }
}
```

Error classes: `BadRequestError` (400), `AuthenticationError` (401),
`PaymentRequiredError` (402), `PermissionError` (403), `NotFoundError` (404),
`RateLimitError` (429), `ServerError` (5xx), `LifeAstroConnectionError` (network/timeout).
All extend `LifeAstroError`.

## Typing the response

The API returns each payload directly as JSON (there is no `{ data, meta }` wrapper),
and the SDK hands it back typed `unknown` by default. Narrow it with a type parameter:

```ts
interface TithiData { number: number; name_en: string; paksha: string }
const t = await client.panchang.tithi<TithiData>({ lat, lon, tz });
```

## Escape hatch

Call any `/v1/*` endpoint directly — useful for brand-new endpoints not yet wrapped:

```ts
const data = await client.request("/v1/panchang/tithi", { lat: 28.61, lon: 77.20, tz: "Asia/Kolkata" });
// client.get(...) is an alias
```

## Per-call options

```ts
const controller = new AbortController();
await client.chart.planets(birth, { signal: controller.signal, timeoutMs: 5000 });
```

## Branded PDF reports

The `lifeastroapi/pdf` subpath turns the JSON from `client.reports.*` into
**branded, print-ready PDFs** — same designs the API was built to produce
(cover page, planet/dasha tables, narrative sections), white-labelled with
your client's logo, colors, footer, and optional watermark.

Two layers:

1. **`render*Html(data, branding?)`** — pure, **zero-dependency** functions
   that produce a self-contained, branded HTML document. Run anywhere (Node,
   edge, browser).
2. **`htmlToPdf(html, opts?)`** and the **`*Pdf(...)`** convenience wrappers —
   produce PDF bytes via the **optional** `puppeteer` peer dependency.

```bash
npm install puppeteer   # only if you want the SDK to emit PDF bytes
```

```ts
import { LifeAstro } from "lifeastroapi";
import { kundliDetailedPdf, renderMatchMakingHtml } from "lifeastroapi/pdf";
import { writeFileSync } from "node:fs";

const client = new LifeAstro({ apiKey: process.env.LIFEASTRO_API_KEY });

// 1. Fetch the report JSON
const report = await client.reports.kundliDetailed({
  date: "1990-01-15", time: "10:30", tz: "Asia/Kolkata", lat: 19.076, lon: 72.8777,
  lang: "hi",
});

// 2. Render a branded PDF in one call
const pdf = await kundliDetailedPdf(report, {
  branding: {
    companyName: "Acme Astro",
    logoUrl: "https://cdn.acme.com/logo.png", // or a data: URI
    primaryColor: "#6b21a8",
    secondaryColor: "#9333ea",
    footerText: "© Acme Astro — astrology for everyone",
    watermarkText: "SAMPLE", // optional diagonal watermark
  },
});
writeFileSync("kundli.pdf", pdf);
```

Prefer to bring your own renderer (or run on serverless)? Use the HTML layer
and convert however you like — it has no dependencies:

```ts
const html = renderMatchMakingHtml(matchReport, { primaryColor: "#b91c1c" });
// → feed `html` to your own Puppeteer/Playwright, a print service, Gotenberg, etc.
```

**Branding precedence:** caller `branding` overrides the per-account branding
embedded in the report JSON, which falls back to neutral system defaults.

**Security note:** branding inputs are sanitized — colors are validated against a
safe-color allowlist, the watermark is CSS-escaped, and `logoUrl` is restricted to
`http(s)` / `data:image/...` / relative URLs (other schemes are dropped). Chromium
**fetches `logoUrl`** when rendering, so if you ever pass untrusted / end-user logo
URLs, run Puppeteer with restricted network egress to avoid SSRF to internal hosts.

**Performance:** launching Chromium per call is slow. On a server, launch
Puppeteer once and reuse it:

```ts
import puppeteer from "puppeteer";
const browser = await puppeteer.launch();
const pdf = await kundliDetailedPdf(report, { branding, browser }); // browser not closed for you
```

On serverless (AWS Lambda etc.), inject `puppeteer-core` + a Chromium layer:

```ts
import chromium from "@sparticuz/chromium";
import puppeteer from "puppeteer-core";
const browser = await puppeteer.launch({ executablePath: await chromium.executablePath(), args: chromium.args });
const pdf = await horoscopePdf(report, { browser });
```

Covered reports: `kundliLite`, `kundliDetailed`, `kundliBrihad`, `matchMaking`,
`mangalDosha`, `dashaAnalysis`, `numerology`, `sadeSati`, `varshaphal`, `horoscope`
(each has both a `render*Html` and a `*Pdf` form). All render in `en/hi/mr`
(and other locales where the report data carries them).

**Names and places on the cover.** Pass `name` and `place` (or `boyName` / `girlName` /
`boyPlace` / `girlPlace` for match-making) when you request the report. Without them
the cover reads "Subject" / "Boy" / "Girl" and shows the birth coordinates:

```ts
const report = await client.reports.kundliLite({
  ...birth, name: "Vikas Sharma", place: "Mumbai, India", lang: "hi",
});
```

`place` is display text only — the chart is always computed from `lat` / `lon`.

**Fonts.** The templates ask for the Noto Sans families. Chromium does not bundle
fonts, so the machine that renders the PDF must have fonts covering the scripts you
use — install `fonts-noto` (Debian/Ubuntu: `apt install fonts-noto-core`) on servers
and containers, or Devanagari and other Indic text prints as empty boxes.

**Footer.** The footer line is printed in the bottom page margin using a CSS page-margin
box, which needs Chromium 131 or newer (any current Puppeteer). Older engines print no
footer.

## Contributing

The typed surface is generated from a manifest. After editing
`scripts/endpoints_part*.json`, regenerate and build:

```bash
npm run generate   # regenerate src/resources/*
npm run typecheck
npm run build
npm test
```

Unit tests use a fake `fetch`, so they cannot tell whether the API really accepts a
parameter. `npm run live` calls **every** method against a real server and lists each
one the API rejects:

```bash
npm run build
LIFEASTRO_API_KEY=dv_live_... npm run live                    # skips /v1/reports/ (500–8000 credits each)
LIFEASTRO_API_KEY=dv_live_... LIFEASTRO_LIVE_SKIP="" npm run live   # include reports
LIFEASTRO_API_URL=http://localhost:8080 ... npm run live     # sweep a local server instead
```

It spends credits (one request per endpoint).

## License

MIT © Ayanshu Life
