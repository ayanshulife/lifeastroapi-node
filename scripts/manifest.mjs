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
 * Per-path manifest fixups applied after load. Used for the two endpoints that
 * carry both a natal chart (birth.*) and a distinct transit moment, and to
 * keep sade-sati a pure natal query.
 */
const OVERRIDES = {
  "/v1/western/transits/to-natal": { shape: "natalTransit", extras: [], ns: "western.transits", method: "toNatal" },
  "/v1/western/narrative/transit-summary": {
    shape: "natalTransit",
    extras: [{ wire: "verbosity", type: "string", required: false }],
    ns: "western.narrative",
    method: "transitSummary",
  },
  "/v1/transit/sade-sati": { extras: [] },
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
