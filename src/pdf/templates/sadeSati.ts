/**
 * Sade Sati report → HTML.
 *
 * Ported from the server-side Go template `internal/pdf/sadesati.go`. Renders a
 * single-subject report focused on Saturn's ~7.5-year transit through the
 * moon-1 / moon / moon+1 sign cluster of the native's chart.
 *
 * Layout (mirrors the Go template):
 *   1. Cover with subject + moon-sign badge + current status.
 *   2. Current phase explanation block (color-coded by status).
 *   3. Past windows table (chronological).
 *   4. Current window highlight (when active).
 *   5. Future windows table (chronological).
 *   6. Remedies summary block.
 *
 * The Go i18n helpers (`label`, `statusLabel`, `durationLabel`,
 * `statusDescription`, `remediesList`) and the `moon_sign`/`saturn_sign`
 * fields are already locale-resolved by the API handler, so the strings are
 * rendered verbatim — we only re-implement the locale-keyed label/prose tables.
 */

import {
  esc,
  resolveBranding,
  coverBrandingHtml,
  layoutDocument,
  type Branding,
  type RawBranding,
} from "../shared.js";

// ---------------------------------------------------------------------------
// JSON shapes (exact keys as returned by `client.reports.sadeSati`)
// ---------------------------------------------------------------------------

/**
 * Cover-page header info. `MoonSign` is pre-resolved to the request locale by
 * the handler. JSON keys are lowercase (the Go struct carries `json:` tags).
 */
export interface SadeSatiSubject {
  name?: string;
  birth_date?: string;
  birth_time?: string;
  birth_place?: string;
  moon_sign?: string;
}

/**
 * The current at-the-moment reading. `status` is one of
 * `"rising" | "peak" | "setting" | "clear"`. `saturn_sign` / `moon_sign` are
 * pre-resolved to the request locale. JSON keys are lowercase (`json:` tags).
 */
export interface SadeSatiStatus {
  status?: string;
  saturn_sign?: string;
  moon_sign?: string;
}

/**
 * One continuous Sade Sati period (Saturn passing through one or more affected
 * signs). The `SadeSatiWindow` Go struct has NO `json:` tags, so every key is
 * PascalCase. Date strings are pre-formatted by the handler.
 */
export interface SadeSatiWindow {
  StartDate?: string;
  EndDate?: string;
  StartPhase?: string;
  EndPhase?: string;
  /** Localized sign labels Saturn passed through (typically the 3-sign cluster). */
  SignsTraversed?: string[];
  /** "approx 7.5" for full windows, less for retrograde-truncated edges. */
  DurationYears?: number;
}

/**
 * Full Sade Sati report payload. Top-level `SadeSatiReportData` Go struct has
 * NO `json:` tags, so its fields are PascalCase. `Past` may be `null`, and
 * `Current` is `null` when no window brackets the report moment.
 */
export interface SadeSatiData {
  Locale?: string;
  Branding?: RawBranding;
  Subject?: SadeSatiSubject;
  CurrentStatus?: SadeSatiStatus;
  Past?: SadeSatiWindow[] | null;
  Current?: SadeSatiWindow | null;
  Future?: SadeSatiWindow[] | null;
  GeneratedAt?: string;
}

// ---------------------------------------------------------------------------
// i18n tables (ported verbatim from sadesati.go)
// ---------------------------------------------------------------------------

const LABELS: Record<string, Record<string, string>> = {
  en: {
    title_sade: "Sade Sati Report",
    born: "Born",
    at: "at",
    generated: "Generated on",
    moon_sign: "Moon Sign",
    section_current: "Current Status",
    section_past: "Past Sade Sati Windows",
    section_active_window: "Active Window Now",
    section_future: "Upcoming Windows",
    section_remedies: "Recommended Remedies",
    current_phase: "Current Phase",
    from: "From",
    to: "To",
    duration: "Duration",
    signs_traversed: "Signs Traversed",
    no_past: "No past Sade Sati windows recorded in the searched range.",
    no_future: "No upcoming Sade Sati windows in the searched range.",
    remedies_intro:
      "These traditional remedies are commonly recommended during Sade Sati phases. Consult a qualified astrologer before adopting any:",
  },
  hi: {
    title_sade: "साढ़े साती रिपोर्ट",
    born: "जन्म",
    at: "समय",
    generated: "तैयार",
    moon_sign: "चंद्र राशि",
    section_current: "वर्तमान स्थिति",
    section_past: "पूर्ववर्ती साढ़े साती चरण",
    section_active_window: "वर्तमान चरण",
    section_future: "आगामी चरण",
    section_remedies: "अनुशंसित उपाय",
    current_phase: "वर्तमान चरण",
    from: "प्रारंभ",
    to: "समाप्ति",
    duration: "अवधि",
    signs_traversed: "गोचर राशियाँ",
    no_past: "खोज सीमा में कोई पूर्व साढ़े साती चरण नहीं मिला।",
    no_future: "खोज सीमा में कोई आगामी साढ़े साती चरण नहीं है।",
    remedies_intro:
      "साढ़े साती के दौरान प्रचलित पारंपरिक उपाय निम्नलिखित हैं। किसी भी उपाय को अपनाने से पूर्व योग्य ज्योतिषी से परामर्श लीजिए:",
  },
  mr: {
    title_sade: "साडेसाती अहवाल",
    born: "जन्म",
    at: "वेळ",
    generated: "तयार",
    moon_sign: "चंद्र राशी",
    section_current: "वर्तमान स्थिती",
    section_past: "मागील साडेसाती कालखंड",
    section_active_window: "वर्तमान कालखंड",
    section_future: "आगामी कालखंड",
    section_remedies: "शिफारस केलेले उपाय",
    current_phase: "वर्तमान चरण",
    from: "पासून",
    to: "पर्यंत",
    duration: "कालावधी",
    signs_traversed: "गोचर राशी",
    no_past: "शोध मर्यादेत कोणताही मागील साडेसाती कालखंड आढळला नाही.",
    no_future: "शोध मर्यादेत कोणताही आगामी साडेसाती कालखंड नाही.",
    remedies_intro:
      "साडेसाती कालखंडात सामान्यतः शिफारस केले जाणारे पारंपरिक उपाय खालील आहेत. कोणताही उपाय अंगीकारण्यापूर्वी पात्र ज्योतिषाचा सल्ला घ्या:",
  },
};

/** The four phase labels, per locale. */
const STATUS_LABELS: Record<string, Record<string, string>> = {
  en: { rising: "Rising", peak: "Peak", setting: "Setting", clear: "Clear (no Sade Sati)" },
  hi: { rising: "आरंभ", peak: "शिखर", setting: "अंत", clear: "मुक्त (साढ़े साती नहीं)" },
  mr: { rising: "प्रारंभ", peak: "शिखर", setting: "अंत", clear: "मुक्त (साडेसाती नाही)" },
};

/**
 * Canonical Sade Sati remedies, locale-keyed (hard-coded in the Go template —
 * conventional remedies, uniform across consultations).
 */
const REMEDIES: Record<string, string[]> = {
  en: [
    "Recite Hanuman Chalisa daily, especially on Tuesdays and Saturdays.",
    "Donate black sesame seeds, mustard oil, or iron items on Saturdays.",
    "Worship Lord Shani with til oil and blue flowers.",
    "Wear a blue sapphire only after astrological verification — Saturn's gemstone is not for everyone.",
    "Maintain disciplined routine, ethical conduct, and minimize unnecessary expenditure.",
  ],
  hi: [
    "प्रतिदिन हनुमान चालीसा का पाठ कीजिए, विशेषकर मंगलवार एवं शनिवार को।",
    "शनिवार को काले तिल, सरसों का तेल अथवा लोहे की वस्तुओं का दान कीजिए।",
    "शनि देव की पूजा तिल के तेल एवं नीले पुष्पों से कीजिए।",
    "नीलम धारण ज्योतिषीय परीक्षण के पश्चात ही कीजिए — शनि का रत्न सभी के लिए उपयुक्त नहीं होता।",
    "अनुशासित दिनचर्या रखिए, नैतिक आचरण कीजिए एवं अनावश्यक व्यय से बचिए।",
  ],
  mr: [
    "दररोज हनुमान चालीसाचे पठण करा, विशेषतः मंगळवार आणि शनिवारी.",
    "शनिवारी काळे तीळ, मोहरीचे तेल किंवा लोखंडी वस्तूंचे दान करा.",
    "शनिदेवाची तिळाच्या तेलाने आणि निळ्या फुलांनी पूजा करा.",
    "नीलम धारण ज्योतिषीय तपासणीनंतरच करा — शनीचे रत्न सर्वांसाठी योग्य नसते.",
    "शिस्तबद्ध दिनचर्या ठेवा, नैतिक आचरण करा आणि अनावश्यक खर्च टाळा.",
  ],
};

// ---------------------------------------------------------------------------
// Locale helpers (ported from the Go FuncMap)
// ---------------------------------------------------------------------------

/** Narrow a request locale to one we have labels for, else "en". */
function pickLocale(loc: string | undefined): string {
  return loc && LABELS[loc] ? loc : "en";
}

function label(loc: string, key: string): string {
  const m = LABELS[pickLocale(loc)] ?? LABELS.en ?? {};
  const en = LABELS.en ?? {};
  return m[key] ?? en[key] ?? "";
}

function statusLabel(loc: string, status: string | undefined): string {
  const s = status ?? "";
  const m = STATUS_LABELS[pickLocale(loc)];
  return (m && m[s]) ?? s;
}

function remediesList(loc: string): string[] {
  return REMEDIES[pickLocale(loc)] ?? REMEDIES.en ?? [];
}

/** Number formatted to one decimal, matching Go's `%.1f`. */
function fmt1(n: number | undefined): string {
  return (typeof n === "number" ? n : 0).toFixed(1);
}

function durationLabel(loc: string, years: number | undefined): string {
  const y = fmt1(years);
  switch (pickLocale(loc)) {
    case "hi":
      return `लगभग ${y} वर्ष`;
    case "mr":
      return `सुमारे ${y} वर्षे`;
    default:
      return `approx ${y} years`;
  }
}

/**
 * Prose for the current Sade Sati phase. Ported verbatim from
 * `statusDescription` in sadesati.go. `moon_sign` / `saturn_sign` are already
 * locale-resolved by the handler; only the surrounding sentences switch locale.
 */
function statusDescription(loc: string, st: SadeSatiStatus): string {
  const moon = st.moon_sign ?? "";
  const saturn = st.saturn_sign ?? "";
  const status = st.status ?? "";
  switch (pickLocale(loc)) {
    case "hi":
      switch (status) {
        case "rising":
          return `शनि वर्तमान में आपकी चंद्र राशि (${moon}) से पूर्व राशि में संक्रमण कर रहे हैं — साढ़े साती का प्रारंभिक चरण।`;
        case "peak":
          return `शनि वर्तमान में आपकी चंद्र राशि (${moon}) पर ही गोचर कर रहे हैं — साढ़े साती का शिखर चरण।`;
        case "setting":
          return `शनि वर्तमान में आपकी चंद्र राशि (${moon}) से अगली राशि में हैं — साढ़े साती का अंतिम चरण।`;
      }
      return `वर्तमान में आप साढ़े साती से मुक्त हैं। शनि (${saturn}) आपकी चंद्र राशि (${moon}) से दूर है।`;
    case "mr":
      switch (status) {
        case "rising":
          return `शनी सध्या आपल्या चंद्र राशी (${moon}) पासून मागील राशीत आहेत — साडेसातीचा प्रारंभिक टप्पा.`;
        case "peak":
          return `शनी सध्या आपल्या चंद्र राशी (${moon}) वरच गोचर करत आहेत — साडेसातीचा शिखर टप्पा.`;
        case "setting":
          return `शनी सध्या आपल्या चंद्र राशी (${moon}) पासून पुढील राशीत आहेत — साडेसातीचा अंतिम टप्पा.`;
      }
      return `सध्या आपण साडेसाती मुक्त आहात. शनी (${saturn}) आपल्या चंद्र राशीपासून (${moon}) दूर आहेत.`;
    default:
      switch (status) {
        case "rising":
          return `Saturn is currently transiting the sign before your moon sign (${moon}) — the rising phase of Sade Sati.`;
        case "peak":
          return `Saturn is currently transiting your moon sign (${moon}) itself — the peak phase of Sade Sati.`;
        case "setting":
          return `Saturn is currently transiting the sign after your moon sign (${moon}) — the setting phase of Sade Sati.`;
      }
      return `You are currently clear of Sade Sati. Saturn (${saturn}) is not in the cluster around your moon sign (${moon}).`;
  }
}

// ---------------------------------------------------------------------------
// Report-specific CSS (the bits BASE_CSS doesn't already cover)
// ---------------------------------------------------------------------------

const EXTRA_CSS = `
.cover .moon-sign-badge {
  display: inline-block;
  margin-top: 8mm;
  padding: 3mm 8mm;
  background: var(--brand-primary);
  color: #fff;
  font-size: 14pt;
  border-radius: 2mm;
}
.status-card {
  margin: 4mm 0;
  padding: 5mm;
  border-radius: 2mm;
  border-left: 4px solid;
}
.status-card.peak    { background: #fef2f2; border-left-color: #dc2626; }
.status-card.rising  { background: #fff7ed; border-left-color: #ea580c; }
.status-card.setting { background: #fefce8; border-left-color: #ca8a04; }
.status-card.clear   { background: #f0fdf4; border-left-color: #16a34a; }
.status-card .label {
  text-transform: uppercase;
  font-size: 9pt;
  letter-spacing: 0.5pt;
  color: var(--brand-secondary);
  margin-bottom: 1mm;
}
.status-card .value { font-size: 18pt; font-weight: 700; margin-bottom: 2mm; }
.status-card .detail { font-size: 10pt; }
tr.current-window td { background: #fff7ed; font-weight: 600; }
.remedies {
  margin-top: 6mm;
  padding: 5mm;
  background: #fafafa;
  border-left: 3px solid var(--brand-secondary);
}
.remedies ul { margin: 2mm 0 0 6mm; padding: 0; }
.empty-list { margin: 3mm 0; color: var(--brand-secondary); font-style: italic; }
`;

// ---------------------------------------------------------------------------
// Body builders
// ---------------------------------------------------------------------------

/** A windows table row: from / to / duration / signs. */
function windowRow(loc: string, w: SadeSatiWindow): string {
  return `<tr>
  <td>${esc(w.StartDate)}</td>
  <td>${esc(w.EndDate)}</td>
  <td>${esc(durationLabel(loc, w.DurationYears))}</td>
  <td>${esc((w.SignsTraversed ?? []).join(", "))}</td>
</tr>`;
}

/** A full windows table (header + rows), or the empty-list note. */
function windowsTable(
  loc: string,
  rows: SadeSatiWindow[] | null | undefined,
  emptyKey: string,
): string {
  if (!Array.isArray(rows) || rows.length === 0) {
    return `<p class="empty-list">${esc(label(loc, emptyKey))}</p>`;
  }
  return `<table>
  <thead>
    <tr>
      <th>${esc(label(loc, "from"))}</th>
      <th>${esc(label(loc, "to"))}</th>
      <th>${esc(label(loc, "duration"))}</th>
      <th>${esc(label(loc, "signs_traversed"))}</th>
    </tr>
  </thead>
  <tbody>
    ${rows.map((w) => windowRow(loc, w)).join("\n    ")}
  </tbody>
</table>`;
}

// ---------------------------------------------------------------------------
// Public renderer
// ---------------------------------------------------------------------------

/**
 * Render the Sade Sati report as a complete, self-contained HTML document
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

export function renderSadeSatiHtml(data: SadeSatiData, branding?: Branding): string {
  const loc = data.Locale ?? "";
  const b = resolveBranding(data.Branding, branding);
  const subject = data.Subject ?? {};
  const status = data.CurrentStatus ?? {};
  const title = label(loc, "title_sade");

  // --- Cover ---------------------------------------------------------------
  const cover = `<section class="cover">
  ${coverBrandingHtml(b)}
  <h1>${esc(title)}</h1>
  <div class="subject">${esc(subject.name)}</div>
  <div class="meta">
    ${esc(label(loc, "born"))} ${esc(subject.birth_date)} ${esc(label(loc, "at"))} ${esc(subject.birth_time)}<br>
    ${esc(subject.birth_place)}
  </div>
  <div class="moon-sign-badge">
    ${esc(label(loc, "moon_sign"))}: ${esc(subject.moon_sign)}
  </div>
  <div class="generated">
    ${esc(label(loc, "generated"))} ${esc(formatGenerated(data.GeneratedAt))}
  </div>
</section>`;

  // --- Current status card -------------------------------------------------
  const statusCls = status.status ?? "";
  const currentCard = `<h2>${esc(label(loc, "section_current"))}</h2>
<div class="status-card ${esc(statusCls)}">
  <div class="label">${esc(label(loc, "current_phase"))}</div>
  <div class="value">${esc(statusLabel(loc, status.status))}</div>
  <div class="detail">${esc(statusDescription(loc, status))}</div>
</div>`;

  // --- Past windows --------------------------------------------------------
  const pastSection = `<h2>${esc(label(loc, "section_past"))}</h2>
${windowsTable(loc, data.Past, "no_past")}`;

  // --- Current window highlight (only when active) -------------------------
  let activeSection = "";
  const cur = data.Current;
  if (cur) {
    activeSection = `<h2>${esc(label(loc, "section_active_window"))}</h2>
<table>
  <tbody>
    <tr class="current-window"><td>${esc(label(loc, "from"))}</td><td>${esc(cur.StartDate)}</td></tr>
    <tr class="current-window"><td>${esc(label(loc, "to"))}</td><td>${esc(cur.EndDate)}</td></tr>
    <tr class="current-window"><td>${esc(label(loc, "signs_traversed"))}</td><td>${esc(
      (cur.SignsTraversed ?? []).join(", "),
    )}</td></tr>
  </tbody>
</table>`;
  }

  // --- Future windows ------------------------------------------------------
  const futureSection = `<h2>${esc(label(loc, "section_future"))}</h2>
${windowsTable(loc, data.Future, "no_future")}`;

  // --- Remedies ------------------------------------------------------------
  const remediesSection = `<h2>${esc(label(loc, "section_remedies"))}</h2>
<div class="remedies">
  <p>${esc(label(loc, "remedies_intro"))}</p>
  <ul>
    ${remediesList(loc)
      .map((r) => `<li>${esc(r)}</li>`)
      .join("\n    ")}
  </ul>
</div>`;

  const bodyHtml = [
    cover,
    currentCard,
    pastSection,
    activeSection,
    futureSection,
    remediesSection,
  ]
    .filter((s) => s !== "")
    .join("\n\n");

  return layoutDocument({
    lang: loc || "en",
    title,
    branding: b,
    bodyHtml,
    extraCss: EXTRA_CSS,
  });
}
