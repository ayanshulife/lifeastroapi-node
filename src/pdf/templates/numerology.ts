/**
 * Numerology Report → HTML.
 *
 * Ported from the server-side Go template `internal/pdf/numerology.go` so the
 * SDK-rendered PDF matches the API's design. Consumes the JSON returned by
 * `client.reports.numerology(...)`.
 *
 * The captured response (`/v1/reports/numerology`) returns the compute subset
 * with snake_case keys: `dob`, `driver`, `conductor`, `driver_factors`,
 * `conductor_factors`, `compatible_drivers`. The full PDF struct additionally
 * carries soul/personality/destiny (+ their factors), subject name, branding,
 * locale and generated timestamp — modelled here optionally so a richer
 * payload renders the same way the Go template does.
 *
 * JSON key casing rule applied per field:
 *   - factor sub-fields have explicit json tags → snake/lowercase (number,
 *     planet, day, color, gemstone, deity, direction)
 *   - top-level compute keys are tagged → dob, driver, conductor,
 *     driver_factors, conductor_factors, compatible_drivers
 *   - PDF-only fields (Subject, Branding, Locale, GeneratedAt) have NO json
 *     tag in Go → PascalCase
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

/** Lucky-factor block for a single number (factor sub-fields are json-tagged). */
export interface NumerologyFactors {
  number?: number;
  planet?: string;
  day?: string;
  color?: string;
  gemstone?: string;
  deity?: string;
  direction?: string;
}

/** Cover-page subject header (Go `NumerologySubject`, no json tags → PascalCase). */
export interface NumerologySubject {
  Name?: string;
  DOB?: string;
}

/** Numerology report payload (exact JSON keys; optional generous). */
export interface NumerologyData {
  // Compute-result keys as returned by the endpoint (json-tagged → lowercase).
  dob?: string;
  driver?: number;
  conductor?: number;
  soul?: number;
  personality?: number;
  destiny?: number;
  driver_factors?: NumerologyFactors;
  conductor_factors?: NumerologyFactors;
  soul_factors?: NumerologyFactors;
  personality_factors?: NumerologyFactors;
  destiny_factors?: NumerologyFactors;
  compatible_drivers?: number[];

  // PDF-struct extras (Go fields without json tags → PascalCase).
  Locale?: string;
  Branding?: RawBranding;
  Subject?: NumerologySubject;
  GeneratedAt?: string;
}

/**
 * i18n labels — ported verbatim from `numerologyLabels` in numerology.go.
 */
const LABELS: Record<string, Record<string, string>> = {
  en: {
    title: "Numerology Report",
    born: "Born",
    generated: "Generated on",
    driver: "Driver",
    driver_alt: "Mulank / Birth Number",
    conductor: "Conductor",
    conductor_alt: "Bhagyank / Life Path",
    soul: "Soul",
    personality: "Personality",
    destiny: "Destiny",
    section_driver: "Driver Number",
    section_conductor: "Conductor Number",
    section_soul: "Soul Number",
    section_personality: "Personality Number",
    section_destiny: "Destiny Number",
    section_compatibility: "Compatible Numbers",
    compat_intro: "Driver numbers that harmonize with yours",
  },
  hi: {
    title: "अंक ज्योतिष रिपोर्ट",
    born: "जन्म",
    generated: "तैयार",
    driver: "मूलांक",
    driver_alt: "जन्म तिथि अंक",
    conductor: "भाग्यांक",
    conductor_alt: "जीवन पथ",
    soul: "अंतरात्मा अंक",
    personality: "व्यक्तित्व अंक",
    destiny: "नाम अंक",
    section_driver: "मूलांक",
    section_conductor: "भाग्यांक",
    section_soul: "अंतरात्मा अंक",
    section_personality: "व्यक्तित्व अंक",
    section_destiny: "नाम अंक",
    section_compatibility: "संगत अंक",
    compat_intro: "आपके मूलांक के साथ अनुकूल अंक",
  },
  mr: {
    title: "अंकशास्त्र अहवाल",
    born: "जन्म",
    generated: "तयार",
    driver: "मूलांक",
    driver_alt: "जन्म तारीख अंक",
    conductor: "भाग्यांक",
    conductor_alt: "जीवन मार्ग",
    soul: "आत्मा अंक",
    personality: "व्यक्तिमत्त्व अंक",
    destiny: "नाम अंक",
    section_driver: "मूलांक",
    section_conductor: "भाग्यांक",
    section_soul: "आत्मा अंक",
    section_personality: "व्यक्तिमत्त्व अंक",
    section_destiny: "नाम अंक",
    section_compatibility: "अनुकूल अंक",
    compat_intro: "आपल्या मूलांकाशी जुळणारे अंक",
  },
};

/**
 * Factor-grid cell labels — ported verbatim from `factorLabels` in
 * numerology.go. (The Go template's `factorLabel` helper only looked these up
 * under English because its partial didn't carry the page locale; here we have
 * the locale in scope, so we localize properly with an English fallback.)
 */
const FACTOR_LABELS: Record<string, Record<string, string>> = {
  en: {
    planet: "Planet",
    day: "Day",
    color: "Color",
    gemstone: "Gemstone",
    deity: "Deity",
    direction: "Direction",
  },
  hi: {
    planet: "ग्रह",
    day: "दिवस",
    color: "रंग",
    gemstone: "रत्न",
    deity: "देव",
    direction: "दिशा",
  },
  mr: {
    planet: "ग्रह",
    day: "दिवस",
    color: "रंग",
    gemstone: "रत्न",
    deity: "देवता",
    direction: "दिशा",
  },
};

/**
 * One-paragraph interpretation per (locale, value) — ported verbatim from
 * `numberMeanings` in numerology.go. Master numbers keyed as "11"/"22"/"33".
 */
const NUMBER_MEANINGS: Record<string, Record<string, string>> = {
  en: {
    "1": "Leadership, independence, originality. Strong willpower and capacity to initiate. Best as a self-starter; resists being managed.",
    "2": "Sensitivity, cooperation, partnership. Reads emotional currents well; thrives in collaborative settings.",
    "3": "Expression, creativity, optimism. Communication and learning are natural strengths; teaching, writing, and arts are favored.",
    "4": "Practicality, structure, hard work. Methodical and disciplined; builds enduring foundations through patience.",
    "5": "Freedom, change, versatility. Curious, adventurous, fast-learning; needs variety to stay engaged.",
    "6": "Responsibility, harmony, family. Nurturing temperament; finds purpose in caring for others and creating beauty.",
    "7": "Spirituality, introspection, analysis. Seeker of deeper truth; thrives in research, philosophy, and contemplative practice.",
    "8": "Power, ambition, material mastery. Strong drive for achievement; capable of building and managing wealth and enterprises.",
    "9": "Compassion, universality, completion. Humanitarian instincts; gives generously and inspires through example.",
    "11": "Master Intuitive — heightened spiritual sensitivity. Carries the energy of 2 amplified; visionary potential paired with nervous-system intensity.",
    "22": "Master Builder — capacity to manifest large-scale visions. Carries the energy of 4 amplified; turns ideals into concrete legacy.",
    "33": "Master Teacher — devotion combined with skill. Carries the energy of 6 amplified; lives as an example of compassionate service.",
  },
  hi: {
    "1": "नेतृत्व, स्वतंत्रता, मौलिकता। दृढ़ इच्छाशक्ति एवं पहल करने की क्षमता। आत्म-प्रेरित कार्यों में सर्वोत्तम; प्रबंधन में आना पसंद नहीं।",
    "2": "संवेदनशीलता, सहयोग, साझेदारी। भावनात्मक प्रवाह को अच्छे से पढ़ते हैं; सहयोगात्मक परिवेश में फलते-फूलते हैं।",
    "3": "अभिव्यक्ति, सृजनात्मकता, आशावाद। संचार एवं अधिगम स्वाभाविक शक्तियाँ; शिक्षण, लेखन, कला अनुकूल।",
    "4": "व्यावहारिकता, संरचना, परिश्रम। पद्धतिगत एवं अनुशासित; धैर्य से स्थायी आधार निर्मित करते हैं।",
    "5": "स्वतंत्रता, परिवर्तन, बहुमुखी प्रतिभा। जिज्ञासु, साहसी, शीघ्र सीखने वाले; जुड़े रहने हेतु विविधता आवश्यक।",
    "6": "उत्तरदायित्व, सामंजस्य, परिवार। पोषक स्वभाव; दूसरों की देखभाल एवं सौंदर्य रचना में उद्देश्य पाते हैं।",
    "7": "आध्यात्मिकता, आत्मनिरीक्षण, विश्लेषण। गहन सत्य के अन्वेषक; शोध, दर्शन, साधना में फलते हैं।",
    "8": "शक्ति, महत्वाकांक्षा, भौतिक दक्षता। उपलब्धि की प्रबल इच्छा; सम्पत्ति एवं उद्यम निर्माण में सक्षम।",
    "9": "करुणा, सार्वभौमिकता, पूर्णता। मानवतावादी प्रवृत्ति; उदारतापूर्वक देते हैं एवं उदाहरण द्वारा प्रेरित करते हैं।",
    "11": "मास्टर अंतर्दर्शी — उच्च आध्यात्मिक संवेदनशीलता। 2 की ऊर्जा का प्रवर्धित रूप; दूरदर्शी क्षमता के साथ तंत्रिका तीव्रता।",
    "22": "मास्टर निर्माता — विशाल दृष्टिकोण को साकार करने की क्षमता। 4 की ऊर्जा का प्रवर्धित रूप; आदर्शों को मूर्त विरासत में बदलते हैं।",
    "33": "मास्टर शिक्षक — कौशल के साथ समर्पण। 6 की ऊर्जा का प्रवर्धित रूप; करुणामयी सेवा का उदाहरण बनकर जीते हैं।",
  },
  mr: {
    "1": "नेतृत्व, स्वातंत्र्य, मौलिकता. दृढ इच्छाशक्ती आणि पुढाकार घेण्याची क्षमता. स्वतःहून सुरुवात करणाऱ्या कार्यांत उत्तम.",
    "2": "संवेदनशीलता, सहकार्य, भागीदारी. भावनिक प्रवाह उत्तम वाचतात; सहकार्यात्मक वातावरणात भरभराट होते.",
    "3": "अभिव्यक्ती, सर्जनशीलता, आशावाद. संवाद आणि शिक्षण नैसर्गिक शक्ती; शिकवणी, लेखन, कला अनुकूल.",
    "4": "व्यावहारिकता, रचना, परिश्रम. पद्धतशीर आणि शिस्तबद्ध; संयमाने टिकाऊ पाया उभारतात.",
    "5": "स्वातंत्र्य, बदल, बहुमुखी प्रतिभा. जिज्ञासू, साहसी, झपाट्याने शिकणारे; गुंतलेले राहण्यासाठी विविधता आवश्यक.",
    "6": "जबाबदारी, सुसंगती, कुटुंब. पोषण करणारा स्वभाव; इतरांची काळजी आणि सौंदर्य निर्मितीत हेतू सापडतो.",
    "7": "अध्यात्मिकता, आत्मचिंतन, विश्लेषण. खोल सत्याचे शोधक; संशोधन, तत्त्वज्ञान, साधनेत भरभराट.",
    "8": "शक्ती, महत्त्वाकांक्षा, भौतिक प्रभुत्व. यशाची प्रबळ इच्छा; संपत्ती आणि उद्योग बांधण्यात सक्षम.",
    "9": "करुणा, सार्वभौमिकता, पूर्णता. मानवतावादी प्रवृत्ती; उदारतेने देतात आणि उदाहरणाद्वारे प्रेरित करतात.",
    "11": "मास्टर अंतर्ज्ञानी — उच्च अध्यात्मिक संवेदनशीलता. 2 ची ऊर्जा वर्धित स्वरूपात; दूरदर्शी क्षमता.",
    "22": "मास्टर बांधकाम करणारा — मोठे स्वप्न प्रत्यक्षात आणण्याची क्षमता. 4 ची ऊर्जा वर्धित स्वरूपात.",
    "33": "मास्टर शिक्षक — कौशल्यासह समर्पण. 6 ची ऊर्जा वर्धित स्वरूपात; करुणामय सेवा हेच जगणे.",
  },
};

/** Mirror of Go `pickNumerologyLocale` — fall back to "en". */
function pickLocale(loc?: string): string {
  return loc && LABELS[loc] ? loc : "en";
}

/** Mirror of Go `numberMeaning` helper — locale lookup with English fallback. */
function numberMeaning(loc: string, n: number): string {
  const key = String(n);
  const table = NUMBER_MEANINGS[loc];
  return table?.[key] ?? NUMBER_MEANINGS.en?.[key] ?? "";
}

/** Render the value, or fallback when zero/undefined (mirror of Go `nz`). */
function nz(n: number | undefined, fallback: string): string {
  return n ? esc(n) : fallback;
}

const EXTRA_CSS = `
.cover .summary {
  display: grid;
  grid-template-columns: repeat(5, 1fr);
  gap: 4mm;
  margin: 12mm 0;
  padding: 0 8mm;
}
.summary-card {
  padding: 5mm;
  background: var(--brand-primary);
  color: #fff;
  border-radius: 2mm;
  text-align: center;
}
.summary-card .number { font-size: 22pt; font-weight: 700; line-height: 1; }
.summary-card .label {
  font-size: 9pt;
  margin-top: 2mm;
  letter-spacing: 0.3pt;
  text-transform: uppercase;
  opacity: 0.85;
}
.number-block { margin: 6mm 0; page-break-inside: avoid; }
.number-block .header-row { display: flex; align-items: baseline; gap: 4mm; margin-bottom: 3mm; }
.number-block .number {
  display: inline-block;
  padding: 2mm 5mm;
  background: var(--brand-primary);
  color: #fff;
  font-size: 20pt;
  font-weight: 700;
  border-radius: 1.5mm;
}
.number-block .name { font-size: 14pt; color: var(--brand-primary); }
.number-block .meaning { margin: 2mm 0 4mm; }
.factors-grid {
  display: grid;
  grid-template-columns: 1fr 1fr 1fr;
  gap: 2mm 6mm;
  padding: 4mm;
  background: #fafafa;
  border-left: 3px solid var(--brand-secondary);
}
.factors-grid dt {
  font-size: 9pt;
  color: var(--brand-secondary);
  text-transform: uppercase;
  letter-spacing: 0.5pt;
}
.factors-grid dd { margin: 0 0 2mm; font-size: 11pt; font-weight: 600; }
.compatibility {
  margin: 6mm 0;
  padding: 5mm;
  background: #fafafa;
  border-left: 3px solid var(--brand-primary);
}
.compatibility .label {
  font-size: 9pt;
  color: var(--brand-secondary);
  text-transform: uppercase;
  letter-spacing: 0.5pt;
  margin-bottom: 2mm;
}
.compatibility .numbers { display: flex; gap: 3mm; flex-wrap: wrap; }
.compatibility .num-chip {
  display: inline-block;
  padding: 2mm 5mm;
  background: var(--brand-primary);
  color: #fff;
  font-size: 14pt;
  font-weight: 600;
  border-radius: 1.5mm;
}
`;

/** Render the lucky-factors grid for a single number (Go `{{define "factors"}}`). */
function factorsHtml(
  factors: NumerologyFactors | undefined,
  fl: (key: string) => string,
): string {
  if (!factors) return "";
  return `<dl class="factors-grid">
  <dt>${esc(fl("planet"))}</dt><dd>${esc(factors.planet)}</dd>
  <dt>${esc(fl("day"))}</dt><dd>${esc(factors.day)}</dd>
  <dt>${esc(fl("color"))}</dt><dd>${esc(factors.color)}</dd>
  <dt>${esc(fl("gemstone"))}</dt><dd>${esc(factors.gemstone)}</dd>
  <dt>${esc(fl("deity"))}</dt><dd>${esc(factors.deity)}</dd>
  <dt>${esc(fl("direction"))}</dt><dd>${esc(factors.direction)}</dd>
</dl>`;
}

/** Render one per-number interpretation section (Go `.number-block`). */
function numberSection(
  value: number | undefined,
  sectionKey: string,
  nameHtml: string,
  factors: NumerologyFactors | undefined,
  locale: string,
  label: (key: string) => string,
  fl: (key: string) => string,
): string {
  if (!value) return ""; // Go `{{if .Driver}}` — zero suppresses the block.
  return `<h2>${esc(label(sectionKey))}</h2>
<div class="number-block">
  <div class="header-row">
    <span class="number">${esc(value)}</span>
    <span class="name">${nameHtml}</span>
  </div>
  <p class="meaning">${esc(numberMeaning(locale, value))}</p>
  ${factorsHtml(factors, fl)}
</div>`;
}

/**
 * Render the numerology report as a complete HTML document.
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

export function renderNumerologyHtml(data: NumerologyData, branding?: Branding): string {
  const b = resolveBranding(data.Branding, branding);
  const locale = pickLocale(data.Locale);
  const label = makeLabeler(LABELS, locale);
  const fl = makeLabeler(FACTOR_LABELS, locale);

  const subjectName = data.Subject?.Name ?? "";
  // DOB on the cover: prefer the subject header, else the compute `dob` key.
  const dob = data.Subject?.DOB ?? data.dob ?? "";

  // Cover with five summary cards (Driver, Conductor, Soul, Personality, Destiny).
  const cover = `<section class="cover">
  ${coverBrandingHtml(b)}
  <h1>${esc(label("title"))}</h1>
  <div class="subject">${esc(subjectName)}</div>
  <div class="meta">${esc(label("born"))} ${esc(dob)}</div>
  <div class="summary">
    <div class="summary-card"><div class="number">${nz(data.driver, "—")}</div><div class="label">${esc(label("driver"))}</div></div>
    <div class="summary-card"><div class="number">${nz(data.conductor, "—")}</div><div class="label">${esc(label("conductor"))}</div></div>
    <div class="summary-card"><div class="number">${nz(data.soul, "—")}</div><div class="label">${esc(label("soul"))}</div></div>
    <div class="summary-card"><div class="number">${nz(data.personality, "—")}</div><div class="label">${esc(label("personality"))}</div></div>
    <div class="summary-card"><div class="number">${nz(data.destiny, "—")}</div><div class="label">${esc(label("destiny"))}</div></div>
  </div>
  ${data.GeneratedAt ? `<div class="generated">${esc(label("generated"))} ${esc(formatGenerated(data.GeneratedAt))}</div>` : ""}
</section>`;

  // Per-number interpretation sections.
  const driverName = `${esc(label("driver"))} (${esc(label("driver_alt"))})`;
  const conductorName = `${esc(label("conductor"))} (${esc(label("conductor_alt"))})`;

  const sections = [
    numberSection(data.driver, "section_driver", driverName, data.driver_factors, locale, label, fl),
    numberSection(data.conductor, "section_conductor", conductorName, data.conductor_factors, locale, label, fl),
    numberSection(data.soul, "section_soul", esc(label("soul")), data.soul_factors, locale, label, fl),
    numberSection(data.personality, "section_personality", esc(label("personality")), data.personality_factors, locale, label, fl),
    numberSection(data.destiny, "section_destiny", esc(label("destiny")), data.destiny_factors, locale, label, fl),
  ]
    .filter(Boolean)
    .join("\n");

  // Compatibility chips.
  let compat = "";
  if (Array.isArray(data.compatible_drivers) && data.compatible_drivers.length) {
    const chips = data.compatible_drivers
      .map((n) => `<span class="num-chip">${esc(n)}</span>`)
      .join("\n      ");
    compat = `<h2>${esc(label("section_compatibility"))}</h2>
<div class="compatibility">
  <div class="label">${esc(label("compat_intro"))}</div>
  <div class="numbers">
      ${chips}
  </div>
</div>`;
  }

  const bodyHtml = [cover, sections, compat].filter(Boolean).join("\n");

  return layoutDocument({
    lang: locale,
    title: `${label("title")} — ${subjectName}`,
    branding: b,
    bodyHtml,
    extraCss: EXTRA_CSS,
  });
}
