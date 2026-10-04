// @ts-nocheck
/**
 * Live API sweep: calls EVERY generated SDK method against a real API and
 * reports each one the API rejects. This is the check that the manifest's
 * paths and parameter names match what the server actually accepts — unit
 * tests with a fake fetch cannot see that.
 *
 *   npm run build
 *   LIFEASTRO_API_KEY=dv_live_... npm run live
 *
 * Environment:
 *   LIFEASTRO_API_URL    base URL (default: production). Point it at a local
 *                        server to sweep without spending production credits.
 *   LIFEASTRO_LIVE_SKIP  comma-separated path prefixes to leave out. Default
 *                        "/v1/reports/" — composed reports cost 500–8000
 *                        credits each. Set it to "" to include them.
 *   LIFEASTRO_LIVE_ONLY  comma-separated substrings; only matching paths run.
 *   LIFEASTRO_LIVE_DUMP  directory to write each response into as JSON.
 *
 * Spends credits: one request per endpoint.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { entries, camel } from "./manifest.mjs";
import { LifeAstro } from "../dist/index.js";

const A = { lat: 19.076, lon: 72.8777, date: "1990-01-15", time: "10:30", tz: "Asia/Kolkata" };
const B = { lat: 28.6139, lon: 77.209, date: "1992-06-20", time: "14:15", tz: "Asia/Kolkata" };
const NOW = { lat: 19.076, lon: 72.8777, tz: "Asia/Kolkata", date: "2026-11-20", time: "12:00" };

/** Sample input for each base shape. */
const SHAPE_INPUT = {
  moment: () => ({ ...NOW }),
  birth: () => ({ ...A }),
  birthPrefixed: () => ({ ...A }),
  boygirl: () => ({ boy: { ...A }, girl: { ...B } }),
  twoPerson: () => ({ personA: { ...A }, personB: { ...B } }),
  rashi: () => ({ rashi: "Aries" }),
  numerology: () => ({ name: "Arjun Mehta", dob: "1990-01-15" }),
  dateRange: () => ({ startDate: "2026-01-01", endDate: "2027-12-31" }),
  westernNatal: () => ({ ...A }),
  westernMoment: () => ({ date: NOW.date, time: NOW.time, tz: NOW.tz }),
  muhurta: () => ({ lat: NOW.lat, lon: NOW.lon, tz: NOW.tz, startDate: "2026-11-01", endDate: "2026-11-30" }),
  natalTransit: () => ({ birth: { ...A }, date: NOW.date, time: NOW.time, tz: NOW.tz }),
  // Deliberately empty: exercises the SDK's "today" + UTC defaults.
  instant: () => ({}),
  none: () => ({}),
  custom: () => ({}),
};

/** Sample values for required extras, keyed by wire name. */
const WIRE = {
  age_in_years: 35.5, asc_sign: "leo", asc_lon: 123.4, aspect: "trine", kind: "trine",
  "birth.date": A.date, "birth.time": A.time, "birth.tz": A.tz, birth_date: A.date,
  birth_nak: 7, birth_moon_sign: 3,
  "boy.date": A.date, "boy.time": A.time, "boy.tz": A.tz,
  "girl.date": B.date, "girl.time": B.time, "girl.tz": B.tz,
  cusp: 7, date: NOW.date, time: NOW.time, tz: NOW.tz, decan: 2, degree: 100, dob: A.date,
  start_date: "2026-01-01", end_date: "2027-12-31",
  from: "2026-06-01T00:00:00Z", to: "2027-01-01T00:00:00Z",
  house: 5, lat: A.lat, lon: A.lon, lord: "Jupiter", lot_sign: "cancer", maha: "Jupiter",
  month: 11, name: "Arjun Mehta", natal_planet: "Sun", transit_planet: "Saturn",
  observer_lat: B.lat, observer_lon: B.lon, planet: "Jupiter", planet_a: "Sun", planet_b: "Moon",
  q: "Mumbai", return_year: 2026, sign: "Leo", sign_a: "Aries", sign_b: "Leo",
  type: "three", week: "2026-W47", week_start: "2026-11-16", year: 2026, year_month: "2026-11",
};

/** Sample values for path parameters, keyed by name. */
const PATH = {
  md: "Jupiter", ad: "Saturn", pd: "Mercury", sd: "Ketu", component: "sthana", house: "8",
  koota: "nadi", n: 5, name: "Jupiter", number: 1, planet: "Jupiter", star: "Regulus", varga: "D9",
};

/**
 * Per-path corrections where a generic sample is wrong for that endpoint.
 * `input` is merged over the generated input.
 */
const PER_PATH = {
  "/v1/dasha/char/{md}": { md: "leo" },
  "/v1/dasha/char/{md}/{ad}": { md: "leo", ad: "scorpio" },
  "/v1/dasha/yogini/{name}": { name: "mangala" },
  "/v1/western/natal/planet/{name}": { name: "Venus" },
  "/v1/western/natal/lot/{name}": { name: "fortune" },
  "/v1/western/natal/fixed-stars/{name}": { name: "Regulus" },
  "/v1/western/retrograde-window/{planet}": { planet: "Mercury" },
  "/v1/vedic/remedies/lal-kitab/{planet}/{house}": { planet: "saturn", house: "8" },
  "/v1/geo/place/{id}": { id: "1275339" },
  "/v1/vedic/narrative/yoga/{id}": { id: "hamsa" },
  "/v1/vedic/narrative/dosha/{id}": { id: "mangal_dosha" },
  "/v1/vedic/remedies/{id}": { id: "hanuman_chalisa" },
  "/v1/vedic/remedies/mantra/{id}": { id: "hanuman_chalisa" },
  "/v1/vedic/remedies/daan/{id}": { id: "sadesati_setting_shanti" },
  "/v1/vedic/remedies/vrat/{id}": { id: "kaalsarp_dosha_shanti" },
  "/v1/vedic/remedies/pooja/{id}": { id: "jupiter_dasha_shanti" },
  "/v1/vedic/remedies/yantra/{id}": { id: "vedic.L1.remedy.yantra.jupiter" },
  "/v1/vedic/remedies/rudraksha/{id}": { id: "vedic.L1.remedy.rudraksha.jupiter" },
  "/v1/tarot/card/{id}": { id: 5 },
  "/v1/panchang/monthly": { tzOffsetHours: 5.5 },
  "/v1/horoscope/monthly": { month: "2026-11" },
  "/v1/reports/horoscope/monthly": { month: "2026-11" },
  "/v1/western/dignities/receptions": { sun: 294.78, moon: 152.4, venus: 300.1, mars: 250.2 },
  "/v1/muhurta/naamkaran": { birthDate: "2026-11-05" },
  "/v1/western/transits/calendar": { from: "2026-11-01", to: "2026-11-20" },
  "/v1/western/transits/exact": { from: "2026-01-01T00:00:00Z", to: "2027-01-01T00:00:00Z" },
  "/v1/vedic/narrative/reference/{family}": { family: "yoga" },
  "/v1/chart/ashtakvarga/{planet}": { planet: "Jupiter" },
};

function buildInput(e) {
  const input = SHAPE_INPUT[e.shape]();
  const missing = [];
  for (const n of e.pathParams ?? []) {
    if (n in PATH) input[n] = PATH[n];
    else missing.push(`path:${n}`);
  }
  for (const x of e.extras ?? []) {
    if (!x.required) continue;
    const field = x.name ?? camel(x.wire);
    if (x.wire in WIRE) input[field] = WIRE[x.wire];
    else missing.push(`extra:${x.wire}`);
  }
  Object.assign(input, PER_PATH[e.path] ?? {});
  for (const n of e.pathParams ?? []) {
    const i = missing.indexOf(`path:${n}`);
    if (i >= 0 && input[n] !== undefined) missing.splice(i, 1);
  }
  return { input, missing };
}

function resolveMethod(client, e) {
  let target = client;
  for (const part of e._resolved.ns.split(".")) target = target?.[part];
  const fn = target?.[e._resolved.method];
  return typeof fn === "function" ? fn.bind(target) : undefined;
}

const apiKey = process.env.LIFEASTRO_API_KEY;
if (!apiKey) {
  console.error("LIFEASTRO_API_KEY is required.");
  process.exit(2);
}
const skip = (process.env.LIFEASTRO_LIVE_SKIP ?? "/v1/reports/").split(",").filter(Boolean);
const only = (process.env.LIFEASTRO_LIVE_ONLY ?? "").split(",").filter(Boolean);
const dumpDir = process.env.LIFEASTRO_LIVE_DUMP;
if (dumpDir) mkdirSync(dumpDir, { recursive: true });

const client = new LifeAstro({
  apiKey,
  baseUrl: process.env.LIFEASTRO_API_URL,
  timeoutMs: 90_000,
  maxRetries: 0, // a retried failure is still a failure worth seeing
});

const failures = [];
let ran = 0;
for (const e of entries) {
  if (skip.some((p) => e.path.startsWith(p))) continue;
  if (only.length && !only.some((s) => e.path.includes(s))) continue;
  const label = `${e._resolved.ns}.${e._resolved.method}`;
  const fn = resolveMethod(client, e);
  if (!fn) {
    failures.push({ label, path: e.path, msg: "method not found on client (run `npm run generate && npm run build`)" });
    continue;
  }
  const { input, missing } = buildInput(e);
  if (missing.length) {
    failures.push({ label, path: e.path, msg: `no sample value for ${missing.join(", ")}` });
    continue;
  }
  ran++;
  try {
    const data = await fn(input);
    if (dumpDir) writeFileSync(join(dumpDir, `${label}.json`), JSON.stringify(data, null, 2));
  } catch (err) {
    failures.push({
      label,
      path: e.path,
      msg: `${err?.status ?? ""} ${err?.code ?? ""} ${err?.message ?? err}`.trim(),
      input,
    });
  }
  await new Promise((r) => setTimeout(r, 450)); // stay under the per-minute rate limit
}

for (const f of failures) {
  console.log(`FAIL ${f.label}  (${f.path})\n     ${f.msg}${f.input ? `\n     input=${JSON.stringify(f.input)}` : ""}`);
}
console.log(`\nlive sweep: ${ran} endpoints called, ${failures.length} failed`);
process.exit(failures.length ? 1 : 0);
