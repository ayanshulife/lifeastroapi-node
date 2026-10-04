/**
 * Shared building blocks for the report → HTML templates.
 *
 * These templates are ported from the LifeAstroAPI server-side Go templates
 * (`internal/pdf/*.go`) so the SDK-rendered PDF looks identical to the
 * design the API was built to produce. Each `render*Html` function consumes
 * the JSON exactly as returned by `client.reports.*` and emits a
 * self-contained HTML document ready to convert to PDF (see `htmlToPdf`).
 */

/** Branding overrides supplied by the SDK caller (camelCase, all optional). */
export interface Branding {
  companyName?: string;
  /** Logo image URL (or a `data:` URI). Rendered at the top of the cover. */
  logoUrl?: string;
  /** Primary accent color (headings, table headers). */
  primaryColor?: string;
  /** Secondary color (meta text, footer). */
  secondaryColor?: string;
  /** Footer line printed on every page. */
  footerText?: string;
  /** Diagonal watermark text (e.g. "DRAFT", "SAMPLE"). */
  watermarkText?: string;
}

/** Branding as it appears in the API JSON (`data.Branding`, PascalCase). */
export interface RawBranding {
  CompanyName?: string;
  LogoURL?: string;
  PrimaryColor?: string;
  SecondaryColor?: string;
  FooterText?: string;
  WatermarkText?: string;
}

/** Fully resolved branding with defaults applied. */
export interface ResolvedBranding {
  companyName: string;
  logoUrl: string;
  primaryColor: string;
  secondaryColor: string;
  footerText: string;
  watermarkText: string;
}

const DEFAULT_PRIMARY = "#1a1a1a";
const DEFAULT_SECONDARY = "#666666";
const DEFAULT_FOOTER = "Generated using LifeAstroAPI";

function firstNonEmpty(...vals: Array<string | undefined>): string {
  for (const v of vals) if (typeof v === "string" && v.trim() !== "") return v;
  return "";
}

/**
 * Merge caller-supplied branding over the branding embedded in the report
 * JSON, then apply sensible defaults. Caller overrides win per-field.
 */
export function resolveBranding(raw?: RawBranding, override?: Branding): ResolvedBranding {
  return {
    companyName: firstNonEmpty(override?.companyName, raw?.CompanyName),
    logoUrl: safeUrl(firstNonEmpty(override?.logoUrl, raw?.LogoURL)),
    primaryColor: safeColor(firstNonEmpty(override?.primaryColor, raw?.PrimaryColor), DEFAULT_PRIMARY),
    secondaryColor: safeColor(firstNonEmpty(override?.secondaryColor, raw?.SecondaryColor), DEFAULT_SECONDARY),
    footerText: firstNonEmpty(override?.footerText, raw?.FooterText, DEFAULT_FOOTER),
    watermarkText: firstNonEmpty(override?.watermarkText, raw?.WatermarkText),
  };
}

// A CSS color value goes UNESCAPED into a `:root { --brand-primary: X }` rule,
// so HTML-escaping is the wrong (and insufficient) tool — a value like
// `red}body{display:none` would inject CSS. Validate against the safe color
// grammar and fall back to the default on any mismatch.
const SAFE_COLOR =
  /^(#([0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})|[a-zA-Z]+|(?:rgb|rgba|hsl|hsla)\([0-9.,%/\s]+\))$/;

function safeColor(value: string, fallback: string): string {
  const v = value.trim();
  return SAFE_COLOR.test(v) ? v : fallback;
}

// `logoUrl` is rendered into `<img src>` and fetched by Chromium at PDF time.
// Allow only safe schemes — http(s), `data:image/...`, and relative /
// protocol-relative URLs — and drop anything else (`javascript:`, `file:`,
// `blob:`, `data:text/html`, …) by returning "" so the logo is simply omitted.
// NOTE: this does NOT prevent SSRF to an internal host over http(s); when
// rendering PDFs server-side from untrusted branding, run Puppeteer with
// restricted network egress.
function safeUrl(value: string): string {
  const v = value.trim();
  if (v === "") return "";
  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(v);
  if (!scheme) return v; // relative ("/logo.png") or protocol-relative ("//cdn/logo.png")
  const s = (scheme[1] as string).toLowerCase();
  if (s === "http" || s === "https") return v;
  if (/^data:image\//i.test(v)) return v;
  return "";
}

/**
 * Escape a string for safe interpolation inside a CSS string literal (e.g. the
 * watermark `content: "…"`). HTML-escaping is insufficient here: a stray `"` or
 * trailing `\` can break out of the CSS string. We hex-escape `\ " < >` (the
 * last two also prevent a literal `</style>` inside the raw-text element) and
 * drop control characters / line separators.
 */
export function cssString(value: unknown): string {
  if (value === null || value === undefined) return "";
  return String(value)
    .replace(/[\\"<>]/g, (c) => "\\" + c.charCodeAt(0).toString(16) + " ")
    .replace(/[\u0000-\u001F\u2028\u2029]/g, " ");
}

const ESC: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

/**
 * Strip "AI-tell" punctuation that readers associate with machine-generated
 * text — em-dash (—), en-dash (–) and arrows (→ ⟶ -> →) — replacing them with
 * a natural comma. Works for ALL languages (Devanagari, Latin, etc.). Also
 * tidies the artefacts the swap can create (double commas, comma-before-comma,
 * spaces before commas, a trailing/leading comma).
 */
export function humanize(text: string): string {
  // Leave a standalone dash placeholder ("—" meaning "no value") untouched.
  if (text.trim() === "—" || text.trim() === "–") return text;
  let s = text
    // arrows → comma
    .replace(/\s*(?:⟶|⇒|→|->|=>)\s*/g, ", ")
    // em / en dash used IN PROSE (text on at least one side) → comma. A lone
    // dash with only spaces around stays (placeholder cells, date ranges that
    // were intentionally formatted).
    .replace(/(\S)\s*[—–]\s*(\S)/g, "$1, $2")
    .replace(/(\S)\s*[—–]\s*$/g, "$1")
    .replace(/^\s*[—–]\s*(\S)/g, "$1");
  // collapse artefacts
  s = s
    .replace(/\s+,/g, ",") // " ," → ","
    .replace(/,\s*,+/g, ", ") // ", ," / ",," → ", "
    .replace(/,\s*([।.!?])/g, "$1") // ", ।" → "।"  (comma before sentence end)
    .replace(/([(\[])\s*,\s*/g, "$1") // "( ," → "("
    .replace(/\s*,\s*([)\]])/g, "$1") // ", )" → ")"
    .replace(/^\s*,\s*/, "") // leading comma
    .replace(/,\s*$/, ""); // trailing comma
  return s;
}

/**
 * Make an authored narrative BODY read like a warm, second-person consumer
 * reading instead of a clinical astrologer's note:
 *  - strips the repeated "three-levels / astrology is about guidance" filler
 *    paragraph that pads ~2000 rules and says nothing about the person;
 *  - converts the third-person clinical term ("the native" / "जातक" /
 *    "जातक") to second person ("you" / "आप").
 * Locale-aware. Safe to run on any string (no-ops if nothing matches).
 * Apply this to narrative bodies only (not labels/headings).
 */
export function cleanNarrative(text: string, locale = "en"): string {
  let s = text;

  // 1) Strip the boilerplate "philosophy of astrology" filler paragraph(s).
  // Hindi/Marathi: from "वैदिक ज्योतिष में/मध्ये ... तीन स्तरों/स्तरां ..." to
  // the closing "... शास्त्र है।/आहे." sentence.
  // Several filler variants all pivot on "तीन स्तर(ों/ां)" (three levels) and
  // run to a closing aphorism. Strip from the sentence that opens the filler
  // up to that close.
  s = s.replace(
    /(?:वैदिक\s*ज्योतिष|यह\s*कुंडली|यह\s*स्थिति|शास्त्र)[^।]*?तीन\s*स्तर(?:ों|ां)[\s\S]*?(?:शास्त्र\s*है।|शास्त्र\s*आहे\.?|दिशा\s*देने[^।]*।)/g,
    "",
  );
  // Also drop a standalone "(जन्म, दशा और गोचर,) इन तीन स्तरों पर ... ।" clause.
  s = s.replace(/[^।]*इन\s*तीन\s*स्तर(?:ों|ां)[\s\S]*?देख[^।]*।/g, "");
  // English filler ("In Vedic astrology ... three levels ... about guidance.")
  s = s.replace(
    /(In Vedic astrology[^.]*three levels[\s\S]*?(?:guidance\.|direction to life\.))/g,
    "",
  );

  // 2) Third-person clinical term → second person.
  if (locale === "hi") {
    s = s
      .replace(/जातक\s*की/g, "आपकी")
      .replace(/जातक\s*को/g, "आपको")
      .replace(/जातक\s*के/g, "आपके")
      .replace(/जातक\s*का/g, "आपका")
      .replace(/जातक\s*में/g, "आपमें")
      .replace(/जातक\s*पर/g, "आप पर")
      .replace(/जातक\s*स्वयं/g, "आप स्वयं")
      .replace(/जातक/g, "आप");
  } else if (locale === "mr") {
    s = s
      .replace(/जातकाच्या/g, "तुमच्या")
      .replace(/जातकाला/g, "तुम्हाला")
      .replace(/जातकाचे/g, "तुमचे")
      .replace(/जातकाचा/g, "तुमचा")
      .replace(/जातक/g, "तुम्ही");
  } else {
    s = s
      .replace(/\bthe native's\b/g, "your")
      .replace(/\bThe native's\b/g, "Your")
      .replace(/\bthe native\b/g, "you")
      .replace(/\bThe native\b/g, "You")
      .replace(/\bnative's\b/g, "your")
      .replace(/\bnative\b/g, "you");
  }

  // 3) Tidy whitespace the strips can leave (blank lines, leading spaces).
  s = s.replace(/\n{3,}/g, "\n\n").replace(/[ \t]+\n/g, "\n").trim();
  return s;
}

/** HTML-escape a value (after humanizing AI-tell punctuation). `null`/`undefined` → "". */
export function esc(value: unknown): string {
  if (value === null || value === undefined) return "";
  return humanize(String(value)).replace(/[&<>"']/g, (c) => ESC[c] as string);
}

/** HTML-escape a NARRATIVE BODY: clean tone first (locale-aware), then esc. */
export function escBody(value: unknown, locale = "en"): string {
  if (value === null || value === undefined) return "";
  return esc(cleanNarrative(String(value), locale));
}

/** Join a list of strings with a separator, escaping each. */
export function escList(items: unknown, sep = "; "): string {
  if (!Array.isArray(items)) return "";
  return items.map((i) => esc(i)).join(sep);
}

/** Render a number/string, falling back to a dash when empty. */
export function orDash(value: unknown): string {
  const s = esc(value);
  return s === "" ? "—" : s;
}

/**
 * The shared CSS skeleton used by every report (page setup, fonts with full
 * Indic-script coverage, headings, tables, narrative blocks, cover, footer).
 * Report-specific CSS is appended via `extraCss`.
 */
export const BASE_CSS = `
* { box-sizing: border-box; }
html, body {
  font-family: 'Noto Sans', 'Noto Sans Devanagari', 'Noto Sans Tamil',
               'Noto Sans Telugu', 'Noto Sans Bengali', 'Noto Sans Gujarati',
               'Noto Sans Kannada', 'Noto Sans Gurmukhi', sans-serif;
  color: #1a1a1a;
  font-size: 11pt;
  line-height: 1.45;
  margin: 0;
}
@page { size: A4; margin: 18mm 15mm 22mm 15mm; }
h2 {
  color: var(--brand-primary);
  border-bottom: 2px solid var(--brand-primary);
  padding-bottom: 2mm;
  font-size: 16pt;
  margin-top: 8mm;
}
h3 { font-size: 12pt; margin: 6mm 0 2mm; }
p { margin: 2mm 0; }
table { width: 100%; border-collapse: collapse; margin: 4mm 0; }
th, td { text-align: left; padding: 2mm 3mm; border-bottom: 1px solid #e5e5e5; vertical-align: top; }
th { background: var(--brand-primary); color: #fff; font-weight: 600; font-size: 10pt; }
.cover { page-break-after: always; text-align: center; padding: 40mm 0 0; }
.cover img.logo { max-height: 24mm; max-width: 60mm; margin-bottom: 8mm; }
.cover h1 { color: var(--brand-primary); font-size: 28pt; margin: 0 0 4mm; }
.cover .company { color: var(--brand-secondary); font-size: 14pt; margin-bottom: 16mm; }
.cover .subject { font-size: 16pt; margin-bottom: 4mm; }
.cover .meta { color: var(--brand-secondary); font-size: 11pt; }
.cover .generated { margin-top: 32mm; color: var(--brand-secondary); font-size: 9pt; }
.narrative-section { margin-top: 6mm; page-break-inside: avoid; }
.narrative-section .body { margin: 2mm 0; white-space: pre-wrap; }
.narrative-section ul { margin: 1mm 0 2mm 6mm; padding: 0; }
.narrative-section .citations { color: var(--brand-secondary); font-size: 9pt; font-style: italic; }
.cards { display: flex; gap: 4mm; margin: 4mm 0; flex-wrap: wrap; }
.card { flex: 1 1 0; min-width: 40mm; border: 1px solid #e5e5e5; border-radius: 2mm; padding: 3mm; }
.card .label { color: var(--brand-secondary); font-size: 9pt; text-transform: uppercase; letter-spacing: .04em; }
.card .value { font-size: 14pt; color: var(--brand-primary); font-weight: 600; margin-top: 1mm; }
/* On screen the footer is an ordinary block after the content. In print it
   is hidden and the same text is drawn in the page's bottom margin instead
   (see footerCss): a position:fixed footer is laid out against the page
   CONTENT box, so it prints on top of the last lines of body text. */
footer {
  text-align: center; color: var(--brand-secondary); font-size: 8pt;
  margin-top: 10mm;
}
@media print { footer { display: none; } }
`;

function watermarkCss(b: ResolvedBranding): string {
  if (!b.watermarkText) return "";
  return `
body::before {
  content: "${cssString(b.watermarkText)}";
  position: fixed; top: 50%; left: 50%;
  transform: translate(-50%, -50%) rotate(-30deg);
  font-size: 80pt; color: rgba(0,0,0,0.06); font-weight: 700;
  pointer-events: none; z-index: 0;
}`;
}

/**
 * Print the footer line in the bottom page margin of every page, via a CSS
 * page-margin box (Chromium 131+; older engines print no footer rather than
 * a misplaced one). The colour is inlined because custom properties declared
 * on :root do not reach the page context.
 */
function footerCss(b: ResolvedBranding): string {
  if (!b.footerText) return "";
  return `
@page {
  @bottom-center {
    content: "${cssString(b.footerText)}";
    font-family: 'Noto Sans', 'Noto Sans Devanagari', sans-serif;
    font-size: 8pt;
    color: ${cssColor(b.secondaryColor)};
  }
}`;
}

/** A colour safe to inline into CSS; anything unexpected falls back to grey. */
function cssColor(value: string): string {
  return /^(#[0-9a-fA-F]{3,8}|[a-zA-Z]+|rgba?\([0-9.,%\s]+\)|hsla?\([0-9.,%\sdeg]+\))$/.test(value.trim())
    ? value.trim()
    : "#666666";
}

/** The logo + company-name block for a cover page. */
export function coverBrandingHtml(b: ResolvedBranding): string {
  let html = "";
  if (b.logoUrl) html += `<img src="${esc(b.logoUrl)}" alt="" class="logo">`;
  if (b.companyName) html += `<div class="company">${esc(b.companyName)}</div>`;
  return html;
}

/** The footer line shown after the content on screen (print uses footerCss). */
export function footerHtml(b: ResolvedBranding): string {
  return b.footerText ? `<footer>${esc(b.footerText)}</footer>` : "";
}

export interface LayoutOptions {
  lang?: string;
  title: string;
  branding: ResolvedBranding;
  bodyHtml: string;
  extraCss?: string;
  /**
   * Print the footer text in the bottom page margin. Default true. Reports
   * that draw their own running footer (Brihad, via Puppeteer's
   * footerTemplate) pass false so the line is not printed twice.
   */
  pageFooter?: boolean;
}

/**
 * Wrap a report body in a complete, self-contained HTML document: head with
 * brand CSS variables, the shared skeleton, watermark, and any report-specific
 * CSS; body followed by the branded footer.
 */
export function layoutDocument(opts: LayoutOptions): string {
  const { lang = "en", title, branding, bodyHtml, extraCss = "", pageFooter = true } = opts;
  return `<!doctype html>
<html lang="${esc(lang) || "en"}">
<head>
<meta charset="utf-8">
<title>${esc(title)}</title>
<style>
:root { --brand-primary: ${esc(branding.primaryColor)}; --brand-secondary: ${esc(branding.secondaryColor)}; }
${BASE_CSS}
${watermarkCss(branding)}
${pageFooter ? footerCss(branding) : ""}
${extraCss}
</style>
</head>
<body>
${bodyHtml}
${footerHtml(branding)}
</body>
</html>`;
}

/** One authored narrative block, as it appears in report JSON (PascalCase). */
export interface NarrativeSection {
  Heading?: string;
  Body?: string;
  Bullets?: string[];
  Citations?: string[];
}

/** Render a list of authored narrative sections (heading + body + bullets + citations). */
export function narrativeSectionsHtml(
  sections: NarrativeSection[] | undefined,
  sourcesLabel = "Sources",
): string {
  if (!Array.isArray(sections) || sections.length === 0) return "";
  return sections
    .map((s) => {
      const bullets =
        Array.isArray(s.Bullets) && s.Bullets.length
          ? `<ul>${s.Bullets.map((b) => `<li>${esc(b)}</li>`).join("")}</ul>`
          : "";
      const cites =
        Array.isArray(s.Citations) && s.Citations.length
          ? `<div class="citations">${esc(sourcesLabel)}: ${escList(s.Citations)}</div>`
          : "";
      return `<div class="narrative-section"><h3>${esc(s.Heading)}</h3><div class="body">${esc(
        s.Body,
      )}</div>${bullets}${cites}</div>`;
    })
    .join("\n");
}

/** Pick a localized label from a per-locale map, falling back to English. */
export function makeLabeler(
  labels: Record<string, Record<string, string>>,
  locale: string | undefined,
): (key: string) => string {
  const loc = locale && labels[locale] ? locale : "en";
  const table = labels[loc] ?? labels.en ?? {};
  const fallback = labels.en ?? {};
  return (key: string) => table[key] ?? fallback[key] ?? "";
}
