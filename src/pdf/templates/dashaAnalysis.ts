/**
 * Dasha Analysis report → HTML.
 *
 * Ported from the server-side Go template `internal/pdf/dasha_analysis.go`
 * (the 20-page Vimshottari deep-dive). Section render order mirrors the Go
 * template exactly:
 *   1. Cover
 *   2. Currently Active Dasha Stack (5-level MD/AD/PD/SD/Prana)
 *   3. Predictions for the active sub-periods (MD + AD prose) — suppressed
 *      entirely when there is no active path
 *   4. All 9 Mahadashas (120-year cycle)
 *   5. Past 20-Year Review
 *   6. Next 10-Year Preview
 *   7. Yogini Dasha (optional secondary system; suppressed when empty)
 *
 * Consumes the JSON exactly as returned by `client.reports.dashaAnalysis`.
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

/**
 * One dasha period at any depth (Mahadasha, Antardasha, or Yogini period).
 * Mirrors the Go `DashaPeriodView` struct — all keys PascalCase (no json tags).
 */
export interface DashaPeriodView {
  /** Canonical English lord name, e.g. "Saturn". */
  Lord?: string;
  /** Devanagari lord name, e.g. "शनि" (used for hi/mr). */
  LordHI?: string;
  /** Pre-formatted start date "YYYY-MM-DD". */
  StartDate?: string;
  /** Pre-formatted end date "YYYY-MM-DD". */
  EndDate?: string;
  /** Rounded year count; 0 for sub-year periods. */
  DurationY?: number;
  /** Exact day count for sub-year reporting. */
  DurationD?: number;
  /** Optional locale-resolved one-line note. */
  Body?: string;
}

/**
 * The active 5-level Vimshottari stack at the report's "now".
 * Mirrors the Go `DashaActivePath` struct.
 */
export interface DashaActivePath {
  Maha?: DashaPeriodView;
  Antar?: DashaPeriodView;
  Pratyantar?: DashaPeriodView;
  Sookshma?: DashaPeriodView;
  Prana?: DashaPeriodView;
  /** Longer-form prose summary for the Mahadasha level. */
  MahaBody?: string;
  /** Longer-form prose summary for the Antardasha level. */
  AntarBody?: string;
}

/** Subject block (shared `KundliSubject` shape, PascalCase). */
export interface DashaAnalysisSubject {
  Name?: string;
  BirthDate?: string;
  BirthTime?: string;
  BirthPlace?: string;
  Lat?: number;
  Lon?: number;
}

/** The Dasha Analysis report JSON (`data` from the API), PascalCase keys. */
export interface DashaAnalysisData {
  Locale?: string;
  Branding?: RawBranding;
  Subject?: DashaAnalysisSubject;
  /** Currently-running 5-level Vimshottari stack. May be absent/null. */
  ActivePath?: DashaActivePath | null;
  /** All 9 Vimshottari Mahadashas, chronological. */
  AllMahadashas?: DashaPeriodView[];
  /** Mahadashas overlapping the last 20 years. */
  PastReview?: DashaPeriodView[];
  /** Antardashas overlapping the next 10 years. */
  FuturePreview?: DashaPeriodView[];
  /** Optional Yogini-system periods. */
  YoginiDashas?: DashaPeriodView[];
  /** ISO timestamp; pre-formatted on the server. */
  GeneratedAt?: string;
}

/**
 * i18n strings, ported verbatim from `dashaAnalysisLabels` in the Go file.
 */
const LABELS: Record<string, Record<string, string>> = {
  en: {
    title_dasha: "Dasha Analysis",
    subtitle_dasha: "Vimshottari deep-dive — past, present, and future periods",
    born: "Born",
    at: "at",
    generated: "Generated on",
    section_active: "Currently Active Dasha Stack",
    section_predictions: "Predictions for the Active Sub-Periods",
    section_all_md: "All 9 Mahadashas (120-year cycle)",
    section_past: "Past 20-Year Review",
    section_future: "Next 10-Year Preview",
    section_yogini: "Yogini Dasha (Secondary System)",
    active_intro:
      "These five levels of dasha are running concurrently right now. The outer Mahadasha sets the broad theme; each inner level adds finer-grained timing.",
    active_unavailable:
      "The active dasha stack is not available for this chart configuration.",
    past_intro:
      "Mahadasha periods that overlapped the last 20 years — useful for retrospective context.",
    past_none:
      "No Mahadasha period from the last 20 years is available for this chart.",
    future_intro:
      "Antardasha periods inside the upcoming 10 years — finer granularity than the Mahadasha view for near-term planning.",
    future_none: "No future dasha periods are available for the next 10 years.",
    yogini_intro:
      "Yogini Dasha is an 8-period secondary system used alongside Vimshottari for cross-validation of timing.",
    md_unavailable: "The Mahadasha sequence is not available for this chart.",
    lvl_maha: "Mahadasha",
    lvl_antar: "Antardasha",
    lvl_pratyantar: "Pratyantardasha",
    lvl_sookshma: "Sookshma Dasha",
    lvl_prana: "Prana Dasha",
    th_lord: "Lord",
    th_start: "Start",
    th_end: "End",
    th_duration: "Duration",
    years: "years",
  },
  hi: {
    title_dasha: "दशा विश्लेषण",
    subtitle_dasha: "विंशोत्तरी गहन विवरण — भूत, वर्तमान एवं भविष्य की दशाएँ",
    born: "जन्म",
    at: "समय",
    generated: "तैयार",
    section_active: "वर्तमान सक्रिय दशा-स्तर",
    section_predictions: "सक्रिय उप-दशाओं के लिए भविष्यवाणी",
    section_all_md: "सभी 9 महादशाएँ (120-वर्षीय चक्र)",
    section_past: "विगत 20-वर्षीय समीक्षा",
    section_future: "आगामी 10-वर्षीय पूर्वावलोकन",
    section_yogini: "योगिनी दशा (द्वितीयक प्रणाली)",
    active_intro:
      "इस समय ये पाँच दशा-स्तर एक साथ चल रहे हैं। बाहरी महादशा व्यापक भाव निर्धारित करती है; प्रत्येक भीतरी स्तर सूक्ष्मतर समय-निर्धारण देता है।",
    active_unavailable: "इस कुंडली के लिए सक्रिय दशा-स्तर उपलब्ध नहीं है।",
    past_intro: "विगत 20 वर्षों में आ चुकी महादशाएँ — पूर्वावलोकन के लिए उपयोगी।",
    past_none: "इस कुंडली के लिए विगत 20 वर्षों की कोई महादशा उपलब्ध नहीं है।",
    future_intro:
      "आगामी 10 वर्षों की अंतर्दशाएँ — समीप-समय की योजना के लिए महादशा से अधिक सूक्ष्म दृष्टि।",
    future_none: "आगामी 10 वर्षों की कोई दशा उपलब्ध नहीं है।",
    yogini_intro:
      "योगिनी दशा एक 8-काल वाली द्वितीयक प्रणाली है, जिसका उपयोग विंशोत्तरी के साथ समय-निर्धारण की पुष्टि के लिए किया जाता है।",
    md_unavailable: "इस कुंडली के लिए महादशा क्रम उपलब्ध नहीं है।",
    lvl_maha: "महादशा",
    lvl_antar: "अंतर्दशा",
    lvl_pratyantar: "प्रत्यंतर्दशा",
    lvl_sookshma: "सूक्ष्म दशा",
    lvl_prana: "प्राण दशा",
    th_lord: "स्वामी",
    th_start: "प्रारम्भ",
    th_end: "समाप्ति",
    th_duration: "अवधि",
    years: "वर्ष",
  },
  mr: {
    title_dasha: "दशा विश्लेषण",
    subtitle_dasha: "विंशोत्तरी सखोल विवेचन — भूत, वर्तमान आणि भविष्य काल",
    born: "जन्म",
    at: "वेळ",
    generated: "तयार",
    section_active: "सध्याची सक्रिय दशा-पातळी",
    section_predictions: "सक्रिय उप-दशांसाठी भाकीत",
    section_all_md: "सर्व 9 महादशा (120-वर्ष चक्र)",
    section_past: "मागील 20-वर्ष आढावा",
    section_future: "पुढील 10-वर्ष पूर्वावलोकन",
    section_yogini: "योगिनी दशा (दुय्यम प्रणाली)",
    active_intro:
      "सध्या या पाच दशा-पातळ्या एकत्र चालू आहेत. बाह्य महादशा सर्वसाधारण भाव ठरवते; प्रत्येक आतील पातळी अधिक सूक्ष्म वेळ देते.",
    active_unavailable: "या कुंडलीसाठी सक्रिय दशा-पातळी उपलब्ध नाही.",
    past_intro: "मागील 20 वर्षांत आलेल्या महादशा — पूर्वावलोकनासाठी उपयुक्त.",
    past_none: "या कुंडलीसाठी मागील 20 वर्षांची कोणतीही महादशा उपलब्ध नाही.",
    future_intro:
      "पुढील 10 वर्षांच्या अंतर्दशा — जवळच्या काळाच्या नियोजनासाठी महादशेपेक्षा अधिक सूक्ष्म दृष्टी.",
    future_none: "पुढील 10 वर्षांची कोणतीही दशा उपलब्ध नाही.",
    yogini_intro:
      "योगिनी दशा ही 8-कालिक दुय्यम प्रणाली आहे, जी विंशोत्तरीसोबत वेळेच्या पडताळणीसाठी वापरली जाते.",
    md_unavailable: "या कुंडलीसाठी महादशा क्रम उपलब्ध नाही.",
    lvl_maha: "महादशा",
    lvl_antar: "अंतर्दशा",
    lvl_pratyantar: "प्रत्यंतर्दशा",
    lvl_sookshma: "सूक्ष्म दशा",
    lvl_prana: "प्राण दशा",
    th_lord: "अधिपती",
    th_start: "प्रारंभ",
    th_end: "समाप्ती",
    th_duration: "कालावधी",
    years: "वर्षे",
  },
};

/** Report-specific CSS, ported from the Go template's <style> block. */
const EXTRA_CSS = `
.cover h1 { font-size: 32pt; font-weight: 700; letter-spacing: 1pt; margin: 0 0 4mm; }
.cover .subtitle { color: var(--brand-secondary); font-size: 14pt; margin-bottom: 14mm; font-style: italic; }
.cover .subject { font-size: 18pt; margin-bottom: 4mm; font-weight: 600; }
.section { page-break-before: always; margin-top: 4mm; }
.section.first { page-break-before: auto; }
.stack-row {
  display: flex; justify-content: space-between; align-items: baseline;
  padding: 3mm 4mm; margin: 2mm 0; background: #f5f7fa;
  border-left: 4px solid var(--brand-primary);
}
.stack-row.level-1 { background: #e0f2fe; border-left-color: #0369a1; }
.stack-row.level-2 { background: #ecfccb; border-left-color: #65a30d; }
.stack-row.level-3 { background: #fef9c3; border-left-color: #ca8a04; }
.stack-row.level-4 { background: #fed7aa; border-left-color: #ea580c; }
.stack-row.level-5 { background: #fecaca; border-left-color: #dc2626; }
.stack-row .level-label { font-weight: 600; width: 30mm; flex-shrink: 0; }
.stack-row .lord-name { font-weight: 700; font-size: 12pt; flex: 1; }
.stack-row .dates { color: var(--brand-secondary); font-size: 10pt; text-align: right; }
.prediction-block {
  margin: 4mm 0; padding: 4mm 5mm; background: #f0fdf4;
  border-left: 4px solid #16a34a; page-break-inside: avoid;
}
.prediction-block .lord-line { font-size: 13pt; font-weight: 700; color: var(--brand-primary); margin-bottom: 2mm; }
.timeline-block {
  margin: 3mm 0; padding: 3mm 4mm; background: #fafafa;
  border-left: 3px solid var(--brand-secondary); page-break-inside: avoid;
}
.timeline-block.current { background: #f0fdf4; border-left-color: #16a34a; }
.timeline-block .header { display: flex; justify-content: space-between; align-items: baseline; }
.timeline-block .lord { font-weight: 700; font-size: 12pt; color: var(--brand-primary); }
.timeline-block .dates { color: var(--brand-secondary); font-size: 10pt; }
.timeline-block .body { margin-top: 1mm; font-size: 10pt; }
.empty-list { margin: 3mm 0; color: var(--brand-secondary); font-style: italic; }
`;

/** Resolve a period's lord name for the locale (Devanagari for hi/mr). */
function periodLord(period: DashaPeriodView | undefined, locale: string): string {
  if (!period) return "";
  if ((locale === "hi" || locale === "mr") && period.LordHI) return period.LordHI;
  return period.Lord ?? "";
}

/** One row of the active 5-level stack. */
function stackRow(
  level: number,
  label: string,
  period: DashaPeriodView | undefined,
  locale: string,
): string {
  return `<div class="stack-row level-${level}">
  <span class="level-label">${esc(label)}</span>
  <span class="lord-name">${esc(periodLord(period, locale))}</span>
  <span class="dates">${esc(period?.StartDate)} → ${esc(period?.EndDate)}</span>
</div>`;
}

/** A Mahadasha/Yogini period table (Lord / Start / End / Duration). */
function periodTable(
  rows: DashaPeriodView[],
  locale: string,
  label: (key: string) => string,
): string {
  const body = rows
    .map(
      (p) => `<tr>
  <td>${esc(periodLord(p, locale))}</td>
  <td>${esc(p.StartDate)}</td>
  <td>${esc(p.EndDate)}</td>
  <td>${esc(p.DurationY ?? 0)} ${esc(label("years"))}</td>
</tr>`,
    )
    .join("\n");
  return `<table>
  <thead>
    <tr>
      <th>${esc(label("th_lord"))}</th>
      <th>${esc(label("th_start"))}</th>
      <th>${esc(label("th_end"))}</th>
      <th>${esc(label("th_duration"))}</th>
    </tr>
  </thead>
  <tbody>
${body}
  </tbody>
</table>`;
}

/** A timeline block list (Past Review / Future Preview). */
function timelineBlocks(rows: DashaPeriodView[], locale: string): string {
  return rows
    .map((p) => {
      const bodyHtml = p.Body ? `<div class="body">${esc(p.Body)}</div>` : "";
      return `<div class="timeline-block">
  <div class="header">
    <span class="lord">${esc(periodLord(p, locale))}</span>
    <span class="dates">${esc(p.StartDate)} → ${esc(p.EndDate)}</span>
  </div>
  ${bodyHtml}
</div>`;
    })
    .join("\n");
}

/**
 * Render the Dasha Analysis report as a complete, self-contained HTML document
 * ready to convert to PDF.
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

export function renderDashaAnalysisHtml(
  data: DashaAnalysisData,
  branding?: Branding,
): string {
  const locale =
    data.Locale && LABELS[data.Locale] ? data.Locale : "en";
  const label = makeLabeler(LABELS, locale);
  const b = resolveBranding(data.Branding, branding);
  const subject = data.Subject ?? {};
  const active = data.ActivePath ?? undefined;

  // --- Cover ---
  const generatedLine = data.GeneratedAt
    ? `<div class="generated">${esc(label("generated"))} ${esc(formatGenerated(data.GeneratedAt))}</div>`
    : "";
  const cover = `<section class="cover">
${coverBrandingHtml(b)}
  <h1>${esc(label("title_dasha"))}</h1>
  <div class="subtitle">${esc(label("subtitle_dasha"))}</div>
  <div class="subject">${esc(subject.Name)}</div>
  <div class="meta">
    ${esc(label("born"))} ${esc(subject.BirthDate)} ${esc(label("at"))} ${esc(subject.BirthTime)}<br>
    ${esc(subject.BirthPlace)}
  </div>
  ${generatedLine}
</section>`;

  // --- Section 1: Active Stack ---
  let activeSection: string;
  if (active) {
    activeSection = `<section class="section first">
  <h2>${esc(label("section_active"))}</h2>
  <p>${esc(label("active_intro"))}</p>
${stackRow(1, label("lvl_maha"), active.Maha, locale)}
${stackRow(2, label("lvl_antar"), active.Antar, locale)}
${stackRow(3, label("lvl_pratyantar"), active.Pratyantar, locale)}
${stackRow(4, label("lvl_sookshma"), active.Sookshma, locale)}
${stackRow(5, label("lvl_prana"), active.Prana, locale)}
</section>`;
  } else {
    activeSection = `<section class="section first">
  <h2>${esc(label("section_active"))}</h2>
  <p class="empty-list">${esc(label("active_unavailable"))}</p>
</section>`;
  }

  // --- Section 2: Predictions (only when an active path exists) ---
  let predictionsSection = "";
  if (active) {
    const blocks: string[] = [];
    if (active.MahaBody) {
      blocks.push(`<div class="prediction-block">
  <div class="lord-line">${esc(label("lvl_maha"))}: ${esc(periodLord(active.Maha, locale))}</div>
  <p>${esc(active.MahaBody)}</p>
</div>`);
    }
    if (active.AntarBody) {
      blocks.push(`<div class="prediction-block">
  <div class="lord-line">${esc(label("lvl_antar"))}: ${esc(periodLord(active.Antar, locale))}</div>
  <p>${esc(active.AntarBody)}</p>
</div>`);
    }
    predictionsSection = `<section class="section">
  <h2>${esc(label("section_predictions"))}</h2>
${blocks.join("\n")}
</section>`;
  }

  // --- Section 3: All Mahadashas ---
  const allMd = Array.isArray(data.AllMahadashas) ? data.AllMahadashas : [];
  const allMdSection = `<section class="section">
  <h2>${esc(label("section_all_md"))}</h2>
  ${
    allMd.length
      ? periodTable(allMd, locale, label)
      : `<p class="empty-list">${esc(label("md_unavailable"))}</p>`
  }
</section>`;

  // --- Section 4: Past Review ---
  const past = Array.isArray(data.PastReview) ? data.PastReview : [];
  const pastSection = `<section class="section">
  <h2>${esc(label("section_past"))}</h2>
  ${
    past.length
      ? `<p>${esc(label("past_intro"))}</p>\n${timelineBlocks(past, locale)}`
      : `<p class="empty-list">${esc(label("past_none"))}</p>`
  }
</section>`;

  // --- Section 5: Future Preview ---
  const future = Array.isArray(data.FuturePreview) ? data.FuturePreview : [];
  const futureSection = `<section class="section">
  <h2>${esc(label("section_future"))}</h2>
  ${
    future.length
      ? `<p>${esc(label("future_intro"))}</p>\n${timelineBlocks(future, locale)}`
      : `<p class="empty-list">${esc(label("future_none"))}</p>`
  }
</section>`;

  // --- Section 6: Yogini (only when non-empty) ---
  const yogini = Array.isArray(data.YoginiDashas) ? data.YoginiDashas : [];
  const yoginiSection = yogini.length
    ? `<section class="section">
  <h2>${esc(label("section_yogini"))}</h2>
  <p>${esc(label("yogini_intro"))}</p>
${periodTable(yogini, locale, label)}
</section>`
    : "";

  const bodyHtml = [
    cover,
    activeSection,
    predictionsSection,
    allMdSection,
    pastSection,
    futureSection,
    yoginiSection,
  ]
    .filter((s) => s !== "")
    .join("\n");

  return layoutDocument({
    lang: locale,
    title: `${label("title_dasha")} — ${subject.Name ?? ""}`,
    branding: b,
    bodyHtml,
    extraCss: EXTRA_CSS,
  });
}
