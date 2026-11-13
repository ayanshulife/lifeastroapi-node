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
      "These traditional remedies are commonly recommended during Sade Sati phases. Check your full chart before adopting any:",
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
      "साढ़े साती के दौरान प्रचलित पारंपरिक उपाय निम्नलिखित हैं। किसी भी उपाय को अपनाने से पूर्व अपनी कुंडली को पूरी तरह जाँच लीजिए:",
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
      "साडेसाती कालखंडात सामान्यतः शिफारस केले जाणारे पारंपरिक उपाय खालील आहेत. कोणताही उपाय अंगीकारण्यापूर्वी आपली कुंडली पूर्णपणे तपासून घ्या:",
  },
  // te / ta / kn are written from the Hindi; Sade Sati is ఏలినాటి శని in
  // Telugu and ஏழரைச் சனி in Tamil. The Hindi "consult a qualified
  // astrologer" became "check your chart fully first" in every locale
  // (2026-11-07: no astrologer referral anywhere).
  te: {
    title_sade: "ఏలినాటి శని నివేదిక",
    born: "జననం",
    at: "సమయం",
    generated: "రూపొందించిన తేదీ",
    moon_sign: "చంద్ర రాశి",
    section_current: "ప్రస్తుత స్థితి",
    section_past: "గత ఏలినాటి శని కాలాలు",
    section_active_window: "ప్రస్తుత కాలం",
    section_future: "రాబోయే కాలాలు",
    section_remedies: "సూచించిన పరిహారాలు",
    current_phase: "ప్రస్తుత ఘట్టం",
    from: "ప్రారంభం",
    to: "ముగింపు",
    duration: "కాలవ్యవధి",
    signs_traversed: "గోచార రాశులు",
    no_past: "శోధించిన కాల పరిధిలో గత ఏలినాటి శని కాలాలు ఏవీ కనిపించలేదు.",
    no_future: "శోధించిన కాల పరిధిలో రాబోయే ఏలినాటి శని కాలాలు లేవు.",
    remedies_intro:
      "ఏలినాటి శని సమయంలో సాధారణంగా పాటించే సంప్రదాయ పరిహారాలు ఇవి. ఏ పరిహారాన్నైనా మొదలుపెట్టే ముందు మీ జాతకాన్ని పూర్తిగా పరిశీలించుకోండి:",
  },
  ta: {
    title_sade: "ஏழரைச் சனி அறிக்கை",
    born: "பிறப்பு",
    at: "நேரம்",
    generated: "தயாரித்த நாள்",
    moon_sign: "சந்திர ராசி",
    section_current: "தற்போதைய நிலை",
    section_past: "கடந்த ஏழரைச் சனி காலங்கள்",
    section_active_window: "நடப்புக் காலம்",
    section_future: "வரவிருக்கும் காலங்கள்",
    section_remedies: "பரிந்துரைக்கப்பட்ட பரிகாரங்கள்",
    current_phase: "நடப்புக் கட்டம்",
    from: "தொடக்கம்",
    to: "முடிவு",
    duration: "காலம்",
    signs_traversed: "கோசார ராசிகள்",
    no_past: "தேடிய கால வரம்பில் கடந்த ஏழரைச் சனி காலம் எதுவும் காணப்படவில்லை.",
    no_future: "தேடிய கால வரம்பில் வரவிருக்கும் ஏழரைச் சனி காலம் எதுவும் இல்லை.",
    remedies_intro:
      "ஏழரைச் சனி காலத்தில் வழக்கமாகக் கடைப்பிடிக்கப்படும் பாரம்பரியப் பரிகாரங்கள் இவை. எந்தப் பரிகாரத்தையும் தொடங்கும் முன் உங்கள் ஜாதகத்தை முழுமையாகச் சரிபார்த்துக்கொள்ளுங்கள்:",
  },
  kn: {
    title_sade: "ಸಾಡೇಸಾತಿ ವರದಿ",
    born: "ಜನನ",
    at: "ಸಮಯ",
    generated: "ತಯಾರಿಸಿದ ದಿನಾಂಕ",
    moon_sign: "ಚಂದ್ರ ರಾಶಿ",
    section_current: "ಪ್ರಸ್ತುತ ಸ್ಥಿತಿ",
    section_past: "ಹಿಂದಿನ ಸಾಡೇಸಾತಿ ಕಾಲಗಳು",
    section_active_window: "ಪ್ರಸ್ತುತ ಕಾಲ",
    section_future: "ಮುಂಬರುವ ಕಾಲಗಳು",
    section_remedies: "ಶಿಫಾರಸು ಮಾಡಿದ ಪರಿಹಾರಗಳು",
    current_phase: "ಪ್ರಸ್ತುತ ಹಂತ",
    from: "ಆರಂಭ",
    to: "ಅಂತ್ಯ",
    duration: "ಅವಧಿ",
    signs_traversed: "ಗೋಚರ ರಾಶಿಗಳು",
    no_past: "ಹುಡುಕಿದ ಕಾಲಮಿತಿಯಲ್ಲಿ ಹಿಂದಿನ ಸಾಡೇಸಾತಿ ಕಾಲ ಕಂಡುಬಂದಿಲ್ಲ.",
    no_future: "ಹುಡುಕಿದ ಕಾಲಮಿತಿಯಲ್ಲಿ ಮುಂಬರುವ ಸಾಡೇಸಾತಿ ಕಾಲ ಇಲ್ಲ.",
    remedies_intro:
      "ಸಾಡೇಸಾತಿಯ ಸಮಯದಲ್ಲಿ ಸಾಮಾನ್ಯವಾಗಿ ಪಾಲಿಸುವ ಸಾಂಪ್ರದಾಯಿಕ ಪರಿಹಾರಗಳು ಇವು. ಯಾವುದೇ ಪರಿಹಾರವನ್ನು ಆರಂಭಿಸುವ ಮೊದಲು ನಿಮ್ಮ ಜಾತಕವನ್ನು ಸಂಪೂರ್ಣವಾಗಿ ಪರಿಶೀಲಿಸಿಕೊಳ್ಳಿ:",
  },
  // ml: Sade Sati is ഏഴരശ്ശനി; same "check the chart fully" wording as te/ta/kn.
  ml: {
    title_sade: "ഏഴരശ്ശനി റിപ്പോർട്ട്",
    born: "ജനനം",
    at: "സമയം",
    generated: "തയ്യാറാക്കിയ തീയതി",
    moon_sign: "ചന്ദ്രരാശി",
    section_current: "നിലവിലെ സ്ഥിതി",
    section_past: "മുൻ ഏഴരശ്ശനി കാലങ്ങൾ",
    section_active_window: "നിലവിലെ കാലം",
    section_future: "വരാനിരിക്കുന്ന കാലങ്ങൾ",
    section_remedies: "നിർദ്ദേശിക്കുന്ന പരിഹാരങ്ങൾ",
    current_phase: "നിലവിലെ ഘട്ടം",
    from: "ആരംഭം",
    to: "അവസാനം",
    duration: "കാലയളവ്",
    signs_traversed: "ഗോചാര രാശികൾ",
    no_past: "പരിശോധിച്ച കാലപരിധിയിൽ മുൻ ഏഴരശ്ശനി കാലങ്ങളൊന്നും കണ്ടെത്തിയില്ല.",
    no_future: "പരിശോധിച്ച കാലപരിധിയിൽ വരാനിരിക്കുന്ന ഏഴരശ്ശനി കാലങ്ങളൊന്നുമില്ല.",
    remedies_intro:
      "ഏഴരശ്ശനിക്കാലത്ത് സാധാരണയായി അനുഷ്ഠിക്കുന്ന പരമ്പരാഗത പരിഹാരങ്ങൾ ഇവയാണ്. ഏതു പരിഹാരവും തുടങ്ങുന്നതിനു മുമ്പ് നിങ്ങളുടെ ജാതകം പൂർണമായി പരിശോധിക്കുക:",
  },
  // gu: Sade Sati is સાડાસાતી પનોતી; same "check the chart fully" wording.
  gu: {
    title_sade: "સાડાસાતી પનોતી રિપોર્ટ",
    born: "જન્મ",
    at: "સમય",
    generated: "તૈયાર",
    moon_sign: "ચંદ્ર રાશિ",
    section_current: "વર્તમાન સ્થિતિ",
    section_past: "અગાઉના સાડાસાતી પનોતીના તબક્કા",
    section_active_window: "વર્તમાન તબક્કો",
    section_future: "આગામી તબક્કા",
    section_remedies: "સૂચવેલા ઉપાયો",
    current_phase: "વર્તમાન તબક્કો",
    from: "આરંભ",
    to: "સમાપ્તિ",
    duration: "અવધિ",
    signs_traversed: "ગોચર રાશિઓ",
    no_past: "શોધની મર્યાદામાં સાડાસાતી પનોતીનો કોઈ અગાઉનો તબક્કો મળ્યો નથી.",
    no_future: "શોધની મર્યાદામાં સાડાસાતી પનોતીનો કોઈ આગામી તબક્કો નથી.",
    remedies_intro:
      "સાડાસાતી પનોતી દરમિયાન પ્રચલિત પરંપરાગત ઉપાયો નીચે મુજબ છે. કોઈ પણ ઉપાય અપનાવતાં પહેલાં આપની કુંડળીને પૂરેપૂરી તપાસી લેજો:",
  },
};

/** The four phase labels, per locale. */
const STATUS_LABELS: Record<string, Record<string, string>> = {
  en: { rising: "Rising", peak: "Peak", setting: "Setting", clear: "Clear (no Sade Sati)" },
  hi: { rising: "आरंभ", peak: "शिखर", setting: "अंत", clear: "मुक्त (साढ़े साती नहीं)" },
  mr: { rising: "प्रारंभ", peak: "शिखर", setting: "अंत", clear: "मुक्त (साडेसाती नाही)" },
  te: { rising: "ప్రారంభ ఘట్టం", peak: "శిఖర ఘట్టం", setting: "చివరి ఘట్టం", clear: "విముక్తం (ఏలినాటి శని లేదు)" },
  // Tamil names the three 2.5-year phases விரயச் சனி / ஜென்மச் சனி / பாதச் சனி.
  ta: {
    rising: "தொடக்கக் கட்டம் (விரயச் சனி)",
    peak: "உச்சக் கட்டம் (ஜென்மச் சனி)",
    setting: "இறுதிக் கட்டம் (பாதச் சனி)",
    clear: "விடுபட்டது (ஏழரைச் சனி இல்லை)",
  },
  kn: { rising: "ಆರಂಭ ಹಂತ", peak: "ಶಿಖರ ಹಂತ", setting: "ಅಂತಿಮ ಹಂತ", clear: "ಮುಕ್ತ (ಸಾಡೇಸಾತಿ ಇಲ್ಲ)" },
  ml: { rising: "ആരംഭഘട്ടം", peak: "പാരമ്യഘട്ടം", setting: "അന്തിമഘട്ടം", clear: "മുക്തം (ഏഴരശ്ശനി ഇല്ല)" },
  gu: { rising: "આરંભ", peak: "શિખર", setting: "અંત", clear: "મુક્ત (સાડાસાતી પનોતી નથી)" },
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
    "Wear a blue sapphire only after checking the chart — Saturn's gemstone is not for everyone.",
    "Maintain disciplined routine, ethical conduct, and minimize unnecessary expenditure.",
  ],
  hi: [
    "प्रतिदिन हनुमान चालीसा का पाठ कीजिए, विशेषकर मंगलवार एवं शनिवार को।",
    "शनिवार को काले तिल, सरसों का तेल अथवा लोहे की वस्तुओं का दान कीजिए।",
    "शनि देव की पूजा तिल के तेल एवं नीले पुष्पों से कीजिए।",
    "नीलम कुंडली की जाँच के पश्चात ही धारण कीजिए — शनि का रत्न सभी के लिए उपयुक्त नहीं होता।",
    "अनुशासित दिनचर्या रखिए, नैतिक आचरण कीजिए एवं अनावश्यक व्यय से बचिए।",
  ],
  mr: [
    "दररोज हनुमान चालीसाचे पठण करा, विशेषतः मंगळवार आणि शनिवारी.",
    "शनिवारी काळे तीळ, मोहरीचे तेल किंवा लोखंडी वस्तूंचे दान करा.",
    "शनिदेवाची तिळाच्या तेलाने आणि निळ्या फुलांनी पूजा करा.",
    "नीलम कुंडलीची तपासणी केल्यानंतरच धारण करा — शनीचे रत्न सर्वांसाठी योग्य नसते.",
    "शिस्तबद्ध दिनचर्या ठेवा, नैतिक आचरण करा आणि अनावश्यक खर्च टाळा.",
  ],
  te: [
    "ప్రతిరోజూ హనుమాన్ చాలీసా పఠించండి, ముఖ్యంగా మంగళవారం, శనివారం.",
    "శనివారం నల్ల నువ్వులు, ఆవనూనె లేదా ఇనుప వస్తువులు దానం చేయండి.",
    "నువ్వుల నూనె, నీలి పూలతో శనిదేవుని పూజించండి.",
    "నీలమణిని జాతక పరిశీలన తర్వాతే ధరించండి; శని రత్నం అందరికీ సరిపడదు.",
    "క్రమశిక్షణతో కూడిన దినచర్య పాటించండి, నైతికంగా నడుచుకోండి, అనవసర ఖర్చులు తగ్గించండి.",
  ],
  ta: [
    "தினமும் ஹனுமான் சாலிசா பாராயணம் செய்யுங்கள், குறிப்பாகச் செவ்வாய், சனிக்கிழமைகளில்.",
    "சனிக்கிழமை கருப்பு எள், கடுகு எண்ணெய் அல்லது இரும்புப் பொருட்களைத் தானம் செய்யுங்கள்.",
    "நல்லெண்ணெயும் நீல மலர்களும் கொண்டு சனி பகவானை வழிபடுங்கள்.",
    "நீலக்கல்லை ஜாதகச் சரிபார்ப்புக்குப் பிறகே அணியுங்கள்; சனியின் ரத்தினம் எல்லோருக்கும் பொருந்தாது.",
    "ஒழுங்கான தினசரி வழக்கத்தைக் கடைப்பிடியுங்கள், நேர்மையாக நடந்துகொள்ளுங்கள், தேவையற்ற செலவைத் தவிருங்கள்.",
  ],
  kn: [
    "ಪ್ರತಿದಿನ ಹನುಮಾನ್ ಚಾಲೀಸಾ ಪಠಿಸಿ, ವಿಶೇಷವಾಗಿ ಮಂಗಳವಾರ ಮತ್ತು ಶನಿವಾರ.",
    "ಶನಿವಾರ ಕಪ್ಪು ಎಳ್ಳು, ಸಾಸಿವೆ ಎಣ್ಣೆ ಅಥವಾ ಕಬ್ಬಿಣದ ವಸ್ತುಗಳನ್ನು ದಾನ ಮಾಡಿ.",
    "ಎಳ್ಳೆಣ್ಣೆ ಮತ್ತು ನೀಲಿ ಹೂವುಗಳಿಂದ ಶನಿದೇವರನ್ನು ಪೂಜಿಸಿ.",
    "ನೀಲಮಣಿಯನ್ನು ಜಾತಕ ಪರಿಶೀಲನೆಯ ನಂತರವೇ ಧರಿಸಿ; ಶನಿಯ ರತ್ನ ಎಲ್ಲರಿಗೂ ಹೊಂದುವುದಿಲ್ಲ.",
    "ಶಿಸ್ತಿನ ದಿನಚರಿ ಪಾಲಿಸಿ, ನೈತಿಕವಾಗಿ ನಡೆದುಕೊಳ್ಳಿ ಮತ್ತು ಅನಗತ್ಯ ಖರ್ಚನ್ನು ತಪ್ಪಿಸಿ.",
  ],
  // ml: the Hindi mustard oil is എള്ളെണ്ണ (sesame oil), the Kerala Saturn offering.
  ml: [
    "ദിവസവും ഹനുമാൻ ചാലീസ ജപിക്കുക, പ്രത്യേകിച്ച് ചൊവ്വാഴ്ചയും ശനിയാഴ്ചയും.",
    "ശനിയാഴ്ച കറുത്ത എള്ള്, എള്ളെണ്ണ അല്ലെങ്കിൽ ഇരുമ്പുസാധനങ്ങൾ ദാനം ചെയ്യുക.",
    "എള്ളെണ്ണയും നീലപ്പൂക്കളും കൊണ്ട് ശനിദേവനെ ആരാധിക്കുക.",
    "ഇന്ദ്രനീലം ജാതകപരിശോധനയ്ക്കു ശേഷം മാത്രം ധരിക്കുക; ശനിയുടെ രത്നം എല്ലാവർക്കും യോജിക്കില്ല.",
    "ചിട്ടയായ ദിനചര്യ പാലിക്കുക, ധാർമികമായി പെരുമാറുക, അനാവശ്യ ചെലവുകൾ ഒഴിവാക്കുക.",
  ],
  gu: [
    "દરરોજ હનુમાન ચાલીસાનો પાઠ કરજો, ખાસ કરીને મંગળવારે અને શનિવારે.",
    "શનિવારે કાળા તલ, સરસવનું તેલ અથવા લોખંડની વસ્તુઓનું દાન કરજો.",
    "શનિદેવની પૂજા તલના તેલ અને વાદળી ફૂલોથી કરજો.",
    "નીલમ કુંડળીની તપાસ પછી જ ધારણ કરજો; શનિનું રત્ન બધા માટે યોગ્ય હોતું નથી.",
    "અનુશાસિત દિનચર્યા રાખજો, નૈતિક આચરણ કરજો અને બિનજરૂરી ખર્ચ ટાળજો.",
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
    case "te":
      return `సుమారు ${y} సంవత్సరాలు`;
    case "ta":
      return `சுமார் ${y} ஆண்டுகள்`;
    case "kn":
      return `ಸುಮಾರು ${y} ವರ್ಷಗಳು`;
    case "ml":
      return `ഏകദേശം ${y} വർഷം`;
    case "gu":
      return `આશરે ${y} વર્ષ`;
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
    case "te":
      switch (status) {
        case "rising":
          return `శని ప్రస్తుతం మీ చంద్ర రాశికి (${moon}) ముందు రాశిలో సంచరిస్తున్నాడు. ఇది ఏలినాటి శని ప్రారంభ ఘట్టం.`;
        case "peak":
          return `శని ప్రస్తుతం మీ చంద్ర రాశి (${moon}) పైనే సంచరిస్తున్నాడు. ఇది ఏలినాటి శని శిఖర ఘట్టం.`;
        case "setting":
          return `శని ప్రస్తుతం మీ చంద్ర రాశి (${moon}) తర్వాతి రాశిలో ఉన్నాడు. ఇది ఏలినాటి శని చివరి ఘట్టం.`;
      }
      return `ప్రస్తుతం మీరు ఏలినాటి శని నుండి విముక్తులు. శని (${saturn}) మీ చంద్ర రాశి (${moon}) నుండి దూరంగా ఉన్నాడు.`;
    case "ta":
      switch (status) {
        case "rising":
          return `சனி தற்போது உங்கள் சந்திர ராசிக்கு (${moon}) முந்தைய ராசியில் சஞ்சரிக்கிறார். இது ஏழரைச் சனியின் தொடக்கக் கட்டம்.`;
        case "peak":
          return `சனி தற்போது உங்கள் சந்திர ராசியிலேயே (${moon}) சஞ்சரிக்கிறார். இது ஏழரைச் சனியின் உச்சக் கட்டம்.`;
        case "setting":
          return `சனி தற்போது உங்கள் சந்திர ராசிக்கு (${moon}) அடுத்த ராசியில் இருக்கிறார். இது ஏழரைச் சனியின் இறுதிக் கட்டம்.`;
      }
      return `தற்போது நீங்கள் ஏழரைச் சனியிலிருந்து விடுபட்டிருக்கிறீர்கள். சனி (${saturn}) உங்கள் சந்திர ராசியிலிருந்து (${moon}) விலகி இருக்கிறார்.`;
    case "kn":
      switch (status) {
        case "rising":
          return `ಶನಿ ಪ್ರಸ್ತುತ ನಿಮ್ಮ ಚಂದ್ರ ರಾಶಿಯ (${moon}) ಹಿಂದಿನ ರಾಶಿಯಲ್ಲಿ ಸಂಚರಿಸುತ್ತಿದ್ದಾನೆ. ಇದು ಸಾಡೇಸಾತಿಯ ಆರಂಭ ಹಂತ.`;
        case "peak":
          return `ಶನಿ ಪ್ರಸ್ತುತ ನಿಮ್ಮ ಚಂದ್ರ ರಾಶಿಯಲ್ಲೇ (${moon}) ಸಂಚರಿಸುತ್ತಿದ್ದಾನೆ. ಇದು ಸಾಡೇಸಾತಿಯ ಶಿಖರ ಹಂತ.`;
        case "setting":
          return `ಶನಿ ಪ್ರಸ್ತುತ ನಿಮ್ಮ ಚಂದ್ರ ರಾಶಿಯ (${moon}) ಮುಂದಿನ ರಾಶಿಯಲ್ಲಿದ್ದಾನೆ. ಇದು ಸಾಡೇಸಾತಿಯ ಅಂತಿಮ ಹಂತ.`;
      }
      return `ಪ್ರಸ್ತುತ ನೀವು ಸಾಡೇಸಾತಿಯಿಂದ ಮುಕ್ತರಾಗಿದ್ದೀರಿ. ಶನಿ (${saturn}) ನಿಮ್ಮ ಚಂದ್ರ ರಾಶಿಯಿಂದ (${moon}) ದೂರದಲ್ಲಿದ್ದಾನೆ.`;
    case "ml":
      switch (status) {
        case "rising":
          return `ശനി ഇപ്പോൾ നിങ്ങളുടെ ചന്ദ്രരാശിക്ക് (${moon}) തൊട്ടുമുമ്പുള്ള രാശിയിലൂടെ സഞ്ചരിക്കുന്നു. ഇത് ഏഴരശ്ശനിയുടെ ആരംഭഘട്ടമാണ്.`;
        case "peak":
          return `ശനി ഇപ്പോൾ നിങ്ങളുടെ ചന്ദ്രരാശിയിൽത്തന്നെ (${moon}) സഞ്ചരിക്കുന്നു. ഇത് ഏഴരശ്ശനിയുടെ പാരമ്യഘട്ടമാണ്.`;
        case "setting":
          return `ശനി ഇപ്പോൾ നിങ്ങളുടെ ചന്ദ്രരാശിയുടെ (${moon}) തൊട്ടടുത്ത രാശിയിലാണ്. ഇത് ഏഴരശ്ശനിയുടെ അന്തിമഘട്ടമാണ്.`;
      }
      return `നിലവിൽ നിങ്ങൾ ഏഴരശ്ശനിയിൽ നിന്ന് മുക്തരാണ്. ശനി (${saturn}) നിങ്ങളുടെ ചന്ദ്രരാശിയിൽ (${moon}) നിന്ന് അകലെയാണ്.`;
    case "gu":
      switch (status) {
        case "rising":
          return `શનિ હાલ આપની ચંદ્ર રાશિ (${moon})ની પહેલાંની રાશિમાં ગોચર કરી રહ્યા છે. આ સાડાસાતી પનોતીનો આરંભનો તબક્કો છે.`;
        case "peak":
          return `શનિ હાલ આપની ચંદ્ર રાશિ (${moon}) પર જ ગોચર કરી રહ્યા છે. આ સાડાસાતી પનોતીનો શિખર તબક્કો છે.`;
        case "setting":
          return `શનિ હાલ આપની ચંદ્ર રાશિ (${moon})ની પછીની રાશિમાં છે. આ સાડાસાતી પનોતીનો અંતિમ તબક્કો છે.`;
      }
      return `હાલ આપ સાડાસાતી પનોતીથી મુક્ત છો. શનિ (${saturn}) આપની ચંદ્ર રાશિ (${moon})થી દૂર છે.`;
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
