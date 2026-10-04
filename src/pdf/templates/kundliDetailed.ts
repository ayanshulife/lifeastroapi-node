/**
 * Detailed Kundli report → HTML.
 *
 * Ported from the server-side Go template `internal/pdf/kundli.go` so the
 * SDK-rendered PDF is visually faithful to the API's own report. Consumes the
 * JSON returned by `client.reports.kundliDetailed(...)` verbatim (PascalCase
 * top-level keys; snake_case inside placement/panchang — see interfaces below)
 * and returns a self-contained HTML document ready for `htmlToPdf`.
 *
 * The Go template's i18n helpers (signLabel/nakLabel/planetLabel/tithiLabel…)
 * just echo the already-locale-resolved field straight back, so here we read
 * the field directly — no client-side translation is performed.
 */

import {
  esc,
  resolveBranding,
  coverBrandingHtml,
  narrativeSectionsHtml,
  makeLabeler,
  layoutDocument,
  type Branding,
  type NarrativeSection,
} from "../shared.js";
// Mid-tier enrichment: reuse the audited Brihad section labels + helpers + types
// so the Detailed report's dasha/house/yoga/dosha blocks are identical to Brihad
// (one source of truth for those renderers).
import {
  LABELS as BRIHAD_LABELS,
  houseTopic,
  houseLordLabel,
  yogaNameLabel,
  dashaLordLabel,
  severityLabel,
  anyDoshaPresent,
  type BrihadHouseSection,
  type BrihadYoga,
  type BrihadDashaPeriod,
  type BrihadDoshas,
  type BrihadDoshaEntry,
} from "./kundliBrihad.js";

/** A sign + degree pair (snake_case keys, as in the API JSON). */
export interface KundliPlacement {
  sign?: string;
  dms_within?: string;
  nakshatra?: string;
  pada?: number;
  nak_lord?: string;
}

/** One planet row in the positions table. */
export interface KundliPlanet {
  name?: string;
  placement?: KundliPlacement;
  house_num?: number;
  retro?: boolean;
}

/** Tithi / nakshatra / yoga / karana at the moment of birth. */
export interface KundliPanchang {
  tithi?: string;
  nakshatra?: string;
  yoga?: string;
  karana?: string;
}

/** The birth subject metadata printed on the cover. */
export interface KundliSubject {
  Name?: string;
  BirthDate?: string;
  BirthTime?: string;
  BirthPlace?: string;
  Lat?: number;
  Lon?: number;
}

/** Branding embedded in the report JSON (PascalCase). */
export interface KundliBranding {
  CompanyName?: string;
  LogoURL?: string;
  PrimaryColor?: string;
  SecondaryColor?: string;
  FooterText?: string;
  WatermarkText?: string;
}

/** Full Detailed Kundli payload (exactly as returned by the API). */
export interface KundliDetailedData {
  Locale?: string;
  Branding?: KundliBranding;
  Subject?: KundliSubject;
  Ascendant?: KundliPlacement;
  Planets?: KundliPlanet[];
  Panchang?: KundliPanchang;
  GeneratedAt?: string;
  Narratives?: NarrativeSection[];

  // Mid-tier enrichment (present on Detailed, absent on Lite).
  CurrentDasha?: BrihadDashaPeriod;
  UpcomingDashas?: BrihadDashaPeriod[];
  Houses?: BrihadHouseSection[];
  Yogas?: BrihadYoga[];
  Doshas?: BrihadDoshas | null;
}

/**
 * i18n strings ported verbatim from the Go `kundliLabels` map. A missing key
 * (partially translated locale) degrades to "" via `makeLabeler`, matching the
 * Go template's graceful-degradation behavior.
 */
export const LABELS: Record<string, Record<string, string>> = {
  en: {
    title_kundli: "Detailed Kundli",
    born: "Born",
    at: "at",
    generated: "Generated on",
    section_ascendant: "Ascendant",
    section_planets: "Planetary Positions",
    section_panchang: "Panchang at Birth",
    section_interpretation: "Interpretation",
    ascendant: "Ascendant",
    planet: "Planet",
    sign: "Sign",
    degree: "Degree",
    house: "House",
    nakshatra: "Nakshatra",
    pada: "Pada",
    lord: "Lord",
    tithi: "Tithi",
    yoga: "Yoga",
    karana: "Karana",
    sources: "Sources",
  },
  hi: {
    title_kundli: "विस्तृत कुंडली",
    born: "जन्म",
    at: "समय",
    generated: "तैयार",
    section_ascendant: "लग्न",
    section_planets: "ग्रह स्थिति",
    section_panchang: "जन्म पंचांग",
    section_interpretation: "व्याख्या",
    ascendant: "लग्न",
    planet: "ग्रह",
    sign: "राशि",
    degree: "अंश",
    house: "भाव",
    nakshatra: "नक्षत्र",
    pada: "पाद",
    lord: "स्वामी",
    tithi: "तिथि",
    yoga: "योग",
    karana: "करण",
    sources: "स्रोत",
  },
  mr: {
    title_kundli: "तपशीलवार कुंडली",
    born: "जन्म",
    at: "वेळ",
    generated: "तयार",
    section_ascendant: "लग्न",
    section_planets: "ग्रह स्थिती",
    section_panchang: "जन्म पंचांग",
    section_interpretation: "व्याख्या",
    ascendant: "लग्न",
    planet: "ग्रह",
    sign: "राशी",
    degree: "अंश",
    house: "स्थान",
    nakshatra: "नक्षत्र",
    pada: "चरण",
    lord: "अधिपती",
    tithi: "तिथी",
    yoga: "योग",
    karana: "करण",
    sources: "स्रोत",
  },
};

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

// CSS for the mid-tier enrichment blocks — copied from the Brihad template so
// the dasha/house/yoga/dosha sections render identically.
const MIDTIER_CSS = `
.house-block { margin: 4mm 0; padding: 4mm 5mm; background: #fafafa; border-left: 3px solid var(--brand-primary); page-break-inside: avoid; }
.house-block .meta { color: var(--brand-secondary); font-size: 10pt; margin-bottom: 2mm; }
.yoga-block { margin: 3mm 0; padding: 4mm 5mm; background: #fff7ed; border-left: 3px solid #ea580c; page-break-inside: avoid; }
.yoga-block .name { font-size: 13pt; font-weight: 700; color: #ea580c; margin-bottom: 1mm; }
.yoga-block .source, .dosha-block .source { color: var(--brand-secondary); font-size: 9pt; font-style: italic; margin-top: 2mm; }
.dasha-block { margin: 4mm 0; padding: 5mm; background: #f0fdf4; border-left: 4px solid #16a34a; page-break-inside: avoid; }
.dasha-block.upcoming { background: #fafafa; border-left-color: var(--brand-secondary); }
.dasha-block .header-row, .dosha-block .header-row { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 2mm; }
.dasha-block .lord { font-size: 14pt; font-weight: 700; color: var(--brand-primary); }
.dasha-block .dates { color: var(--brand-secondary); font-size: 10pt; }
.dosha-block { margin: 4mm 0; padding: 4mm 5mm; border-left: 4px solid #b91c1c; background: #fef2f2; page-break-inside: avoid; }
.dosha-block.cancelled { border-left-color: #16a34a; background: #f0fdf4; }
.dosha-block.mild { border-left-color: #ca8a04; background: #fefce8; }
.dosha-block .name { font-size: 13pt; font-weight: 700; color: var(--brand-primary); }
.dosha-block .severity { display: inline-block; padding: 1mm 3mm; font-size: 9pt; font-weight: 600; border-radius: 1mm; color: #fff; background: #b91c1c; }
.dosha-block.cancelled .severity { background: #16a34a; }
.dosha-block.mild .severity { background: #ca8a04; }
.empty-list { margin: 3mm 0; color: var(--brand-secondary); font-style: italic; }
`;

/**
 * Render the Detailed Kundli report as a complete HTML document.
 *
 * @param data     report JSON from `client.reports.kundliDetailed(...)`
 * @param branding optional caller branding overrides (win per-field over the
 *                 branding embedded in `data`)
 */
export function renderKundliDetailedHtml(
  data: KundliDetailedData,
  branding?: Branding,
): string {
  const resolved = resolveBranding(data.Branding, branding);
  const t = makeLabeler(LABELS, data.Locale);

  const subject = data.Subject ?? {};
  const asc = data.Ascendant ?? {};
  const panchang = data.Panchang ?? {};
  const planets = Array.isArray(data.Planets) ? data.Planets : [];

  // Cover page.
  const coverMeta = `${esc(t("born"))} ${esc(subject.BirthDate)} ${esc(t("at"))} ${esc(
    subject.BirthTime,
  )}<br>${esc(subject.BirthPlace)}`;
  const cover = `<section class="cover">
  ${coverBrandingHtml(resolved)}
  <h1>${esc(t("title_kundli"))}</h1>
  <div class="subject">${esc(subject.Name)}</div>
  <div class="meta">${coverMeta}</div>
  <div class="generated">${esc(t("generated"))} ${esc(formatGenerated(data.GeneratedAt))}</div>
</section>`;

  // Ascendant summary line.
  const ascendant = `<h2>${esc(t("section_ascendant"))}</h2>
<p><strong>${esc(t("ascendant"))}:</strong> ${esc(asc.sign)} (${esc(
    asc.dms_within,
  )}) — ${esc(t("nakshatra"))}: ${esc(asc.nakshatra)}, ${esc(t("pada"))} ${esc(
    asc.pada,
  )}, ${esc(t("lord"))} ${esc(asc.nak_lord)}</p>`;

  // Planetary positions table.
  const planetRows = planets
    .map((pl) => {
      const p = pl.placement ?? {};
      const retro = pl.retro ? " (R)" : "";
      return `<tr><td>${esc(pl.name)}${retro}</td><td>${esc(p.sign)}</td><td>${esc(
        p.dms_within,
      )}</td><td>${esc(pl.house_num)}</td><td>${esc(p.nakshatra)} (${esc(
        p.pada,
      )})</td></tr>`;
    })
    .join("");
  const planetsTable = `<h2>${esc(t("section_planets"))}</h2>
<table>
  <thead>
    <tr>
      <th>${esc(t("planet"))}</th>
      <th>${esc(t("sign"))}</th>
      <th>${esc(t("degree"))}</th>
      <th>${esc(t("house"))}</th>
      <th>${esc(t("nakshatra"))}</th>
    </tr>
  </thead>
  <tbody>${planetRows}</tbody>
</table>`;

  // Panchang-at-birth table.
  const panchangTable = `<h2>${esc(t("section_panchang"))}</h2>
<table>
  <tr><th>${esc(t("tithi"))}</th><td>${esc(panchang.tithi)}</td></tr>
  <tr><th>${esc(t("nakshatra"))}</th><td>${esc(panchang.nakshatra)}</td></tr>
  <tr><th>${esc(t("yoga"))}</th><td>${esc(panchang.yoga)}</td></tr>
  <tr><th>${esc(t("karana"))}</th><td>${esc(panchang.karana)}</td></tr>
</table>`;

  // Authored interpretation sections (optional).
  let narratives = "";
  if (Array.isArray(data.Narratives) && data.Narratives.length > 0) {
    narratives = `<h2>${esc(t("section_interpretation"))}</h2>
${narrativeSectionsHtml(data.Narratives, t("sources"))}`;
  }

  // --- Mid-tier enrichment: dasha + houses + yogas + doshas. Reuses the
  // Brihad labels + helpers so these blocks are visually identical to Brihad. ---
  const loc = data.Locale ?? "en";
  const bl = makeLabeler(BRIHAD_LABELS, data.Locale);
  const houses = Array.isArray(data.Houses) ? data.Houses : [];
  const yogas = Array.isArray(data.Yogas) ? data.Yogas : [];
  const upcoming = Array.isArray(data.UpcomingDashas) ? data.UpcomingDashas : [];

  const housesSection = houses.length
    ? `<h2>${esc(bl("section_houses"))}</h2>\n${houses
        .map((h) => {
          const num = h.HouseNum ?? 0;
          const lordSign = h.LordSign ? ` (${esc(bl("in"))} ${esc(h.LordSign)})` : "";
          const body = h.Body ? `<p>${esc(h.Body)}</p>` : "";
          return `<div class="house-block">
<h3>${esc(bl("house"))} ${esc(num)} — ${esc(houseTopic(loc, num))}</h3>
<div class="meta">${esc(bl("lord"))}: ${esc(houseLordLabel(loc, h))}${lordSign}</div>
${body}
</div>`;
        })
        .join("\n")}`
    : "";

  const yogasSection = yogas.length
    ? `<h2>${esc(bl("section_yogas"))}</h2>\n${yogas
        .map((y) => {
          const src = y.Source ? `<div class="source">${esc(bl("source"))}: ${esc(y.Source)}</div>` : "";
          return `<div class="yoga-block"><div class="name">${esc(yogaNameLabel(loc, y))}</div><p>${esc(
            y.Effect,
          )}</p>${src}</div>`;
        })
        .join("\n")}`
    : "";

  let dashaInner = "";
  const cur = data.CurrentDasha;
  if (cur) {
    dashaInner += `<h3>${esc(bl("current_dasha"))}</h3>
<div class="dasha-block"><div class="header-row"><span class="lord">${esc(
      dashaLordLabel(loc, cur),
    )}</span><span class="dates">${esc(cur.StartDate)} → ${esc(cur.EndDate)} (${esc(cur.DurationY)} ${esc(
      bl("years"),
    )})</span></div><p>${esc(cur.Body)}</p></div>`;
  }
  if (upcoming.length) {
    dashaInner += `\n<h3>${esc(bl("upcoming_dashas"))}</h3>\n${upcoming
      .map(
        (d) => `<div class="dasha-block upcoming"><div class="header-row"><span class="lord">${esc(
          dashaLordLabel(loc, d),
        )}</span><span class="dates">${esc(d.StartDate)} → ${esc(d.EndDate)} (${esc(d.DurationY)} ${esc(
          bl("years"),
        )})</span></div><p>${esc(d.Body)}</p></div>`,
      )
      .join("\n")}`;
  }
  const dashaSection = dashaInner ? `<h2>${esc(bl("section_dashas"))}</h2>\n${dashaInner}` : "";

  let doshasSection = "";
  if (data.Doshas && anyDoshaPresent(data.Doshas)) {
    const dd = data.Doshas;
    const block = (entry: BrihadDoshaEntry | null | undefined, nameKey: string): string => {
      if (!entry) return "";
      const sev = entry.Severity ?? "";
      const src = entry.Source ? `<div class="source">${esc(bl("source"))}: ${esc(entry.Source)}</div>` : "";
      return `<div class="dosha-block ${esc(sev)}"><div class="header-row"><span class="name">${esc(
        bl(nameKey),
      )}</span><span class="severity">${esc(severityLabel(bl, sev))}</span></div><p>${esc(
        entry.Body,
      )}</p>${src}</div>`;
    };
    doshasSection = `<h2>${esc(bl("section_doshas"))}</h2>\n${block(dd.Mangal, "dosha_mangal")}${block(
      dd.KaalSarp,
      "dosha_kaalsarp",
    )}${block(dd.Pitra, "dosha_pitra")}`;
  }

  const bodyHtml = [
    cover,
    ascendant,
    planetsTable,
    housesSection,
    yogasSection,
    dashaSection,
    doshasSection,
    panchangTable,
    narratives,
  ]
    .filter(Boolean)
    .join("\n\n");

  return layoutDocument({
    lang: data.Locale,
    title: `${t("title_kundli")} — ${subject.Name ?? ""}`,
    branding: resolved,
    bodyHtml,
    extraCss: MIDTIER_CSS,
  });
}
