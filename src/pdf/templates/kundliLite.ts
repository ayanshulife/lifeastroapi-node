/**
 * Vedic Birth Chart (Lite) report → HTML.
 *
 * Ported from the LifeAstroAPI server-side Go template
 * (`internal/pdf/kundli_lite.go`). The Lite report is a deliberate subset of
 * the Detailed Kundli: cover page, ascendant + lagna-summary block, and the
 * 9-graha planet positions table. No per-rule narrative sections, panchang,
 * or citations.
 *
 * Consumes the JSON exactly as returned by `client.reports.kundliLite()` and
 * emits a self-contained HTML document ready to convert to PDF.
 */

import {
  esc,
  resolveBranding,
  coverBrandingHtml,
  layoutDocument,
  makeLabeler,
  type Branding,
  type RawBranding,
} from "../shared.js";

/** A single planetary placement (PascalCase struct, snake_case JSON fields). */
export interface KundliLitePlacement {
  sign?: string;
  dms_within?: string;
  nakshatra?: string;
  pada?: number;
  nak_lord?: string;
}

/** One graha row in the planet table. */
export interface KundliLitePlanet {
  name?: string;
  placement?: KundliLitePlacement;
  house_num?: number;
  retro?: boolean;
}

/** Birth subject (reused shape from the Detailed Kundli). */
export interface KundliLiteSubject {
  Name?: string;
  BirthDate?: string;
  BirthTime?: string;
  BirthPlace?: string;
  Lat?: number;
  Lon?: number;
}

/**
 * The Lite report payload, mirroring Go's `KundliLiteReportData`.
 * Top-level + Subject fields are PascalCase (no Go `json:` tag); nested
 * placement fields are snake_case (tagged in KundliPlacement/KundliPlanet).
 */
export interface KundliLiteData {
  Locale?: string;
  Branding?: RawBranding;
  Subject?: KundliLiteSubject;
  Ascendant?: KundliLitePlacement;
  Planets?: KundliLitePlanet[];
  LagnaSummary?: string;
  GeneratedAt?: string;
}

/**
 * i18n strings for the Lite report — ported verbatim from
 * `kundliLiteLabels` in kundli_lite.go.
 */
const LABELS: Record<string, Record<string, string>> = {
  en: {
    title_lite: "Vedic Birth Chart",
    born: "Born",
    at: "at",
    generated: "Generated on",
    section_ascendant: "Ascendant",
    section_planets: "Planetary Positions",
    ascendant: "Ascendant",
    nakshatra: "Nakshatra",
    pada: "Pada",
    lord: "Lord",
    planet: "Planet",
    sign: "Sign",
    degree: "Degree",
    house: "House",
    upsell:
      "For a detailed reading covering yogas, dashas, and remedies, request the Brihad Kundli or Detailed Kundli report.",
  },
  hi: {
    title_lite: "जन्म कुंडली",
    born: "जन्म",
    at: "समय",
    generated: "तैयार",
    section_ascendant: "लग्न",
    section_planets: "ग्रह स्थिति",
    ascendant: "लग्न",
    nakshatra: "नक्षत्र",
    pada: "पाद",
    lord: "स्वामी",
    planet: "ग्रह",
    sign: "राशि",
    degree: "अंश",
    house: "भाव",
    upsell:
      "योग, दशा एवं उपायों सहित विस्तृत विश्लेषण के लिए विस्तृत कुंडली अथवा बृहद् कुंडली रिपोर्ट प्राप्त कीजिए।",
  },
  mr: {
    title_lite: "जन्म कुंडली",
    born: "जन्म",
    at: "वेळ",
    generated: "तयार",
    section_ascendant: "लग्न",
    section_planets: "ग्रह स्थिती",
    ascendant: "लग्न",
    nakshatra: "नक्षत्र",
    pada: "चरण",
    lord: "अधिपती",
    planet: "ग्रह",
    sign: "राशी",
    degree: "अंश",
    house: "स्थान",
    upsell:
      "योग, दशा आणि उपायांसह तपशीलवार विश्लेषणासाठी तपशीलवार कुंडली किंवा बृहद् कुंडली अहवाल मिळवा.",
  },
};

/**
 * Report-specific CSS. The cover, h2, table, th/td, and footer styles already
 * live in BASE_CSS (same class names + values), so only the Lite-unique
 * blocks are emitted here.
 */
const EXTRA_CSS = `
.lagna-summary {
  margin: 4mm 0;
  padding: 5mm;
  background: #fafafa;
  border-left: 3px solid var(--brand-primary);
  font-size: 11pt;
}
.lagna-meta {
  margin: 2mm 0 4mm;
  color: var(--brand-secondary);
  font-size: 10pt;
}
.upsell {
  margin-top: 10mm;
  padding: 4mm;
  background: linear-gradient(to right, rgba(0,0,0,0.02), transparent);
  border-left: 2px solid var(--brand-secondary);
  font-size: 10pt;
  color: var(--brand-secondary);
  font-style: italic;
}
`;

/**
 * Render the Lite Vedic Birth Chart report as a complete HTML document.
 *
 * @param data     The report JSON from `client.reports.kundliLite()`.
 * @param branding Optional caller branding overrides (win per-field over the
 *                 branding embedded in `data.Branding`).
 */
/**
 * Format an ISO-8601 timestamp into the `YYYY-MM-DD HH:MM UTC` shape the Go
 * template produces via `GeneratedAt.Format("2006-01-02 15:04 MST")`. Falls
 * back to the raw string if it isn't parseable.
 */
function formatGenerated(iso?: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} ${p(
    d.getUTCHours(),
  )}:${p(d.getUTCMinutes())} UTC`;
}

export function renderKundliLiteHtml(data: KundliLiteData, branding?: Branding): string {
  const b = resolveBranding(data.Branding, branding);
  const locale = data.Locale || "en";
  const label = makeLabeler(LABELS, locale);

  const subject = data.Subject ?? {};
  const asc = data.Ascendant ?? {};

  // Cover page — logo + company from shared helper, then title/subject/meta.
  const coverHtml = `
<section class="cover">
  ${coverBrandingHtml(b)}
  <h1>${esc(label("title_lite"))}</h1>
  <div class="subject">${esc(subject.Name)}</div>
  <div class="meta">
    ${esc(label("born"))} ${esc(subject.BirthDate)} ${esc(label("at"))} ${esc(subject.BirthTime)}<br>
    ${esc(subject.BirthPlace)}
  </div>
  <div class="generated">
    ${esc(label("generated"))} ${esc(formatGenerated(data.GeneratedAt))}
  </div>
</section>`;

  // Ascendant + lagna-summary block. Sign/Nakshatra/Name are already
  // locale-resolved by the server, so fields are read directly.
  const lagnaSummaryHtml = data.LagnaSummary
    ? `<div class="lagna-summary">${esc(data.LagnaSummary)}</div>`
    : "";

  const ascendantHtml = `
<h2>${esc(label("section_ascendant"))}</h2>
<p class="lagna-meta">
  <strong>${esc(label("ascendant"))}:</strong>
  ${esc(asc.sign)} (${esc(asc.dms_within)})<br>
  <strong>${esc(label("nakshatra"))}:</strong>
  ${esc(asc.nakshatra)}, ${esc(label("pada"))} ${esc(asc.pada)},
  ${esc(label("lord"))} ${esc(asc.nak_lord)}
</p>
${lagnaSummaryHtml}`;

  // Planet positions table.
  const planets = Array.isArray(data.Planets) ? data.Planets : [];
  const rows = planets
    .map((pl) => {
      const p = pl.placement ?? {};
      const retro = pl.retro ? " (R)" : "";
      return `    <tr>
      <td>${esc(pl.name)}${retro}</td>
      <td>${esc(p.sign)}</td>
      <td>${esc(p.dms_within)}</td>
      <td>${esc(pl.house_num)}</td>
      <td>${esc(p.nakshatra)} (${esc(p.pada)})</td>
    </tr>`;
    })
    .join("\n");

  const planetsHtml = `
<h2>${esc(label("section_planets"))}</h2>
<table>
  <thead>
    <tr>
      <th>${esc(label("planet"))}</th>
      <th>${esc(label("sign"))}</th>
      <th>${esc(label("degree"))}</th>
      <th>${esc(label("house"))}</th>
      <th>${esc(label("nakshatra"))}</th>
    </tr>
  </thead>
  <tbody>
${rows}
  </tbody>
</table>`;

  // Upsell nudge toward the higher-tier products.
  const upsellHtml = `<div class="upsell">${esc(label("upsell"))}</div>`;

  const bodyHtml = `${coverHtml}
${ascendantHtml}
${planetsHtml}
${upsellHtml}`;

  return layoutDocument({
    lang: locale,
    title: `${label("title_lite")} — ${subject.Name ?? ""}`,
    branding: b,
    bodyHtml,
    extraCss: EXTRA_CSS,
  });
}
