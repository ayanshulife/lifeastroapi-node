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
  te: {
    title_match: "జాతక పొంతన: వివాహ అనుకూలత",
    born: "జననం",
    generated: "రూపొందించిన తేదీ",
    section_ashtakoota: "అష్టకూట: 8 కూటాల పొంతన",
    section_doshas: "దోషాలు",
    section_final: "తుది నిర్ణయం",
    koota: "కూటం",
    max: "గరిష్ఠం",
    score: "గుణాలు",
    details: "వివరాలు",
    total: "మొత్తం",
    nakshatra: "నక్షత్రం",
    ashtakoota_verdict: "అష్టకూట నిర్ణయం",
    mangal_dosha: "కుజ దోషం",
    nadi_dosha: "నాడీ దోషం",
  },
  ta: {
    title_match: "ஜாதகப் பொருத்தம்: திருமண இணக்கம்",
    born: "பிறப்பு",
    generated: "தயாரித்த நாள்",
    section_ashtakoota: "அஷ்டகூடம்: 8 கூடப் பொருத்தம்",
    section_doshas: "தோஷங்கள்",
    section_final: "இறுதி முடிவு",
    koota: "கூடம்",
    max: "அதிகபட்சம்",
    score: "புள்ளிகள்",
    details: "விவரம்",
    total: "மொத்தம்",
    nakshatra: "நட்சத்திரம்",
    ashtakoota_verdict: "அஷ்டகூட முடிவு",
    mangal_dosha: "செவ்வாய் தோஷம்",
    nadi_dosha: "நாடி தோஷம்",
  },
  kn: {
    title_match: "ಜಾತಕ ಹೊಂದಾಣಿಕೆ: ವಿವಾಹ ಅನುರೂಪತೆ",
    born: "ಜನನ",
    generated: "ತಯಾರಿಸಿದ ದಿನಾಂಕ",
    section_ashtakoota: "ಅಷ್ಟಕೂಟ: 8 ಕೂಟಗಳ ಹೊಂದಾಣಿಕೆ",
    section_doshas: "ದೋಷಗಳು",
    section_final: "ಅಂತಿಮ ನಿರ್ಣಯ",
    koota: "ಕೂಟ",
    max: "ಗರಿಷ್ಠ",
    score: "ಗುಣ",
    details: "ವಿವರ",
    total: "ಒಟ್ಟು",
    nakshatra: "ನಕ್ಷತ್ರ",
    ashtakoota_verdict: "ಅಷ್ಟಕೂಟ ನಿರ್ಣಯ",
    mangal_dosha: "ಮಂಗಳ ದೋಷ",
    nadi_dosha: "ನಾಡಿ ದೋಷ",
  },
  ml: {
    title_match: "ജാതകപ്പൊരുത്തം: വിവാഹയോഗ്യത",
    born: "ജനനം",
    generated: "തയ്യാറാക്കിയ തീയതി",
    section_ashtakoota: "അഷ്ടകൂടം: 8 കൂടങ്ങളുടെ പൊരുത്തം",
    section_doshas: "ദോഷങ്ങൾ",
    section_final: "അന്തിമ നിഗമനം",
    koota: "കൂടം",
    max: "പരമാവധി",
    score: "ഗുണം",
    details: "വിശദാംശം",
    total: "ആകെ",
    nakshatra: "നക്ഷത്രം",
    ashtakoota_verdict: "അഷ്ടകൂട നിഗമനം",
    mangal_dosha: "ചൊവ്വാദോഷം",
    nadi_dosha: "നാഡീദോഷം",
  },
  gu: {
    title_match: "કુંડળી મેળાપ: વિવાહ પાત્રતા",
    born: "જન્મ",
    generated: "તૈયાર",
    section_ashtakoota: "અષ્ટકૂટ: 8 ગુણ મેળાપ",
    section_doshas: "દોષ",
    section_final: "અંતિમ નિષ્કર્ષ",
    koota: "કૂટ",
    max: "મહત્તમ",
    score: "ગુણ",
    details: "વિગત",
    total: "કુલ",
    nakshatra: "નક્ષત્ર",
    ashtakoota_verdict: "અષ્ટકૂટ નિષ્કર્ષ",
    mangal_dosha: "મંગળ દોષ",
    nadi_dosha: "નાડી દોષ",
  },
  bn: {
    title_match: "কুণ্ডলী মিলন: যোটক বিচার",
    born: "জন্ম",
    generated: "তৈরি",
    section_ashtakoota: "অষ্টকূট: 8 গুণের মিলন",
    section_doshas: "দোষ",
    section_final: "চূড়ান্ত সিদ্ধান্ত",
    koota: "কূট",
    max: "সর্বোচ্চ",
    score: "প্রাপ্ত গুণ",
    details: "বিবরণ",
    total: "মোট",
    nakshatra: "নক্ষত্র",
    ashtakoota_verdict: "অষ্টকূটের সিদ্ধান্ত",
    mangal_dosha: "মাঙ্গলিক দোষ",
    nadi_dosha: "নাড়ী দোষ",
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
  te: { poor: "తక్కువ", fair: "సాధారణం", good: "మంచిది", excellent: "ఉత్తమం" },
  ta: { poor: "குறைவு", fair: "சுமார்", good: "நல்லது", excellent: "உத்தமம்" },
  kn: { poor: "ಕಡಿಮೆ", fair: "ಸಾಧಾರಣ", good: "ಉತ್ತಮ", excellent: "ಅತ್ಯುತ್ತಮ" },
  ml: { poor: "കുറവ്", fair: "സാധാരണം", good: "നല്ലത്", excellent: "ഉത്തമം" },
  gu: { poor: "અલ્પ", fair: "સામાન્ય", good: "સારું", excellent: "ઉત્તમ" },
  bn: { poor: "অল্প", fair: "সাধারণ", good: "ভালো", excellent: "উত্তম" },
};

/** Verdict, dosha and nadi prose for te / ta / kn / ml / gu / bn (written from the Hindi). */
interface SouthMatchProse {
  verdict: { excellent: string; good: string; fair: string; poor: string };
  mangalNotComputed: string;
  mangalNone: string;
  typePurn: string;
  typeMild: string;
  fromLagna: (hs: string) => string;
  fromMoon: (hs: string) => string;
  mangal: (type: string, houses: string) => string;
  cancelled: string;
  nadiNone: (boy: string, girl: string) => string;
  nadiExempted: (exc: string) => string;
  nadiHigh: (boy: string) => string;
}

const SOUTH_MATCH: Record<string, SouthMatchProse> = {
  te: {
    verdict: {
      excellent: "ఉత్తమ పొంతన: అన్ని రంగాలలో సామరస్యానికి అవకాశం ఎక్కువ.",
      good: "మంచి పొంతన: వివాహానికి అనుకూల సూచనలు ఉన్నాయి.",
      fair: "సాధారణ పొంతన: కొన్ని కూటాలలో లోటు ఉంది, అయినా ముందుకు సాగవచ్చు.",
      poor: "తక్కువ పొంతన: చాలా కూటాలలో లోటు ఉంది, జాగ్రత్తగా ఆలోచించడం అవసరం.",
    },
    mangalNotComputed: "కుజ దోషం పరిశీలించలేదు: జన్మ స్థలం (అక్షాంశం/రేఖాంశం) ఇవ్వలేదు.",
    mangalNone: "కుజ దోషం లేదు.",
    typePurn: "పూర్ణ",
    typeMild: "స్వల్ప",
    fromLagna: (hs) => `లగ్నం నుండి ${hs}`,
    fromMoon: (hs) => `చంద్రుని నుండి ${hs}`,
    mangal: (type, houses) => `కుజ దోషం (${type}), భావం: ${houses}.`,
    cancelled: " నివృత్తి: ",
    nadiNone: (boy, girl) => `నాడీ దోషం లేదు. (వరుడు: ${boy}, వధువు: ${girl})`,
    nadiExempted: (exc) => `నాడీ దోషం ఉంది, కానీ శాస్త్రీయ మినహాయింపు వల్ల రద్దయింది (${exc})`,
    nadiHigh: (boy) => `నాడీ దోషం: ఇద్దరిదీ ఒకే నాడి (${boy}). శాస్త్రపరంగా ప్రతికూలం.`,
  },
  ta: {
    verdict: {
      excellent: "உத்தமப் பொருத்தம்: எல்லாத் துறைகளிலும் இணக்கத்துக்கான வாய்ப்பு அதிகம்.",
      good: "நல்ல பொருத்தம்: திருமணத்துக்குச் சாதகமான அறிகுறிகள் உள்ளன.",
      fair: "சுமாரான பொருத்தம்: சில கூடங்களில் குறை உள்ளது, ஆனாலும் முன்னேறலாம்.",
      poor: "குறைவான பொருத்தம்: பல கூடங்களில் குறை உள்ளது, கவனமாக யோசிப்பது அவசியம்.",
    },
    mangalNotComputed: "செவ்வாய் தோஷம் சரிபார்க்கப்படவில்லை: பிறந்த இடம் (அட்சரேகை/தீர்க்கரேகை) கொடுக்கப்படவில்லை.",
    mangalNone: "செவ்வாய் தோஷம் இல்லை.",
    typePurn: "முழு",
    typeMild: "லேசான",
    fromLagna: (hs) => `லக்னத்திலிருந்து ${hs}`,
    fromMoon: (hs) => `சந்திரனிலிருந்து ${hs}`,
    mangal: (type, houses) => `செவ்வாய் தோஷம் (${type}), வீடு: ${houses}.`,
    cancelled: " நிவர்த்தி: ",
    nadiNone: (boy, girl) => `நாடி தோஷம் இல்லை. (மணமகன்: ${boy}, மணமகள்: ${girl})`,
    nadiExempted: (exc) => `நாடி தோஷம் உள்ளது, ஆனால் சாஸ்திர விதிவிலக்கால் நீங்குகிறது (${exc})`,
    nadiHigh: (boy) => `நாடி தோஷம்: இருவருக்கும் ஒரே நாடி (${boy}). சாஸ்திரப்படி பாதகமானது.`,
  },
  kn: {
    verdict: {
      excellent: "ಅತ್ಯುತ್ತಮ ಹೊಂದಾಣಿಕೆ: ಎಲ್ಲಾ ಕ್ಷೇತ್ರಗಳಲ್ಲೂ ಸಾಮರಸ್ಯದ ಸಾಧ್ಯತೆ ಹೆಚ್ಚು.",
      good: "ಉತ್ತಮ ಹೊಂದಾಣಿಕೆ: ವಿವಾಹಕ್ಕೆ ಅನುಕೂಲಕರ ಸೂಚನೆಗಳಿವೆ.",
      fair: "ಸಾಧಾರಣ ಹೊಂದಾಣಿಕೆ: ಕೆಲವು ಕೂಟಗಳಲ್ಲಿ ಕೊರತೆ ಇದೆ, ಆದರೂ ಮುಂದುವರಿಯಬಹುದು.",
      poor: "ಕಡಿಮೆ ಹೊಂದಾಣಿಕೆ: ಹಲವು ಕೂಟಗಳಲ್ಲಿ ಕೊರತೆ ಇದೆ, ಎಚ್ಚರಿಕೆಯಿಂದ ಯೋಚಿಸುವುದು ಅಗತ್ಯ.",
    },
    mangalNotComputed: "ಮಂಗಳ ದೋಷ ಪರಿಶೀಲಿಸಿಲ್ಲ: ಜನ್ಮ ಸ್ಥಳ (ಅಕ್ಷಾಂಶ/ರೇಖಾಂಶ) ನೀಡಿಲ್ಲ.",
    mangalNone: "ಮಂಗಳ ದೋಷ ಇಲ್ಲ.",
    typePurn: "ಪೂರ್ಣ",
    typeMild: "ಅಲ್ಪ",
    fromLagna: (hs) => `ಲಗ್ನದಿಂದ ${hs}`,
    fromMoon: (hs) => `ಚಂದ್ರನಿಂದ ${hs}`,
    mangal: (type, houses) => `ಮಂಗಳ ದೋಷ (${type}), ಭಾವ: ${houses}.`,
    cancelled: " ನಿವಾರಣೆ: ",
    nadiNone: (boy, girl) => `ನಾಡಿ ದೋಷ ಇಲ್ಲ. (ವರ: ${boy}, ವಧು: ${girl})`,
    nadiExempted: (exc) => `ನಾಡಿ ದೋಷ ಇದೆ, ಆದರೆ ಶಾಸ್ತ್ರೀಯ ವಿನಾಯಿತಿಯಿಂದ ರದ್ದಾಗಿದೆ (${exc})`,
    nadiHigh: (boy) => `ನಾಡಿ ದೋಷ: ಇಬ್ಬರದೂ ಒಂದೇ ನಾಡಿ (${boy}). ಶಾಸ್ತ್ರದ ಪ್ರಕಾರ ಪ್ರತಿಕೂಲ.`,
  },
  ml: {
    verdict: {
      excellent: "ഉത്തമ പൊരുത്തം: എല്ലാ മേഖലകളിലും ഐക്യത്തിനുള്ള സാധ്യത കൂടുതലാണ്.",
      good: "നല്ല പൊരുത്തം: വിവാഹത്തിന് അനുകൂലമായ സൂചനകളുണ്ട്.",
      fair: "സാധാരണ പൊരുത്തം: ചില കൂടങ്ങളിൽ കുറവുണ്ട്, എങ്കിലും മുന്നോട്ട് പോകാം.",
      poor: "കുറഞ്ഞ പൊരുത്തം: പല കൂടങ്ങളിലും കുറവുണ്ട്, ശ്രദ്ധാപൂർവം ആലോചിക്കേണ്ടതുണ്ട്.",
    },
    mangalNotComputed: "ചൊവ്വാദോഷം പരിശോധിച്ചിട്ടില്ല: ജനനസ്ഥലം (അക്ഷാംശം/രേഖാംശം) നൽകിയിട്ടില്ല.",
    mangalNone: "ചൊവ്വാദോഷം ഇല്ല.",
    typePurn: "പൂർണ",
    typeMild: "അൽപ",
    fromLagna: (hs) => `ലഗ്നത്തിൽ നിന്ന് ${hs}`,
    fromMoon: (hs) => `ചന്ദ്രനിൽ നിന്ന് ${hs}`,
    mangal: (type, houses) => `ചൊവ്വാദോഷം (${type}), ഭാവം: ${houses}.`,
    cancelled: " പരിഹാരം: ",
    nadiNone: (boy, girl) => `നാഡീദോഷം ഇല്ല. (വരൻ: ${boy}, വധു: ${girl})`,
    nadiExempted: (exc) => `നാഡീദോഷം ഉണ്ട്, എന്നാൽ ശാസ്ത്രീയ ഇളവിനാൽ റദ്ദാകുന്നു (${exc})`,
    nadiHigh: (boy) => `നാഡീദോഷം: ഇരുവർക്കും ഒരേ നാഡി (${boy}). ശാസ്ത്രപ്രകാരം പ്രതികൂലം.`,
  },
  gu: {
    verdict: {
      excellent: "ઉત્તમ મેળાપ: તમામ ક્ષેત્રોમાં સામંજસ્યની સંભાવના વધુ છે.",
      good: "સારો મેળાપ: વિવાહ માટે અનુકૂળ યોગ છે.",
      fair: "સામાન્ય મેળાપ: કેટલાક કૂટોમાં ઊણપ છે, છતાં આગળ વધી શકાય છે.",
      poor: "અલ્પ મેળાપ: ઘણા કૂટોમાં ઊણપ છે, કાળજીપૂર્વક વિચાર કરવો આવશ્યક છે.",
    },
    mangalNotComputed: "મંગળ દોષની તપાસ થઈ નથી: જન્મસ્થળ (અક્ષાંશ/રેખાંશ) આપવામાં આવ્યું નથી.",
    mangalNone: "મંગળ દોષ નથી.",
    typePurn: "પૂર્ણ",
    typeMild: "અલ્પ",
    fromLagna: (hs) => `લગ્નથી ${hs}`,
    fromMoon: (hs) => `ચંદ્રથી ${hs}`,
    mangal: (type, houses) => `મંગળ દોષ (${type}), ભાવ: ${houses}.`,
    cancelled: " નિવારણ: ",
    nadiNone: (boy, girl) => `નાડી દોષ નથી. (વર: ${boy}, વધૂ: ${girl})`,
    nadiExempted: (exc) => `નાડી દોષ છે, પરંતુ શાસ્ત્રીય અપવાદને કારણે રદ થાય છે (${exc})`,
    nadiHigh: (boy) => `નાડી દોષ: બંનેની નાડી એક જ છે (${boy}). શાસ્ત્રીય રીતે પ્રતિકૂળ.`,
  },
  bn: {
    verdict: {
      excellent: "উত্তম মিলন: সব ক্ষেত্রে সামঞ্জস্যের সম্ভাবনা বেশি।",
      good: "ভালো মিলন: বিবাহের জন্য অনুকূল যোগ।",
      fair: "সাধারণ মিলন: কয়েকটি কূটে ঘাটতি আছে, তবু এগোনো যায়।",
      poor: "অল্প মিলন: অনেক কূটে ঘাটতি আছে, ভেবেচিন্তে সিদ্ধান্ত নেওয়া জরুরি।",
    },
    mangalNotComputed: "মাঙ্গলিক দোষের পরীক্ষা হয়নি: জন্মস্থান (অক্ষাংশ/দ্রাঘিমাংশ) দেওয়া হয়নি।",
    mangalNone: "মাঙ্গলিক দোষ নেই।",
    typePurn: "পূর্ণ",
    typeMild: "অল্প",
    fromLagna: (hs) => `লগ্ন থেকে ${hs}`,
    fromMoon: (hs) => `চন্দ্র থেকে ${hs}`,
    mangal: (type, houses) => `মাঙ্গলিক দোষ (${type}), ভাব: ${houses}।`,
    cancelled: " নিবারণ: ",
    nadiNone: (boy, girl) => `নাড়ী দোষ নেই। (পাত্র: ${boy}, পাত্রী: ${girl})`,
    nadiExempted: (exc) => `নাড়ী দোষ আছে, তবে শাস্ত্রীয় ব্যতিক্রমের কারণে তা খণ্ডিত হয় (${exc})`,
    nadiHigh: (boy) => `নাড়ী দোষ: দুজনেরই একই নাড়ী (${boy})। শাস্ত্রমতে প্রতিকূল।`,
  },
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
  const south = SOUTH_MATCH[l];
  if (south) {
    if (verdict === "excellent" || verdict === "good" || verdict === "fair") return south.verdict[verdict];
    return south.verdict.poor;
  }
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
  const south = SOUTH_MATCH[l];
  if (south) {
    if (!d.Computed) return south.mangalNotComputed;
    if (!d.HasDosha) return south.mangalNone;
    const type = d.Type === "purn" ? south.typePurn : d.Type === "mild" ? south.typeMild : (d.Type ?? "");
    const hs = d.HousesOccupied ?? [];
    const lag = hs.filter((h) => h > 0).map(String);
    const moon = hs.filter((h) => h < 0).map((h) => String(-h));
    const parts: string[] = [];
    if (lag.length) parts.push(south.fromLagna(lag.join(", ")));
    if (moon.length) parts.push(south.fromMoon(moon.join(", ")));
    let out = south.mangal(type, parts.join("; "));
    if (d.Cancelled) out += south.cancelled + joinStrings(d.CancelReasons, ", ");
    return out;
  }
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
  const south = SOUTH_MATCH[l];
  if (south) {
    if (n.Severity === "none") return south.nadiNone(boy, girl);
    if (n.Severity === "exempted") return south.nadiExempted(joinStrings(n.Exceptions, ", "));
    return south.nadiHigh(boy);
  }
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
    return "Marriage indications are favorable. Study both charts for the timing.";
  }
  return "Score is below conventional threshold (24/36). Consider remedies and a detailed study of both charts.";
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
