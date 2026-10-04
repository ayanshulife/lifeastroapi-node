/**
 * Match Making (Kundli Milan) report → HTML.
 *
 * Ported from the server-side Go template `internal/pdf/matchmaking.go` so the
 * SDK-rendered PDF is visually faithful to the API's own report. Consumes the
 * JSON returned by `client.reports.matchMaking(...)` verbatim (PascalCase
 * top-level keys; snake_case inside the boy/girl subjects — see interfaces
 * below) and returns a self-contained HTML document ready for `htmlToPdf`.
 *
 * The Go template's i18n helpers (matchNakLabel/kootaLabel/…) just echo the
 * already-locale-resolved field straight back, so here we read the field
 * directly — no client-side translation is performed. The koota `name` and
 * subject `nakshatra` arrive pre-localized from the API.
 *
 * The verdict-description and dosha/nadi summary prose is hard-coded per
 * locale in the Go template (conventional Ashtakoota wording, no rule corpus);
 * it is ported here verbatim, including the Computed=false honesty guard so a
 * Mangal Dosha check that never ran is never rendered as "no dosha".
 */

import {
  esc,
  resolveBranding,
  coverBrandingHtml,
  makeLabeler,
  layoutDocument,
  type Branding,
} from "../shared.js";

/**
 * Per-person header info (name, birth, moon nakshatra). Keys are snake_case as
 * tagged in the Go `MatchMakingSubject` struct. `nakshatra`/`sign` arrive
 * pre-resolved to the request locale.
 */
export interface MatchMakingSubject {
  name?: string;
  birth_date?: string;
  birth_time?: string;
  birth_place?: string;
  nakshatra?: string;
  sign?: string;
  gana?: string;
  nadi?: string;
}

/**
 * One of the 8 kootas with score + max + reason. `name` and `score` are tagged
 * (lowercase) in Go; `Max` and `Reason` have no tag → PascalCase. `Reason` is
 * the human-readable explanation, pre-resolved to the requested locale.
 */
export interface MatchMakingKoota {
  name?: string;
  score?: number;
  Max?: number;
  Reason?: string;
}

/** The full 8-koota table + total. All fields untagged → PascalCase. */
export interface MatchMakingAshtakoota {
  Total?: number;
  /** Maximum possible total (36). */
  Max?: number;
  /** Ordered: varna, vashya, tara, yoni, graha_maitri, gana, bhakoot, nadi. */
  Kootas?: MatchMakingKoota[];
  /** "poor" | "fair" | "good" | "excellent". */
  Verdict?: string;
}

/**
 * One Mangal Dosha result for a single person. All fields untagged →
 * PascalCase. When `Computed` is false the check never ran (no birth
 * lat/lon) — every other field is a zero value and MUST NOT be read as a
 * "no dosha" verdict.
 */
export interface MatchMakingDosha {
  Computed?: boolean;
  NotComputedReason?: string;
  HasDosha?: boolean;
  /** "purn" | "mild" | "none". */
  Type?: string;
  HousesOccupied?: number[];
  Cancelled?: boolean;
  CancelReasons?: string[];
}

/** The Nadi Dosha verdict between the pair. All fields untagged → PascalCase. */
export interface MatchMakingNadiDosha {
  HasDosha?: boolean;
  BoyNadi?: string;
  GirlNadi?: string;
  /** "none" | "high" | "exempted". */
  Severity?: string;
  Exceptions?: string[];
}

/** Branding embedded in the report JSON (PascalCase). */
export interface MatchMakingBranding {
  CompanyName?: string;
  LogoURL?: string;
  PrimaryColor?: string;
  SecondaryColor?: string;
  FooterText?: string;
  WatermarkText?: string;
}

/** Full Match Making payload (exactly as returned by the API). */
export interface MatchMakingData {
  Locale?: string;
  Branding?: MatchMakingBranding;
  Boy?: MatchMakingSubject;
  Girl?: MatchMakingSubject;
  Ashtakoota?: MatchMakingAshtakoota;
  MangalDoshaBoy?: MatchMakingDosha;
  MangalDoshaGirl?: MatchMakingDosha;
  NadiDosha?: MatchMakingNadiDosha;
  GeneratedAt?: string;
  /** Short summary string; falls back to a derived line from the total. */
  FinalVerdict?: string;
}

/**
 * i18n strings ported verbatim from the Go `matchmakingLabels` map. A missing
 * key degrades to "" via `makeLabeler`, matching the Go template's
 * graceful-degradation behavior.
 */
export const LABELS: Record<string, Record<string, string>> = {
  en: {
    title_match: "Kundli Milan — Match Compatibility",
    born: "Born",
    generated: "Generated on",
    section_ashtakoota: "Ashtakoota — 8-Fold Compatibility",
    section_doshas: "Doshas",
    section_final: "Final Verdict",
    koota: "Koota",
    max: "Max",
    score: "Score",
    details: "Details",
    total: "Total",
    nakshatra: "Nakshatra",
    ashtakoota_verdict: "Ashtakoota Verdict",
    mangal_dosha: "Mangal Dosha",
    nadi_dosha: "Nadi Dosha",
  },
  hi: {
    title_match: "कुंडली मिलान — मिलान पात्रता",
    born: "जन्म",
    generated: "तैयार",
    section_ashtakoota: "अष्टकूट — 8 गुण मिलान",
    section_doshas: "दोष",
    section_final: "अंतिम निष्कर्ष",
    koota: "कूट",
    max: "अधिकतम",
    score: "अंक",
    details: "विवरण",
    total: "कुल",
    nakshatra: "नक्षत्र",
    ashtakoota_verdict: "अष्टकूट निष्कर्ष",
    mangal_dosha: "मंगल दोष",
    nadi_dosha: "नाड़ी दोष",
  },
  mr: {
    title_match: "कुंडली जुळवणी — मिलन पात्रता",
    born: "जन्म",
    generated: "तयार",
    section_ashtakoota: "अष्टकूट — 8 गुण जुळवणी",
    section_doshas: "दोष",
    section_final: "अंतिम निष्कर्ष",
    koota: "कूट",
    max: "कमाल",
    score: "गुण",
    details: "तपशील",
    total: "एकूण",
    nakshatra: "नक्षत्र",
    ashtakoota_verdict: "अष्टकूट निष्कर्ष",
    mangal_dosha: "मंगळ दोष",
    nadi_dosha: "नाडी दोष",
  },
};

/**
 * Translate "poor" | "fair" | "good" | "excellent". Ported verbatim from the
 * Go `verdictLabels` map. Falls back to the raw verdict key when missing.
 */
export const VERDICT_LABELS: Record<string, Record<string, string>> = {
  en: { poor: "Poor", fair: "Fair", good: "Good", excellent: "Excellent" },
  hi: { poor: "अल्प", fair: "सामान्य", good: "अच्छा", excellent: "उत्तम" },
  mr: { poor: "अल्प", fair: "सामान्य", good: "चांगला", excellent: "उत्तम" },
};

/** Narrow a request locale to one we have labels for (fail-open to "en"). */
function pickLocale(loc?: string): string {
  return loc && LABELS[loc] ? loc : "en";
}

function verdictLabel(loc: string | undefined, verdict: string | undefined): string {
  const v = verdict ?? "";
  const table = VERDICT_LABELS[pickLocale(loc)] ?? VERDICT_LABELS.en ?? {};
  return table[v] ?? v;
}

/**
 * Short prose describing what the Ashtakoota score band means. Ported verbatim
 * from the Go `verdictDescription` helper.
 */
function verdictDescription(loc: string | undefined, verdict: string | undefined): string {
  const l = pickLocale(loc);
  switch (verdict) {
    case "excellent":
      if (l === "hi") return "उत्तम मिलान — सभी क्षेत्रों में सामंजस्य की संभावना अधिक है।";
      if (l === "mr") return "उत्तम जुळवणी — सर्व क्षेत्रांत सामंजस्याची शक्यता अधिक आहे.";
      return "Excellent match — high compatibility across all areas.";
    case "good":
      if (l === "hi") return "अच्छा मिलान — विवाह के लिए अनुकूल योग।";
      if (l === "mr") return "चांगली जुळवणी — विवाहासाठी अनुकूल योग.";
      return "Good match — favorable indications for marriage.";
    case "fair":
      if (l === "hi") return "सामान्य मिलान — कुछ कूटों में कमी, परंतु आगे बढ़ने योग्य।";
      if (l === "mr") return "सामान्य जुळवणी — काही कूटांमध्ये कमतरता, परंतु पुढे जाण्यायोग्य.";
      return "Fair match — some kootas underscore but workable with awareness.";
    default:
      if (l === "hi") return "अल्प मिलान — कई कूटों में कमी, सावधानीपूर्वक विचार आवश्यक।";
      if (l === "mr") return "अल्प जुळवणी — अनेक कूटांमध्ये कमतरता, काळजीपूर्वक विचार आवश्यक.";
      return "Low score — multiple kootas underscore; careful consideration advised.";
  }
}

/** CSS class for a dosha block. Ported verbatim from Go `doshaClass`. */
function doshaClass(d: MatchMakingDosha): string {
  if (!d.Computed) return "not-computed";
  if (d.HasDosha && d.Cancelled) return "cancelled";
  if (d.HasDosha) return "has-dosha";
  return "no-dosha";
}

/** Join strings with a separator (no escaping — caller escapes). */
function joinStrings(items: string[] | undefined, sep: string): string {
  return Array.isArray(items) ? items.join(sep) : "";
}

/**
 * Mangal Dosha summary text. Ported verbatim from Go `doshaSummary`, including
 * the Computed=false honesty guard.
 */
function doshaSummary(loc: string | undefined, d: MatchMakingDosha): string {
  const l = pickLocale(loc);
  if (!d.Computed) {
    if (l === "hi") return "मंगल दोष की जाँच नहीं हुई — जन्म स्थान (अक्षांश/देशांतर) नहीं दिया गया।";
    if (l === "mr") return "मंगळ दोष तपासला नाही — जन्मस्थान (अक्षांश/रेखांश) दिलेले नाही.";
    return "Mangal Dosha not evaluated — birth latitude/longitude not provided.";
  }
  if (!d.HasDosha) {
    if (l === "hi") return "मंगल दोष नहीं है।";
    if (l === "mr") return "मंगळ दोष नाही.";
    return "No Mangal Dosha present.";
  }
  // Type is a code ("purn"/"mild") — show a readable label, not the raw code.
  const typeLabel =
    l === "hi" || l === "mr"
      ? d.Type === "purn"
        ? "पूर्ण"
        : d.Type === "mild"
          ? "अल्प"
          : (d.Type ?? "")
      : d.Type === "purn"
        ? "full"
        : d.Type === "mild"
          ? "mild"
          : (d.Type ?? "");
  // milan encodes trigger houses as: positive = from the Lagna, negative
  // (its abs value) = from the Moon. Render that distinction instead of the
  // raw "[7 -2]" slice.
  const hs = d.HousesOccupied ?? [];
  const lagnaH = hs.filter((h) => h > 0).map(String);
  const moonH = hs.filter((h) => h < 0).map((h) => String(-h));
  const houseParts: string[] = [];
  if (l === "hi") {
    if (lagnaH.length) houseParts.push(`लग्न से ${lagnaH.join(", ")}`);
    if (moonH.length) houseParts.push(`चंद्र से ${moonH.join(", ")}`);
  } else if (l === "mr") {
    if (lagnaH.length) houseParts.push(`लग्नापासून ${lagnaH.join(", ")}`);
    if (moonH.length) houseParts.push(`चंद्रापासून ${moonH.join(", ")}`);
  } else {
    if (lagnaH.length) houseParts.push(`${lagnaH.join(", ")} from lagna`);
    if (moonH.length) houseParts.push(`${moonH.join(", ")} from Moon`);
  }
  const houses = houseParts.join("; ");
  let out: string;
  if (l === "hi") out = `मंगल दोष (${typeLabel}) — भाव: ${houses}।`;
  else if (l === "mr") out = `मंगळ दोष (${typeLabel}) — स्थाने: ${houses}.`;
  else out = `Mangal Dosha (${typeLabel}) — house(s): ${houses}.`;
  if (d.Cancelled) {
    const reasons = joinStrings(d.CancelReasons, ", ");
    if (l === "hi") out += " रद्द: " + reasons;
    else if (l === "mr") out += " रद्द: " + reasons;
    else out += " Cancelled: " + reasons;
  }
  return out;
}

/** CSS class for the nadi block. Ported verbatim from Go `nadiClass`. */
function nadiClass(n: MatchMakingNadiDosha): string {
  switch (n.Severity) {
    case "exempted":
      return "cancelled";
    case "high":
      return "has-dosha";
    default:
      return "no-dosha";
  }
}

/** Nadi Dosha summary text. Ported verbatim from Go `nadiSummary`. */
function nadiSummary(loc: string | undefined, n: MatchMakingNadiDosha): string {
  const l = pickLocale(loc);
  const boy = n.BoyNadi ?? "";
  const girl = n.GirlNadi ?? "";
  switch (n.Severity) {
    case "none":
      if (l === "hi") return `नाड़ी दोष नहीं है। (वर: ${boy}, वधू: ${girl})`;
      if (l === "mr") return `नाडी दोष नाही. (वर: ${boy}, वधू: ${girl})`;
      return `No Nadi Dosha. (Boy: ${boy}, Girl: ${girl})`;
    case "exempted": {
      const exc = joinStrings(n.Exceptions, ", ");
      if (l === "hi") return `नाड़ी दोष है परन्तु शास्त्रीय अपवाद से रद्द (${exc})`;
      if (l === "mr") return `नाडी दोष आहे परंतु शास्त्रीय अपवादाने रद्द (${exc})`;
      return `Nadi Dosha present but exempted by classical rule (${exc})`;
    }
    default: // "high"
      if (l === "hi") return `नाड़ी दोष — दोनों की नाड़ी समान (${boy})। शास्त्रीय रूप से प्रतिकूल।`;
      if (l === "mr") return `नाडी दोष — दोघांची नाडी समान (${boy}). शास्त्रानुसार प्रतिकूल.`;
      return `Nadi Dosha — both share ${boy} nadi. Classically unfavorable.`;
  }
}

/**
 * Final verdict line. Ported verbatim from Go `matchVerdictForLocale`: use the
 * handler-supplied `FinalVerdict` when present, else derive from the total.
 */
function matchVerdict(data: MatchMakingData): string {
  if (data.FinalVerdict) return data.FinalVerdict;
  const total = data.Ashtakoota?.Total ?? 0;
  if (total >= 24) {
    return "Marriage indications are favorable. Consult a qualified astrologer for timing.";
  }
  return "Score is below conventional threshold (24/36). Consider remedies and detailed consultation.";
}

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

/**
 * Report-specific CSS not already covered by the shared BASE_CSS: the
 * two-subject cover layout, score-cell alignment, the total row, and the
 * verdict / dosha bands (with their severity-coded border colors). Ported from
 * the inline <style> in `matchmaking.go`.
 */
const EXTRA_CSS = `
.cover .subjects { display: flex; justify-content: space-around; align-items: flex-start; margin-top: 8mm; }
.cover .subject-col { flex: 1; max-width: 40%; }
.cover .subject-col h2 { color: var(--brand-primary); border: none; font-size: 18pt; margin-bottom: 4mm; padding: 0; }
.cover .subject-col .meta { color: var(--brand-secondary); font-size: 10pt; }
.cover .vs { align-self: center; font-size: 24pt; color: var(--brand-secondary); padding: 0 8mm; }
td.score { text-align: right; font-weight: 600; font-variant-numeric: tabular-nums; }
tr.total td { background: #fafafa; font-weight: 700; border-top: 2px solid var(--brand-primary); border-bottom: none; }
.verdict { margin-top: 6mm; padding: 5mm; border: 1px solid var(--brand-primary); border-radius: 3mm; background: #fafafa; }
.verdict.excellent { border-color: #166534; }
.verdict.good { border-color: #65a30d; }
.verdict.fair { border-color: #ca8a04; }
.verdict.poor { border-color: #dc2626; }
.verdict h3 { margin: 0 0 2mm; font-size: 14pt; }
.dosha-block { margin-top: 4mm; padding: 4mm; background: #fafafa; border-left: 3px solid var(--brand-secondary); }
.dosha-block.has-dosha { border-left-color: #dc2626; }
.dosha-block.cancelled { border-left-color: #ca8a04; }
.dosha-block.no-dosha { border-left-color: #166534; }
`;

/**
 * Render the Match Making (Kundli Milan) report as a complete HTML document.
 *
 * @param data     report JSON from `client.reports.matchMaking(...)`
 * @param branding optional caller branding overrides (win per-field over the
 *                 branding embedded in `data`)
 */
export function renderMatchMakingHtml(data: MatchMakingData, branding?: Branding): string {
  const resolved = resolveBranding(data.Branding, branding);
  const t = makeLabeler(LABELS, data.Locale);

  const boy = data.Boy ?? {};
  const girl = data.Girl ?? {};
  const ashtakoota = data.Ashtakoota ?? {};
  const kootas = Array.isArray(ashtakoota.Kootas) ? ashtakoota.Kootas : [];
  const verdict = ashtakoota.Verdict ?? "";
  const boyName = boy.name ?? "";
  const girlName = girl.name ?? "";

  // Cover page: two subjects side by side, "⚭" between.
  const subjectMeta = (s: MatchMakingSubject) =>
    `${esc(t("born"))} ${esc(s.birth_date)}<br>${esc(s.birth_time)}<br>${esc(
      s.birth_place,
    )}<br>${esc(t("nakshatra"))}: ${esc(s.nakshatra)}`;
  const cover = `<section class="cover">
  ${coverBrandingHtml(resolved)}
  <h1>${esc(t("title_match"))}</h1>
  <div class="subjects">
    <div class="subject-col">
      <h2>${esc(boyName)}</h2>
      <div class="meta">${subjectMeta(boy)}</div>
    </div>
    <div class="vs">⚭</div>
    <div class="subject-col">
      <h2>${esc(girlName)}</h2>
      <div class="meta">${subjectMeta(girl)}</div>
    </div>
  </div>
  <div class="generated">${esc(t("generated"))} ${esc(formatGenerated(data.GeneratedAt))}</div>
</section>`;

  // Ashtakoota score table (koota / max / score / details), then total row.
  const kootaRows = kootas
    .map(
      (k) =>
        `<tr><td>${esc(k.name)}</td><td class="score">${esc(k.Max)}</td><td class="score">${esc(
          k.score,
        )}</td><td>${esc(k.Reason)}</td></tr>`,
    )
    .join("");
  const totalRow = `<tr class="total"><td>${esc(t("total"))}</td><td class="score">${esc(
    ashtakoota.Max,
  )}</td><td class="score">${esc(ashtakoota.Total)}</td><td>${esc(
    verdictLabel(data.Locale, verdict),
  )}</td></tr>`;
  const ashtakootaTable = `<h2>${esc(t("section_ashtakoota"))}</h2>
<table>
  <thead>
    <tr>
      <th>${esc(t("koota"))}</th>
      <th>${esc(t("max"))}</th>
      <th>${esc(t("score"))}</th>
      <th>${esc(t("details"))}</th>
    </tr>
  </thead>
  <tbody>${kootaRows}${totalRow}</tbody>
</table>
<div class="verdict ${esc(verdict)}">
  <h3>${esc(t("ashtakoota_verdict"))}: ${esc(verdictLabel(data.Locale, verdict))}</h3>
  <p>${esc(verdictDescription(data.Locale, verdict))}</p>
</div>`;

  // Dosha analysis: Mangal (boy + girl) + Nadi.
  const mangalBoy = data.MangalDoshaBoy ?? {};
  const mangalGirl = data.MangalDoshaGirl ?? {};
  const nadi = data.NadiDosha ?? {};
  const doshas = `<h2>${esc(t("section_doshas"))}</h2>
<h3>${esc(t("mangal_dosha"))} — ${esc(boyName)}</h3>
<div class="dosha-block ${esc(doshaClass(mangalBoy))}">${esc(
    doshaSummary(data.Locale, mangalBoy),
  )}</div>
<h3>${esc(t("mangal_dosha"))} — ${esc(girlName)}</h3>
<div class="dosha-block ${esc(doshaClass(mangalGirl))}">${esc(
    doshaSummary(data.Locale, mangalGirl),
  )}</div>
<h3>${esc(t("nadi_dosha"))}</h3>
<div class="dosha-block ${esc(nadiClass(nadi))}">${esc(nadiSummary(data.Locale, nadi))}</div>`;

  // Final verdict band.
  const finalVerdict = `<h2>${esc(t("section_final"))}</h2>
<div class="verdict ${esc(verdict)}">
  <p>${esc(matchVerdict(data))}</p>
</div>`;

  const bodyHtml = [cover, ashtakootaTable, doshas, finalVerdict].join("\n\n");

  return layoutDocument({
    lang: data.Locale,
    title: `${t("title_match")} — ${boyName} × ${girlName}`,
    branding: resolved,
    bodyHtml,
    extraCss: EXTRA_CSS,
  });
}
