/**
 * Mangal Dosha (Manglik) report → HTML.
 *
 * Ported from the server-side Go template `internal/pdf/mangal_dosha.go`. A
 * single-subject diagnostic focused on Mars' placement from the lagna and what
 * it means for marriage / partnerships. The prose, remedies, and i18n labels are
 * hard-coded in the Go template (conventional, uniform across consultations), so
 * they are re-implemented here verbatim — only `Status` / `HasDosha` /
 * `Cancelled` / `HousesOccupied` / `MarsPlacement` / `Subject` come from the JSON.
 *
 * Layout (mirrors the Go template):
 *   1. Cover with subject + status badge.
 *   2. Diagnostic block (Mars sign / nakshatra / houses / diagnosis).
 *   3. Cancellation block (only when classical cancellations apply).
 *   4. Marriage implications prose.
 *   5. Recommended remedies (heavier for "purn", lighter for "mild").
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
// JSON shapes (exact keys as returned by `client.reports.mangalDosha`)
// ---------------------------------------------------------------------------

/**
 * Cover-page header info. `ascendant_sign` is pre-resolved to the request locale
 * by the handler. JSON keys are lowercase (the Go struct carries `json:` tags).
 */
export interface MangalDoshaSubject {
  name?: string;
  birth_date?: string;
  birth_time?: string;
  birth_place?: string;
  ascendant_sign?: string;
}

/**
 * Mars' placement (the shared `KundliPlacement` shape — snake_case `json:` tags).
 * `sign` / `nakshatra` are pre-resolved to the request locale by the handler.
 */
export interface MangalDoshaPlacement {
  sign?: string;
  dms_within?: string;
  nakshatra?: string;
  pada?: number;
  nak_lord?: string;
}

/**
 * Full Mangal Dosha report payload. The top-level `MangalDoshaReportData` Go
 * struct has NO `json:` tags, so its fields are PascalCase. `Status` is one of
 * `"purn"` (full) | `"mild"` (partial) | `"none"`.
 */
export interface MangalDoshaData {
  Locale?: string;
  Branding?: RawBranding;
  Subject?: MangalDoshaSubject;
  Status?: string;
  HasDosha?: boolean;
  HousesOccupied?: number[];
  Cancelled?: boolean;
  CancelReasons?: string[];
  MarsPlacement?: MangalDoshaPlacement;
  GeneratedAt?: string;
}

// ---------------------------------------------------------------------------
// i18n tables (ported verbatim from mangal_dosha.go)
// ---------------------------------------------------------------------------

const LABELS: Record<string, Record<string, string>> = {
  en: {
    title_mangal: "Mangal Dosha Report",
    born: "Born",
    at: "at",
    generated: "Generated on",
    ascendant: "Ascendant",
    section_diagnostic: "Diagnostic",
    section_cancellation: "Cancellation",
    section_marriage: "Marriage Implications",
    section_remedies: "Recommended Remedies",
    mars_sign: "Mars Sign",
    mars_nakshatra: "Mars Nakshatra",
    mars_houses: "Mars in House(s)",
    pada: "Pada",
    diagnosis: "Diagnosis",
    cancellation_intro: "Classical rules indicate the following cancellations apply to the dosha:",
    remedies_intro:
      "These traditional remedies are commonly recommended. Consult a qualified astrologer before adopting any:",
  },
  hi: {
    title_mangal: "मंगल दोष रिपोर्ट",
    born: "जन्म",
    at: "समय",
    generated: "तैयार",
    ascendant: "लग्न",
    section_diagnostic: "विश्लेषण",
    section_cancellation: "दोष परिहार",
    section_marriage: "विवाह प्रभाव",
    section_remedies: "अनुशंसित उपाय",
    mars_sign: "मंगल राशि",
    mars_nakshatra: "मंगल नक्षत्र",
    mars_houses: "मंगल भाव",
    pada: "पाद",
    diagnosis: "निदान",
    cancellation_intro: "शास्त्रीय नियमों के अनुसार निम्नलिखित कारणों से दोष का परिहार होता है:",
    remedies_intro:
      "मंगल दोष के लिए सामान्यतः अनुशंसित पारंपरिक उपाय निम्नलिखित हैं। कोई भी उपाय अपनाने से पूर्व योग्य ज्योतिषी से परामर्श लीजिए:",
  },
  mr: {
    title_mangal: "मंगळ दोष अहवाल",
    born: "जन्म",
    at: "वेळ",
    generated: "तयार",
    ascendant: "लग्न",
    section_diagnostic: "विश्लेषण",
    section_cancellation: "दोष परिहार",
    section_marriage: "विवाह प्रभाव",
    section_remedies: "शिफारस केलेले उपाय",
    mars_sign: "मंगळ राशी",
    mars_nakshatra: "मंगळ नक्षत्र",
    mars_houses: "मंगळ स्थाने",
    pada: "चरण",
    diagnosis: "निदान",
    cancellation_intro: "शास्त्रीय नियमांनुसार खालील कारणांमुळे दोषाचा परिहार होतो:",
    remedies_intro:
      "मंगळ दोषासाठी सामान्यतः शिफारस केले जाणारे पारंपरिक उपाय खालील आहेत. कोणताही उपाय अंगीकारण्यापूर्वी पात्र ज्योतिषाचा सल्ला घ्या:",
  },
};

/** Remedies keyed by locale AND status ("purn" / "mild" / "none"). */
const REMEDIES: Record<string, Record<string, string[]>> = {
  en: {
    purn: [
      "Recite Hanuman Chalisa daily, especially on Tuesdays.",
      "Visit a Hanuman temple every Tuesday and offer red flowers + sindoor.",
      "Donate red lentils, jaggery, or red cloth on Tuesdays.",
      "Fast on Tuesdays — eat only fruit and milk that day.",
      "Consider Kumbh Vivah (symbolic marriage to a peepal tree or kumbh) before actual marriage — only after astrologer's recommendation.",
      "Wear a coral gemstone, but only after astrological verification — not for everyone.",
    ],
    mild: [
      "Recite Hanuman Chalisa on Tuesdays.",
      "Donate red lentils or jaggery on Tuesdays.",
      "Visit a Hanuman temple regularly.",
      "Light a mustard-oil lamp before Hanuman idol on Tuesdays.",
    ],
    none: ["No specific Mars-related remedies needed. Continue regular spiritual practices."],
  },
  hi: {
    purn: [
      "प्रतिदिन हनुमान चालीसा का पाठ कीजिए, विशेषकर मंगलवार को।",
      "प्रत्येक मंगलवार को हनुमान मंदिर जाकर लाल पुष्प एवं सिंदूर अर्पित कीजिए।",
      "मंगलवार को मसूर दाल, गुड़ अथवा लाल वस्त्र का दान कीजिए।",
      "मंगलवार का व्रत रखिए — केवल फल एवं दूध का सेवन कीजिए।",
      "विवाह से पूर्व कुंभ विवाह (पीपल अथवा कुंभ से प्रतीकात्मक विवाह) पर विचार कीजिए — योग्य ज्योतिषी की सलाह के पश्चात ही।",
      "मूँगा रत्न धारण ज्योतिषीय परीक्षण के पश्चात ही कीजिए — सभी के लिए उपयुक्त नहीं।",
    ],
    mild: [
      "मंगलवार को हनुमान चालीसा का पाठ कीजिए।",
      "मंगलवार को मसूर दाल अथवा गुड़ का दान कीजिए।",
      "नियमित रूप से हनुमान मंदिर जाइए।",
      "मंगलवार को हनुमान जी के समक्ष सरसों के तेल का दीपक प्रज्वलित कीजिए।",
    ],
    none: ["विशेष मंगल-सम्बन्धी उपाय आवश्यक नहीं। नियमित आध्यात्मिक अभ्यास जारी रखिए।"],
  },
  mr: {
    purn: [
      "दररोज हनुमान चालीसाचे पठण करा, विशेषतः मंगळवारी.",
      "प्रत्येक मंगळवारी हनुमान मंदिरात जाऊन लाल फुले आणि सिंदूर अर्पण करा.",
      "मंगळवारी मसूर डाळ, गूळ किंवा लाल वस्त्र दान करा.",
      "मंगळवारचा उपवास करा — फक्त फळे आणि दूध सेवन करा.",
      "विवाहापूर्वी कुंभ विवाह (पिंपळाशी किंवा कुंभाशी प्रतीकात्मक विवाह) विचारात घ्या — पात्र ज्योतिषाच्या सल्ल्यानंतरच.",
      "मूंगा रत्न धारण ज्योतिषीय तपासणीनंतरच करा — सर्वांसाठी योग्य नसते.",
    ],
    mild: [
      "मंगळवारी हनुमान चालीसाचे पठण करा.",
      "मंगळवारी मसूर डाळ किंवा गूळ दान करा.",
      "नियमितपणे हनुमान मंदिरात जा.",
      "मंगळवारी हनुमानजींसमोर मोहरीच्या तेलाचा दिवा लावा.",
    ],
    none: ["विशेष मंगळ-संबंधी उपाय आवश्यक नाहीत. नियमित आध्यात्मिक अभ्यास सुरू ठेवा."],
  },
};

// ---------------------------------------------------------------------------
// Locale helpers + prose (ported from the Go FuncMap)
// ---------------------------------------------------------------------------

function pickLocale(loc: string | undefined): string {
  return loc && LABELS[loc] ? loc : "en";
}

function label(loc: string, key: string): string {
  const m = LABELS[pickLocale(loc)] ?? LABELS.en ?? {};
  const en = LABELS.en ?? {};
  return m[key] ?? en[key] ?? "";
}

/** CSS class for the cover status badge. */
function badgeClass(d: MangalDoshaData): string {
  if (!d.HasDosha) return "none";
  if (d.Cancelled) return "cancelled";
  if (d.Status === "purn") return "purn";
  return "mild";
}

/** Cover-badge headline — combines dosha presence + cancellation into one label. */
function statusBadgeText(loc: string, d: MangalDoshaData): string {
  const l = pickLocale(loc);
  if (!d.HasDosha) {
    if (l === "hi") return "मंगल दोष नहीं";
    if (l === "mr") return "मंगळ दोष नाही";
    return "No Mangal Dosha";
  }
  if (d.Cancelled) {
    if (l === "hi") return "मंगल दोष — परिहार सहित";
    if (l === "mr") return "मंगळ दोष — परिहार सहित";
    return "Mangal Dosha (with cancellation)";
  }
  if (d.Status === "purn") {
    if (l === "hi") return "पूर्ण मंगल दोष";
    if (l === "mr") return "पूर्ण मंगळ दोष";
    return "Full Mangal Dosha";
  }
  if (l === "hi") return "अल्प मंगल दोष";
  if (l === "mr") return "अल्प मंगळ दोष";
  return "Mild Mangal Dosha";
}

/** "purn"/"mild"/"none" → human severity word. */
function severityLabel(loc: string, status: string | undefined): string {
  const l = pickLocale(loc);
  if (l === "hi") return status === "purn" ? "पूर्ण" : status === "mild" ? "अल्प" : "कोई नहीं";
  if (l === "mr") return status === "purn" ? "पूर्ण" : status === "mild" ? "अल्प" : "कोणताही नाही";
  return status === "purn" ? "full" : status === "mild" ? "mild" : "no";
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

/** One-paragraph plain-prose diagnosis. `MarsPlacement.sign` is locale-resolved. */
function diagnosisText(loc: string, d: MangalDoshaData): string {
  const l = pickLocale(loc);
  if (!d.HasDosha) {
    if (l === "hi")
      return "मंगल का स्थान दोषकारक भावों (1, 4, 7, 8, 12) में नहीं है, अतः मंगल दोष नहीं है।";
    if (l === "mr")
      return "मंगळाचे स्थान दोषकारक स्थानांमध्ये (1, 4, 7, 8, 12) नाही, त्यामुळे मंगळ दोष नाही.";
    return "Mars does not occupy any of the affected houses (1, 4, 7, 8, 12), so no Mangal Dosha is present.";
  }
  const sign = d.MarsPlacement?.sign ?? "";
  const houses = formatHouses(loc, d.HousesOccupied);
  const sev = severityLabel(loc, d.Status);
  if (l === "hi")
    return `मंगल ${sign} राशि में स्थित है तथा ${houses} भाव में है — यह मंगल दोष का ${sev} रूप है।`;
  if (l === "mr")
    return `मंगळ ${sign} राशीत आहे आणि ${houses} स्थानात आहे — हा मंगळ दोषाचा ${sev} प्रकार आहे.`;
  return `Mars sits in ${sign}, in house ${houses} — this constitutes a ${sev} form of Mangal Dosha.`;
}

/**
 * Render the dosha's trigger houses. The API encodes the reference point in
 * the sign: a positive number is counted from the lagna, a negative one (its
 * absolute value) from the Moon. Printing the raw number would state the
 * wrong reference point ("house -4 from the lagna" for "4th from the Moon").
 */
function formatHouses(loc: string, houses?: number[]): string {
  const l = pickLocale(loc);
  const hs = Array.isArray(houses) ? houses : [];
  const lagna = hs.filter((h) => h > 0).map(String);
  const moon = hs.filter((h) => h < 0).map((h) => String(-h));
  const parts: string[] = [];
  if (l === "hi") {
    if (lagna.length) parts.push(`लग्न से ${lagna.join(", ")}`);
    if (moon.length) parts.push(`चंद्र से ${moon.join(", ")}`);
  } else if (l === "mr") {
    if (lagna.length) parts.push(`लग्नापासून ${lagna.join(", ")}`);
    if (moon.length) parts.push(`चंद्रापासून ${moon.join(", ")}`);
  } else {
    if (lagna.length) parts.push(`${lagna.join(", ")} from the lagna`);
    if (moon.length) parts.push(`${moon.join(", ")} from the Moon`);
  }
  return parts.join("; ");
}

/** Marriage-implications prose, keyed off status + cancellation state. */
function marriageImplicationsText(loc: string, d: MangalDoshaData): string {
  const l = pickLocale(loc);
  if (!d.HasDosha) {
    if (l === "hi")
      return "विवाह के दृष्टिकोण से मंगल दोष से सम्बंधित कोई बाधा नहीं है। मेल मिलान सामान्य रूप से किया जा सकता है।";
    if (l === "mr")
      return "विवाहाच्या दृष्टीने मंगळ दोषाशी संबंधित कोणताही अडथळा नाही. मेळ जुळवणी सामान्यपणे केली जाऊ शकते.";
    return "From a marriage standpoint, there is no Mangal Dosha-related obstacle. Match making can proceed normally.";
  }
  if (d.Cancelled) {
    if (l === "hi")
      return "यद्यपि मंगल दोष उपस्थित है, परन्तु शास्त्रीय परिहार लागू होने से इसका प्रभाव क्षीण हो जाता है। मेल मिलान में सामान्यतः इसे महत्वपूर्ण बाधा नहीं माना जाता।";
    if (l === "mr")
      return "जरी मंगळ दोष उपस्थित आहे, तरी शास्त्रीय परिहार लागू असल्याने त्याचा प्रभाव कमी होतो. मेळ जुळवणीत साधारणपणे हा महत्त्वाचा अडथळा मानला जात नाही.";
    return "Although Mangal Dosha is present, classical cancellation rules apply and substantially reduce its effect. Match making typically does not treat this as a significant obstacle.";
  }
  if (d.Status === "purn") {
    if (l === "hi")
      return "पूर्ण मंगल दोष विवाह सम्बन्धों में चुनौतियाँ ला सकता है। पारंपरिक रूप से अनुशंसित है कि साथी की कुंडली में भी मंगल दोष हो (या समान भारता हो), जिससे प्रभाव संतुलित हो जाए। ज्योतिषीय परामर्श एवं उचित मेल मिलान महत्वपूर्ण है।";
    if (l === "mr")
      return "पूर्ण मंगळ दोष विवाह संबंधांत आव्हाने आणू शकतो. पारंपरिकपणे शिफारस केली जाते की जोडीदाराच्या कुंडलीतही मंगळ दोष असावा (किंवा समान तीव्रता), ज्यामुळे परिणाम संतुलित होतो. ज्योतिषीय सल्ला आणि योग्य मेळ जुळवणी महत्त्वाची आहे.";
    return "Full Mangal Dosha can introduce challenges in marriage relationships. Tradition recommends that the partner's chart also carry Mangal Dosha (or comparable intensity) so the effect is balanced between the two. Astrological consultation and careful match making are important.";
  }
  if (l === "hi")
    return "अल्प मंगल दोष का प्रभाव सीमित होता है, परन्तु मेल मिलान करते समय इसे ध्यान में रखना उचित है। योग्य ज्योतिषी से परामर्श लेकर साथी की कुंडली का विश्लेषण कराएँ।";
  if (l === "mr")
    return "अल्प मंगळ दोषाचा प्रभाव मर्यादित असतो, परंतु मेळ जुळवणी करताना याचा विचार करणे योग्य आहे. पात्र ज्योतिषाचा सल्ला घेऊन जोडीदाराच्या कुंडलीचे विश्लेषण करा.";
  return "Mild Mangal Dosha has limited effect, but it is prudent to factor it in during match making. Consult a qualified astrologer to analyze the partner's chart in context.";
}

/** Remedies for the given status (falls back to "mild" then English). */
function mangalRemediesList(loc: string, status: string | undefined): string[] {
  const m = REMEDIES[pickLocale(loc)] ?? REMEDIES.en ?? {};
  return m[status ?? ""] ?? m.mild ?? REMEDIES.en?.mild ?? [];
}

// ---------------------------------------------------------------------------
// Report-specific CSS (the bits BASE_CSS doesn't already cover)
// ---------------------------------------------------------------------------

const EXTRA_CSS = `
.cover .status-badge {
  display: inline-block; margin-top: 10mm; padding: 4mm 10mm;
  font-size: 18pt; font-weight: 700; border-radius: 2mm;
}
.cover .status-badge.purn      { background: #fef2f2; color: #dc2626; border: 2px solid #dc2626; }
.cover .status-badge.mild      { background: #fff7ed; color: #ea580c; border: 2px solid #ea580c; }
.cover .status-badge.none      { background: #f0fdf4; color: #16a34a; border: 2px solid #16a34a; }
.cover .status-badge.cancelled { background: #fefce8; color: #ca8a04; border: 2px solid #ca8a04; }
.diagnostic {
  margin: 4mm 0; padding: 5mm; background: #fafafa; border-left: 3px solid var(--brand-primary);
}
.diagnostic dl { margin: 0; }
.diagnostic dt {
  font-weight: 600; color: var(--brand-secondary); font-size: 10pt;
  text-transform: uppercase; letter-spacing: 0.5pt; margin-top: 2mm;
}
.diagnostic dd { margin: 0 0 2mm; font-size: 11pt; }
.cancellation {
  margin: 4mm 0; padding: 5mm; background: #fefce8; border-left: 3px solid #ca8a04;
}
.cancellation ul { margin: 2mm 0 0 6mm; padding: 0; }
.remedies {
  margin: 4mm 0; padding: 5mm; background: #fafafa; border-left: 3px solid var(--brand-secondary);
}
.remedies ul { margin: 2mm 0 0 6mm; padding: 0; }
`;

// ---------------------------------------------------------------------------
// Public renderer
// ---------------------------------------------------------------------------

/**
 * Render the Mangal Dosha report as a complete, self-contained HTML document
 * ready to convert to PDF.
 */
export function renderMangalDoshaHtml(data: MangalDoshaData, branding?: Branding): string {
  const loc = data.Locale ?? "";
  const b = resolveBranding(data.Branding, branding);
  const subject = data.Subject ?? {};
  const mars = data.MarsPlacement ?? {};
  const title = label(loc, "title_mangal");

  // --- Cover with status badge ---------------------------------------------
  const cover = `<section class="cover">
  ${coverBrandingHtml(b)}
  <h1>${esc(title)}</h1>
  <div class="subject">${esc(subject.name)}</div>
  <div class="meta">
    ${esc(label(loc, "born"))} ${esc(subject.birth_date)} ${esc(label(loc, "at"))} ${esc(subject.birth_time)}<br>
    ${esc(subject.birth_place)}<br>
    ${esc(label(loc, "ascendant"))}: ${esc(subject.ascendant_sign)}
  </div>
  <div class="status-badge ${esc(badgeClass(data))}">${esc(statusBadgeText(loc, data))}</div>
  <div class="generated">${esc(label(loc, "generated"))} ${esc(formatGenerated(data.GeneratedAt))}</div>
</section>`;

  // --- Diagnostic block ----------------------------------------------------
  const housesText = formatHouses(loc, data.HousesOccupied) || "—";
  const diagnostic = `<h2>${esc(label(loc, "section_diagnostic"))}</h2>
<div class="diagnostic">
  <dl>
    <dt>${esc(label(loc, "mars_sign"))}</dt>
    <dd>${esc(mars.sign)} (${esc(mars.dms_within)})</dd>
    <dt>${esc(label(loc, "mars_nakshatra"))}</dt>
    <dd>${esc(mars.nakshatra)}, ${esc(label(loc, "pada"))} ${esc(mars.pada)}</dd>
    <dt>${esc(label(loc, "mars_houses"))}</dt>
    <dd>${esc(housesText)}</dd>
    <dt>${esc(label(loc, "diagnosis"))}</dt>
    <dd>${esc(diagnosisText(loc, data))}</dd>
  </dl>
</div>`;

  // --- Cancellation block (only when applicable) ---------------------------
  let cancellation = "";
  if (data.Cancelled) {
    const reasons = Array.isArray(data.CancelReasons) ? data.CancelReasons : [];
    cancellation = `<h2>${esc(label(loc, "section_cancellation"))}</h2>
<div class="cancellation">
  <p>${esc(label(loc, "cancellation_intro"))}</p>
  <ul>
    ${reasons.map((r) => `<li>${esc(r)}</li>`).join("\n    ")}
  </ul>
</div>`;
  }

  // --- Marriage implications -----------------------------------------------
  const marriage = `<h2>${esc(label(loc, "section_marriage"))}</h2>
<p>${esc(marriageImplicationsText(loc, data))}</p>`;

  // --- Remedies ------------------------------------------------------------
  const remedies = `<h2>${esc(label(loc, "section_remedies"))}</h2>
<div class="remedies">
  <p>${esc(label(loc, "remedies_intro"))}</p>
  <ul>
    ${mangalRemediesList(loc, data.Status)
      .map((r) => `<li>${esc(r)}</li>`)
      .join("\n    ")}
  </ul>
</div>`;

  const bodyHtml = [cover, diagnostic, cancellation, marriage, remedies]
    .filter((s) => s !== "")
    .join("\n\n");

  return layoutDocument({ lang: loc || "en", title, branding: b, bodyHtml, extraCss: EXTRA_CSS });
}
