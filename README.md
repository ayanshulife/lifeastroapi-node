# lifeastroapi

Official **Node.js / TypeScript SDK** for [LifeAstroAPI](https://lifeastroapi.com) — a
B2B Vedic & Western astrology API with panchang-grade precision and
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
  print-ready kundli / matchmaking / numerology / horoscope PDFs. Rendering needs
  Puppeteer (a headless Chrome), installed separately — see
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
| `festivals` | full Hindu festival calendar by month / on a date — location-aware, `locale`, `monthSystem` (amanta/purnimanta); `panchang.monthly({ include: "sheet" })` returns a complete printable calendar page |
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
**branded, print-ready PDFs** — cover page, charts, planet and dasha tables,
narrative sections — white-labelled with your logo, colours, footer and optional
watermark.

The API itself returns **JSON only**. The PDF is built on **your** server, by this
SDK. That keeps your branding and your customers' reports on your side, and it is
why PDF rendering has requirements the rest of the SDK does not.

### Two layers

| Layer | Functions | Needs |
|---|---|---|
| **HTML** | `render*Html(data, branding?)` | Nothing. Pure string functions with zero dependencies; run on Node, serverless, edge or in a browser. |
| **PDF** | `*Pdf(data, opts?)`, `htmlToPdf(html, opts?)` | A headless Chromium, driven through **Puppeteer** (see below). |

If you only call the API, or only need HTML, you can ignore everything about
Puppeteer below — it is never loaded.

### What you need for PDFs

Puppeteer is an **optional peer dependency**: it is not installed with
`lifeastroapi`, and is imported only when you call a `*Pdf` function or `htmlToPdf`.
Pick one of these setups.

| Setup | Install | Disk | When to use |
|---|---|---|---|
| **Puppeteer** (simplest) | `npm install puppeteer` | roughly 400–500 MB — it downloads its own Chrome | A normal server, VM or container. |
| **puppeteer-core + your own Chrome** | `npm install puppeteer-core` | roughly 10–20 MB, plus the Chrome/Chromium you already have | Chrome is already on the machine, or you install it from your OS package manager. |
| **Serverless** | `npm install puppeteer-core @sparticuz/chromium` | sized to fit a Lambda layer | AWS Lambda, Vercel functions and similar. |

Also plan for:

- **Memory.** Each render runs a Chromium page; allow a few hundred MB of RAM for
  the browser. Reuse one browser across requests rather than launching one per PDF
  (see [Performance](#performance)).
- **Fonts.** See [Fonts](#fonts) — without the right fonts, Hindi and other Indic
  text prints as empty boxes.
- **Puppeteer 24 or newer** is recommended. The page footer uses a CSS page-margin
  box, which needs Chromium 131+; with an older browser the PDF still renders but
  the footer line is not printed.
- **Not available** on runtimes that cannot run a browser (Cloudflare Workers, the
  browser itself). Use the HTML layer there and convert elsewhere.

Calling a `*Pdf` function without Puppeteer installed throws a clear error telling
you to install it or pass your own.

### Quick start

```bash
npm install lifeastroapi puppeteer
```

```ts
import { LifeAstro } from "lifeastroapi";
import { kundliDetailedPdf } from "lifeastroapi/pdf";
import { writeFileSync } from "node:fs";

const client = new LifeAstro({ apiKey: process.env.LIFEASTRO_API_KEY });

// 1. Fetch the report JSON
const report = await client.reports.kundliDetailed({
  date: "1990-01-15", time: "10:30", tz: "Asia/Kolkata", lat: 19.076, lon: 72.8777,
  name: "Arjun Mehta", place: "Mumbai, India", lang: "hi",
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

### Available reports

Each report has a `render*Html` and a `*Pdf` form:

| Report | API method | HTML | PDF |
|---|---|---|---|
| Kundli (lite) | `reports.kundliLite` | `renderKundliLiteHtml` | `kundliLitePdf` |
| Kundli (detailed) | `reports.kundliDetailed` | `renderKundliDetailedHtml` | `kundliDetailedPdf` |
| Brihad Kundli | `reports.kundliBrihad` | `renderKundliBrihadHtml` | `kundliBrihadPdf` |
| Match-making | `reports.matchMaking` | `renderMatchMakingHtml` | `matchMakingPdf` |
| Mangal Dosha | `reports.mangalDosha` | `renderMangalDoshaHtml` | `mangalDoshaPdf` |
| Dasha analysis | `reports.dashaAnalysis` | `renderDashaAnalysisHtml` | `dashaAnalysisPdf` |
| Numerology | `reports.numerology` | `renderNumerologyHtml` | `numerologyPdf` |
| Sade Sati | `reports.sadeSati` | `renderSadeSatiHtml` | `sadeSatiPdf` |
| Varshaphal | `reports.varshaphal` | `renderVarshaphalHtml` | `varshaphalPdf` |
| Horoscope (daily / weekly / monthly) | `reports.horoscopeDaily` … | `renderHoroscopeHtml` | `horoscopePdf` |

All render in `en`, `hi` and `mr` (and other locales where the report data carries
them) — pass `lang` when you request the report.

**Brihad Kundli** is the large one (well over 100 pages). `kundliBrihadPdf` renders
it twice so the table of contents shows real page numbers, adds a running header
and footer, and writes PDF bookmarks. It is the slowest report to produce — give it
a generous timeout and render it in a background job rather than inside a web
request. For exact page numbers in the table of contents, also install the optional
`pdfjs-dist` (`npm install pdfjs-dist`); without it the SDK falls back to an
estimate.

### Names and places on the cover

Pass `name` and `place` (or `boyName` / `girlName` / `boyPlace` / `girlPlace` for
match-making) when you request the report. Without them the cover reads "Subject" /
"Boy" / "Girl" and shows the birth coordinates.

```ts
const report = await client.reports.matchMaking({
  boy, girl, boyName: "Arjun", girlName: "Asha", boyPlace: "Mumbai", girlPlace: "Delhi",
});
```

`place` is display text only — the chart is always computed from `lat` / `lon`.

### Branding

| Field | Effect |
|---|---|
| `companyName` | Shown on the cover. |
| `logoUrl` | Cover logo. `http(s)`, `data:image/...` or a relative URL. |
| `primaryColor` / `secondaryColor` | Headings, table headers, accents. |
| `footerText` | Line printed in the bottom margin of every page. |
| `watermarkText` | Optional diagonal watermark. |

**Precedence:** the `branding` you pass overrides the per-account branding embedded
in the report JSON, which falls back to neutral defaults.

### Performance

Launching Chromium for every PDF is slow. On a server, launch one browser and
reuse it — the SDK will not close a browser you pass in:

```ts
import puppeteer from "puppeteer";
const browser = await puppeteer.launch();
const pdf = await kundliDetailedPdf(report, { branding, browser });
// ... reuse `browser` for later requests; call browser.close() on shutdown
```

### Your own Chrome (`puppeteer-core`)

```ts
import puppeteer from "puppeteer-core";
const browser = await puppeteer.launch({
  executablePath: "/usr/bin/chromium", // macOS: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
});
const pdf = await kundliLitePdf(report, { browser });
```

Or let the SDK launch it: `kundliLitePdf(report, { puppeteer, launchOptions: { executablePath } })`.

### Serverless (AWS Lambda and similar)

```ts
import chromium from "@sparticuz/chromium";
import puppeteer from "puppeteer-core";
const browser = await puppeteer.launch({
  executablePath: await chromium.executablePath(),
  args: chromium.args,
});
const pdf = await horoscopePdf(report, { browser });
```

Serverless Chromium images ship without Indic fonts — bundle the Noto fonts you
need with your function (see [Fonts](#fonts)).

### Docker / Linux servers

A minimal image that can render every report, including Hindi:

```dockerfile
FROM node:22-slim
RUN apt-get update && apt-get install -y --no-install-recommends \
      chromium fonts-noto-core fonts-noto-extra \
    && rm -rf /var/lib/apt/lists/*
ENV PUPPETEER_SKIP_DOWNLOAD=true
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
```

with `puppeteer.launch({ executablePath: "/usr/bin/chromium", args: ["--no-sandbox"] })`.
`--no-sandbox` is needed when the container runs as root; prefer running as a
non-root user and keeping the sandbox.

### Fonts

The templates ask for the Noto Sans families. Chromium does **not** bundle fonts, so
the machine that renders the PDF must have fonts covering the scripts you use.
Without them, Devanagari and other Indic text prints as empty boxes.

- Debian / Ubuntu: `apt install fonts-noto-core` (add `fonts-noto-extra` for the
  full set of Indic scripts)
- macOS and Windows desktops already include Devanagari fonts.

### Without Puppeteer

Bring your own renderer, or run where a browser is not available — the HTML layer
has no dependencies:

```ts
import { renderMatchMakingHtml } from "lifeastroapi/pdf";
const html = renderMatchMakingHtml(matchReport, { primaryColor: "#b91c1c" });
// → your own Puppeteer/Playwright, Gotenberg, a print service, or the browser's Print dialog
```

The HTML is a complete, self-contained document with print CSS (A4, page margins,
footer), so any Chromium-based converter gives the same layout. The Brihad table of
contents, running header and bookmarks are added by `kundliBrihadPdf` and are not
part of the plain HTML.

### `htmlToPdf` options

All `*Pdf` functions accept these alongside `branding`:

| Option | Default | Meaning |
|---|---|---|
| `browser` | — | Reuse a launched browser. Not closed for you. |
| `puppeteer` | — | Inject the module (`puppeteer-core`). |
| `launchOptions` | — | Passed to `puppeteer.launch()` when the SDK launches the browser. |
| `format` | `"A4"` | `A3`, `A5`, `Letter`, `Legal`, `Tabloid`. |
| `landscape` | `false` | Landscape orientation. |
| `printBackground` | `true` | Print background colours. |
| `margin` | template's | `{ top, bottom, left, right }`, e.g. `"10mm"`. |
| `scale` | `1` | Render scale, 0.1–2. |
| `timeoutMs` | `30000` | Time allowed for the page to load. |

### Security

Branding inputs are sanitized — colours are validated against a safe allowlist, the
watermark and footer are CSS-escaped, and `logoUrl` is restricted to `http(s)`,
`data:image/...` and relative URLs. Chromium **fetches `logoUrl`** while rendering,
so if you ever pass a logo URL supplied by an end user, run Puppeteer with
restricted network egress to avoid requests to internal hosts (SSRF).

### Troubleshooting

| Symptom | Cause and fix |
|---|---|
| `PDF rendering requires Puppeteer` | Puppeteer is not installed. `npm install puppeteer`, or pass `{ puppeteer }` / `{ browser }`. |
| `Could not find Chrome` | `puppeteer-core` has no browser of its own — pass `executablePath`. With `puppeteer`, run `npx puppeteer browsers install chrome`. |
| Hindi text shows as boxes | No Indic font on the machine. Install Noto fonts (see [Fonts](#fonts)). |
| Browser fails to launch in Docker | Missing system libraries or the sandbox. Use the Dockerfile above. |
| No footer line on pages | The browser is older than Chromium 131. Update Puppeteer. |
| Timeouts on Brihad Kundli | It is a very large document rendered twice. Raise `timeoutMs` and render in a background job. |
| Cover says "Subject" | Pass `name` (and `place`) when requesting the report. |

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
