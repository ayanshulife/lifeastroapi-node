// @ts-nocheck
/**
 * The endpoint manifest, loaded and resolved: merges endpoints_part1.json +
 * endpoints_part2.json, applies the per-path overrides, and works out each
 * endpoint's namespace and method name. Shared by the code generator
 * (generate.mjs) and the live API sweep (live-sweep.mjs) so both always agree
 * on which SDK method an endpoint becomes.
 */
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------------------
// Load + merge manifests (part1 takes precedence on duplicate paths).
// ---------------------------------------------------------------------------
const part1 = JSON.parse(readFileSync(join(__dirname, "endpoints_part1.json"), "utf8"));
const part2 = JSON.parse(readFileSync(join(__dirname, "endpoints_part2.json"), "utf8"));

/**
 * Per-path manifest fixups applied after load. Used for the endpoints that
 * carry both a natal chart (birth.*) and a distinct transit moment, and to
 * keep sade-sati a pure natal query.
 */
const OVERRIDES = {
  "/v1/western/transits/to-natal": {
    shape: "natalTransit",
    extras: ["conjunction", "opposition", "trine", "square", "sextile"].map((k) => ({
      wire: `orb_${k}`,
      type: "number",
      required: false,
    })),
    ns: "western.transits",
    method: "toNatal",
  },
  "/v1/western/narrative/transit-summary": {
    shape: "natalTransit",
    extras: [{ wire: "verbosity", type: "string", required: false }],
    ns: "western.narrative",
    method: "transitSummary",
  },
  "/v1/transit/sade-sati": { extras: [] },
  // Natal chart under birth.*, the moment unprefixed. Before 0.5.0 these sent
  // the birth date as the transit/dasha date as well.
  "/v1/vedic/narrative/transit-phal": {
    shape: "natalTransitPlace",
    extras: [{ wire: "lang", type: "string", required: false }],
  },
  "/v1/vedic/narrative/dasha-phal": {
    shape: "natalTransitPlace",
    extras: [{ wire: "lang", type: "string", required: false }],
  },
  "/v1/vedic/narrative/transit-double": { shape: "natalTransit", extras: [{ wire: "lang", type: "string", required: false }] },
  "/v1/vedic/narrative/sade-sati-status": { shape: "natalTransit", extras: [{ wire: "lang", type: "string", required: false }] },
  "/v1/vedic/narrative/sade-sati-phase": { shape: "natalTransit", extras: [{ wire: "lang", type: "string", required: false }] },
  "/v1/vedic/narrative/sade-sati-history": { shape: "natalTransit", extras: [{ wire: "lang", type: "string", required: false }] },
  // birth.* (with birth.lat/lon for the natal chart) + the transit date/tz.
  "/v1/ashtakavarga/kaksha": { shape: "natalTransit", extras: [] },
  "/v1/ashtakavarga/transit-score": { shape: "natalTransit", extras: [] },
  "/v1/transit/small-panoti": { shape: "natalTransit", extras: [] },
};

const byPath = new Map();
for (const e of [...part1, ...part2]) {
  if (!byPath.has(e.path)) byPath.set(e.path, { ...e });
}
for (const [path, ov] of Object.entries(OVERRIDES)) {
  if (byPath.has(path)) Object.assign(byPath.get(path), ov);
}
export const entries = [...byPath.values()];

// ---------------------------------------------------------------------------
// Response language. Every Vedic endpoint that answers in the request language
// gets an optional `lang` input (the generator sends it as both `lang` and
// `locale`; the API reads either). Not added to:
//   - English-only products (Western, Tarot, geo, meta);
//   - NO_LANG: Vedic endpoints whose response has nothing to localize (times,
//     numbers and ids only). Checked against the API handlers and a sweep of
//     every endpoint in each locale. Move a path out of this list when its
//     response gains reader text.
// ---------------------------------------------------------------------------
const ENGLISH_ONLY_PREFIXES = ["/v1/western/", "/v1/tarot/", "/v1/geo/", "/v1/meta/"];
const NO_LANG = new Set([
  // time windows only
  "/v1/panchang/sunrise-sunset",
  "/v1/panchang/moonrise-moonset",
  "/v1/panchang/rahu-kaal",
  "/v1/panchang/yamaganda",
  "/v1/panchang/gulika",
  "/v1/panchang/abhijit",
  "/v1/panchang/brahma-muhurat",
  "/v1/panchang/pradosh-kaal",
  "/v1/panchang/durmuhurta",
  // numbers only
  "/v1/chart/bhavabala",
  "/v1/ashtakavarga/sarva",
  "/v1/milan/ashtakoota/total",
  "/v1/muhurta/chandra-bala",
  "/v1/muhurta/tara-bala",
  "/v1/varshaphal/muntha",
  "/v1/varshaphal/solar-return-jd",
  // data endpoints: ids and instants by design
  "/v1/chart/yogas",
  "/v1/chart/doshas",
  "/v1/chart/sensitivity",
  "/v1/milan/overlay",
  "/v1/transit/sade-sati",
  "/v1/transit/sade-sati/windows",
  "/v1/transit/small-panoti",
  "/v1/transit/small-panoti/history",
  "/v1/transit/windows",
]);
/** Shapes whose own input type and builder already carry `lang`. */
const SHAPES_WITH_LANG = new Set(["rashi", "numerology"]);

for (const path of NO_LANG) {
  if (!byPath.has(path)) throw new Error(`NO_LANG lists ${path}, which is not in the manifest.`);
}
for (const e of entries) {
  if (ENGLISH_ONLY_PREFIXES.some((p) => e.path.startsWith(p)) || NO_LANG.has(e.path)) continue;
  const extras = e.extras ?? [];
  if (SHAPES_WITH_LANG.has(e.shape) || extras.some((x) => (x.name ?? camel(x.wire)) === "lang")) continue;
  e.extras = [...extras, { wire: "lang", type: "locale", required: false }];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
export function camel(s) {
  const words = String(s).split(/[^a-zA-Z0-9]+/).filter(Boolean);
  return words
    .map((w, i) => (i === 0 ? w[0].toLowerCase() + w.slice(1) : w[0].toUpperCase() + w.slice(1)))
    .join("");
}
export function pascal(s) {
  const c = camel(s);
  return c ? c[0].toUpperCase() + c.slice(1) : c;
}
export function deriveNsMethod(e) {
  const segs = e.path.replace(/^\/v1\//, "").split("/").filter((s) => s && !s.startsWith("{"));
  const first = segs[0];
  let ns;
  let methodSegs;
  if (first === "vedic") {
    ns = segs[1]; // narrative | remedies
    methodSegs = segs.slice(2);
  } else if (first === "planet-moments") {
    ns = "planetMoments";
    methodSegs = segs.slice(1);
  } else if (first === "western") {
    const rest = segs.slice(1);
    if (rest.length <= 1) {
      ns = "western";
      methodSegs = rest;
    } else {
      ns = "western." + camel(rest[0]);
      methodSegs = rest.slice(1);
    }
  } else {
    ns = camel(first);
    methodSegs = segs.slice(1);
  }
  const derivedMethod = camel(methodSegs.join("-")) || camel(first);
  return { ns: e.ns ?? ns, method: e.method ?? derivedMethod };
}

// Resolve ns/method for every entry + detect collisions.
const seen = new Map(); // `${ns}#${method}` -> path
for (const e of entries) {
  e._resolved = deriveNsMethod(e);
  const key = `${e._resolved.ns}#${e._resolved.method}`;
  if (seen.has(key)) {
    throw new Error(
      `Method collision: ${key} from both ${seen.get(key)} and ${e.path}. ` +
        `Add an explicit "ns"/"method" override.`,
    );
  }
  seen.set(key, e.path);
}
