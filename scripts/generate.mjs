// @ts-nocheck
/**
 * Code generator: reads the endpoint manifests (endpoints_part1.json +
 * endpoints_part2.json) and emits the typed resource namespace classes under
 * src/resources/. Run with `npm run generate`.
 *
 * The manifest is the single source of truth for the endpoint surface; the
 * hand-written core (client/http/params/errors/types) is never generated.
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { entries, camel, pascal } from "./manifest.mjs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const OUT = join(ROOT, "src", "resources");

// ---------------------------------------------------------------------------
// Shape configuration: TS input type + query builder + whether the base shape
// contributes required fields.
// ---------------------------------------------------------------------------
const SHAPES = {
  moment: { ts: "Types.MomentInput & Types.VedicMomentSettings", builder: "qMoment", required: true },
  birth: { ts: "Types.BirthInput & Types.VedicBirthSettings", builder: "qBirth", required: true },
  birthPrefixed: { ts: "Types.BirthInput & Types.VedicMomentSettings", builder: "qBirthPrefixed", required: true },
  boygirl: { ts: "Types.BoyGirlInput & Types.VedicMomentSettings", builder: "qBoyGirl", required: true },
  twoPerson: { ts: "Types.TwoPersonInput", builder: "qTwoPerson", required: true },
  rashi: { ts: "Types.RashiInput", builder: "qRashi", required: true },
  numerology: { ts: "Types.NumerologyInput", builder: "qNumerology", required: false },
  dateRange: { ts: "Types.DateRangeInput", builder: "qDateRange", required: true },
  westernNatal: { ts: "Types.WesternNatalInput", builder: "qWesternNatal", required: true },
  westernMoment: { ts: "Types.WesternMomentInput", builder: "qWesternMoment", required: true },
  muhurta: { ts: "Types.MuhurtaInput", builder: "qMuhurta", required: true },
  natalTransit: { ts: "Types.NatalTransitInput & Types.VedicMomentSettings", builder: "qNatalTransit", required: true },
  instant: { ts: "Types.InstantInput & Types.VedicMomentSettings", builder: "qInstant", required: false },
  none: { ts: "", builder: "qNone", required: false },
  custom: { ts: "", builder: "qNone", required: false },
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function tsType(t) {
  return t === "number" || t === "integer" ? "number" : t === "boolean" ? "boolean" : "string";
}
function jsdoc(text) {
  return `  /** ${String(text).replace(/\*\//g, "*\\/").trim()} */`;
}

// ---------------------------------------------------------------------------
// Build a single method's source.
// ---------------------------------------------------------------------------
function buildMethod(e) {
  const { method } = e._resolved;
  const shapeCfg = SHAPES[e.shape];
  if (!shapeCfg) throw new Error(`Unknown shape "${e.shape}" for ${e.path}`);

  const pp = e.pathParams ?? [];
  const extras = e.extras ?? [];

  const ppFields = pp.map((n) => `${n}: ${n === "n" || n === "number" ? "number | string" : "string"}`);
  const extraFields = extras.map((x) => {
    const name = x.name ?? camel(x.wire);
    return `${name}${x.required ? "" : "?"}: ${tsType(x.type)}`;
  });

  const typeParts = [];
  if (shapeCfg.ts) typeParts.push(shapeCfg.ts);
  if (ppFields.length || extraFields.length) {
    typeParts.push(`{ ${[...ppFields, ...extraFields].join("; ")} }`);
  }
  const inputType = typeParts.length ? typeParts.join(" & ") : "Record<string, never>";

  const hasRequired = shapeCfg.required || extras.some((x) => x.required) || pp.length > 0;
  const inputArg = hasRequired ? `input: ${inputType}` : `input: ${inputType} = {}`;

  // Query expression.
  let qExpr = `q.${shapeCfg.builder}(input)`;
  if (extras.length) {
    const map = [];
    for (const x of extras) {
      const field = x.name ?? camel(x.wire);
      map.push(`[${JSON.stringify(field)}, ${JSON.stringify(x.wire)}]`);
      // The server's localization param is inconsistent: vedic-narrative and
      // report endpoints read `locale`, while horoscope/numerology/western read
      // `lang`. Emit BOTH from the same input so the language option always works.
      if (x.wire === "lang") map.push(`[${JSON.stringify(field)}, "locale"]`);
    }
    qExpr = `q.applyExtras(${qExpr}, input, [${map.join(", ")}])`;
  }

  // Path expression.
  const pathExpr = pp.length
    ? `q.buildPath(${JSON.stringify(e.path)}, input, ${JSON.stringify(pp)})`
    : JSON.stringify(e.path);

  return [
    jsdoc(e.desc ?? e.path),
    `  ${method}<T = unknown>(${inputArg}, opts?: RequestOptions): Promise<T> {`,
    `    return this._c.request<T>(${pathExpr}, ${qExpr}, opts);`,
    `  }`,
  ].join("\n");
}

function classBody(clsEntries) {
  return clsEntries.map(buildMethod).join("\n\n");
}

const FILE_HEADER = `// AUTO-GENERATED by scripts/generate.mjs — do not edit by hand.
// Run \`npm run generate\` to regenerate from the endpoint manifest.
/* eslint-disable */
import * as q from "../params.js";
import type * as Types from "../types.js";
import type { ClientCore } from "../client.js";
import type { RequestOptions } from "../http.js";
`;

// Group by namespace.
const byNs = new Map();
for (const e of entries) {
  const ns = e._resolved.ns;
  if (!byNs.has(ns)) byNs.set(ns, []);
  byNs.get(ns).push(e);
}
for (const list of byNs.values()) {
  list.sort((a, b) => a._resolved.method.localeCompare(b._resolved.method));
}

mkdirSync(OUT, { recursive: true });

// Top-level (flat) namespaces vs the nested `western` family.
const flatNs = [...byNs.keys()].filter((ns) => !ns.startsWith("western")).sort();
const westernChildNs = [...byNs.keys()].filter((ns) => ns.startsWith("western.")).sort();
const hasWesternDirect = byNs.has("western");

const written = [];

// --- flat namespace files ---
for (const ns of flatNs) {
  const cls = pascal(ns);
  const src = `${FILE_HEADER}
export class ${cls} {
  constructor(private readonly _c: ClientCore) {}

${classBody(byNs.get(ns))}
}
`;
  writeFileSync(join(OUT, `${ns}.ts`), src);
  written.push({ ns, cls, file: `${ns}.js`, prop: ns });
}

// --- western (nested) file ---
{
  const childClasses = westernChildNs.map((ns) => {
    const sub = ns.split(".")[1];
    const cls = "Western" + pascal(sub);
    return { ns, sub, cls };
  });

  const childClassSrc = childClasses
    .map(
      (c) => `class ${c.cls} {
  constructor(private readonly _c: ClientCore) {}

${classBody(byNs.get(c.ns))}
}`,
    )
    .join("\n\n");

  const fields = childClasses.map((c) => `  readonly ${c.sub}: ${c.cls};`).join("\n");
  const inits = childClasses.map((c) => `    this.${c.sub} = new ${c.cls}(_c);`).join("\n");
  const directMethods = hasWesternDirect ? "\n\n" + classBody(byNs.get("western")) : "";

  const src = `${FILE_HEADER}
${childClassSrc}

/** Western (tropical) astrology endpoints. */
export class Western {
${fields}

  constructor(private readonly _c: ClientCore) {
${inits}
  }${directMethods}
}
`;
  writeFileSync(join(OUT, "western.ts"), src);
  written.push({ ns: "western", cls: "Western", file: "western.js", prop: "western" });
}

// --- resources index (the Resources base class) ---
written.sort((a, b) => a.prop.localeCompare(b.prop));
const imports = written.map((w) => `import { ${w.cls} } from "./${w.file}";`).join("\n");
const fields = written.map((w) => `  readonly ${w.prop}: ${w.cls};`).join("\n");
const inits = written.map((w) => `    this.${w.prop} = new ${w.cls}(core);`).join("\n");

const indexSrc = `// AUTO-GENERATED by scripts/generate.mjs — do not edit by hand.
/* eslint-disable */
import type { ClientCore } from "../client.js";
${imports}

/**
 * All resource namespaces, instantiated against a {@link ClientCore}. The
 * {@link LifeAstro} client extends this so namespaces are available as
 * \`client.panchang\`, \`client.chart\`, \`client.western.natal\`, etc.
 */
export class Resources {
${fields}

  constructor(core: ClientCore) {
${inits}
  }
}
`;
writeFileSync(join(OUT, "index.ts"), indexSrc);

const total = entries.length;
const methodCount = [...byNs.values()].reduce((n, l) => n + l.length, 0);
console.log(`Generated ${written.length} namespace files, ${methodCount} methods (${total} endpoints).`);
console.log("Namespaces:", written.map((w) => w.prop).join(", "));
