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
  // te / ta / kn are written from the Hindi. Telugu names the dosha after
  // కుజుడు (= PlanetTE "Mars"), Tamil after செவ்வாய். The Hindi "consult a
  // qualified astrologer" line becomes "check your chart fully first": the
  // te/ta style guides ban the referral phrase (B2B clients are astrologers).
  te: {
    title_mangal: "కుజ దోష నివేదిక",
    born: "జననం",
    at: "సమయం",
    generated: "రూపొందించిన తేదీ",
    ascendant: "లగ్నం",
    section_diagnostic: "విశ్లేషణ",
    section_cancellation: "దోష నివృత్తి",
    section_marriage: "వివాహంపై ప్రభావం",
    section_remedies: "సూచించిన పరిహారాలు",
    mars_sign: "కుజుని రాశి",
    mars_nakshatra: "కుజుని నక్షత్రం",
    mars_houses: "కుజుడు ఉన్న భావం",
    pada: "పాదం",
    diagnosis: "నిర్ధారణ",
    cancellation_intro: "శాస్త్ర నియమాల ప్రకారం ఈ కారణాల వల్ల దోషం నివృత్తి అవుతుంది:",
    remedies_intro:
      "కుజ దోషానికి సాధారణంగా సూచించే సంప్రదాయ పరిహారాలు ఇవి. ఏ పరిహారాన్నైనా మొదలుపెట్టే ముందు మీ జాతకాన్ని పూర్తిగా పరిశీలించుకోండి:",
  },
  ta: {
    title_mangal: "செவ்வாய் தோஷ அறிக்கை",
    born: "பிறப்பு",
    at: "நேரம்",
    generated: "தயாரித்த நாள்",
    ascendant: "லக்னம்",
    section_diagnostic: "பகுப்பாய்வு",
    section_cancellation: "தோஷ நிவர்த்தி",
    section_marriage: "திருமணத்தில் தாக்கம்",
    section_remedies: "பரிந்துரைக்கப்பட்ட பரிகாரங்கள்",
    mars_sign: "செவ்வாய் இருக்கும் ராசி",
    mars_nakshatra: "செவ்வாய் இருக்கும் நட்சத்திரம்",
    mars_houses: "செவ்வாய் இருக்கும் வீடு",
    pada: "பாதம்",
    diagnosis: "முடிவு",
    cancellation_intro: "சாஸ்திர விதிகளின்படி கீழ்க்காணும் காரணங்களால் தோஷம் நிவர்த்தி ஆகிறது:",
    remedies_intro:
      "செவ்வாய் தோஷத்துக்குப் பொதுவாகப் பரிந்துரைக்கப்படும் பாரம்பரியப் பரிகாரங்கள் இவை. எந்தப் பரிகாரத்தையும் தொடங்கும் முன் உங்கள் ஜாதகத்தை முழுமையாகச் சரிபார்த்துக்கொள்ளுங்கள்:",
  },
  kn: {
    title_mangal: "ಮಂಗಳ ದೋಷ ವರದಿ",
    born: "ಜನನ",
    at: "ಸಮಯ",
    generated: "ತಯಾರಿಸಿದ ದಿನಾಂಕ",
    ascendant: "ಲಗ್ನ",
    section_diagnostic: "ವಿಶ್ಲೇಷಣೆ",
    section_cancellation: "ದೋಷ ನಿವಾರಣೆ",
    section_marriage: "ವಿವಾಹದ ಮೇಲಿನ ಪ್ರಭಾವ",
    section_remedies: "ಶಿಫಾರಸು ಮಾಡಿದ ಪರಿಹಾರಗಳು",
    mars_sign: "ಮಂಗಳನ ರಾಶಿ",
    mars_nakshatra: "ಮಂಗಳನ ನಕ್ಷತ್ರ",
    mars_houses: "ಮಂಗಳನಿರುವ ಭಾವ",
    pada: "ಪಾದ",
    diagnosis: "ನಿರ್ಣಯ",
    cancellation_intro: "ಶಾಸ್ತ್ರೀಯ ನಿಯಮಗಳ ಪ್ರಕಾರ ಈ ಕಾರಣಗಳಿಂದ ದೋಷ ನಿವಾರಣೆಯಾಗುತ್ತದೆ:",
    remedies_intro:
      "ಮಂಗಳ ದೋಷಕ್ಕೆ ಸಾಮಾನ್ಯವಾಗಿ ಶಿಫಾರಸು ಮಾಡುವ ಸಾಂಪ್ರದಾಯಿಕ ಪರಿಹಾರಗಳು ಇವು. ಯಾವುದೇ ಪರಿಹಾರವನ್ನು ಆರಂಭಿಸುವ ಮೊದಲು ನಿಮ್ಮ ಜಾತಕವನ್ನು ಸಂಪೂರ್ಣವಾಗಿ ಪರಿಶೀಲಿಸಿಕೊಳ್ಳಿ:",
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
  te: {
    purn: [
      "ప్రతిరోజూ హనుమాన్ చాలీసా పఠించండి, ముఖ్యంగా మంగళవారం.",
      "ప్రతి మంగళవారం హనుమాన్ ఆలయానికి వెళ్లి ఎర్రని పూలు, సిందూరం సమర్పించండి.",
      "మంగళవారం మసూర్ పప్పు, బెల్లం లేదా ఎర్రని వస్త్రం దానం చేయండి.",
      "మంగళవారం ఉపవాసం ఉండండి; ఆ రోజు పండ్లు, పాలు మాత్రమే తీసుకోండి.",
      "వివాహానికి ముందు కుంభ వివాహం (రావి చెట్టుతో లేదా కుంభంతో ప్రతీకాత్మక వివాహం) గురించి ఆలోచించండి; జాతకాన్ని పూర్తిగా పరిశీలించిన తర్వాతే.",
      "పగడాన్ని జాతక పరిశీలన తర్వాతే ధరించండి; ఇది అందరికీ సరిపడదు.",
    ],
    mild: [
      "మంగళవారం హనుమాన్ చాలీసా పఠించండి.",
      "మంగళవారం మసూర్ పప్పు లేదా బెల్లం దానం చేయండి.",
      "క్రమం తప్పకుండా హనుమాన్ ఆలయానికి వెళ్లండి.",
      "మంగళవారం హనుమంతుని ఎదుట ఆవనూనె దీపం వెలిగించండి.",
    ],
    none: ["ప్రత్యేకంగా కుజ సంబంధ పరిహారాలు అవసరం లేదు. మీ నిత్య ఆధ్యాత్మిక సాధనను కొనసాగించండి."],
  },
  ta: {
    purn: [
      "தினமும் ஹனுமான் சாலிசா பாராயணம் செய்யுங்கள், குறிப்பாகச் செவ்வாய்க்கிழமை.",
      "ஒவ்வொரு செவ்வாய்க்கிழமையும் ஆஞ்சநேயர் கோயிலுக்குச் சென்று சிவப்பு மலர்களும் செந்தூரமும் சமர்ப்பியுங்கள்.",
      "செவ்வாய்க்கிழமை மசூர் பருப்பு, வெல்லம் அல்லது சிவப்பு ஆடையைத் தானம் செய்யுங்கள்.",
      "செவ்வாய்க்கிழமை விரதம் இருங்கள்; அன்று பழமும் பாலும் மட்டும் உண்ணுங்கள்.",
      "திருமணத்துக்கு முன் கும்ப விவாகம் (அரச மரத்துடன் அல்லது கும்பத்துடன் அடையாளத் திருமணம்) பற்றி யோசியுங்கள்; ஜாதகத்தை முழுமையாகச் சரிபார்த்த பிறகே.",
      "பவளத்தை ஜாதகச் சரிபார்ப்புக்குப் பிறகே அணியுங்கள்; அது எல்லோருக்கும் பொருந்தாது.",
    ],
    mild: [
      "செவ்வாய்க்கிழமை ஹனுமான் சாலிசா பாராயணம் செய்யுங்கள்.",
      "செவ்வாய்க்கிழமை மசூர் பருப்பு அல்லது வெல்லம் தானம் செய்யுங்கள்.",
      "தவறாமல் ஆஞ்சநேயர் கோயிலுக்குச் செல்லுங்கள்.",
      "செவ்வாய்க்கிழமை ஆஞ்சநேயர் முன் கடுகு எண்ணெய் தீபம் ஏற்றுங்கள்.",
    ],
    none: ["செவ்வாய் தொடர்பான சிறப்புப் பரிகாரம் தேவையில்லை. உங்கள் வழக்கமான ஆன்மிகப் பயிற்சியைத் தொடருங்கள்."],
  },
  kn: {
    purn: [
      "ಪ್ರತಿದಿನ ಹನುಮಾನ್ ಚಾಲೀಸಾ ಪಠಿಸಿ, ವಿಶೇಷವಾಗಿ ಮಂಗಳವಾರ.",
      "ಪ್ರತಿ ಮಂಗಳವಾರ ಹನುಮಂತನ ದೇವಸ್ಥಾನಕ್ಕೆ ಹೋಗಿ ಕೆಂಪು ಹೂವು ಮತ್ತು ಸಿಂಧೂರ ಅರ್ಪಿಸಿ.",
      "ಮಂಗಳವಾರ ಮಸೂರ್ ಬೇಳೆ, ಬೆಲ್ಲ ಅಥವಾ ಕೆಂಪು ವಸ್ತ್ರವನ್ನು ದಾನ ಮಾಡಿ.",
      "ಮಂಗಳವಾರ ಉಪವಾಸ ಮಾಡಿ; ಆ ದಿನ ಹಣ್ಣು ಮತ್ತು ಹಾಲು ಮಾತ್ರ ಸೇವಿಸಿ.",
      "ವಿವಾಹಕ್ಕೆ ಮೊದಲು ಕುಂಭ ವಿವಾಹದ (ಅರಳಿ ಮರ ಅಥವಾ ಕುಂಭದೊಂದಿಗೆ ಸಾಂಕೇತಿಕ ವಿವಾಹ) ಬಗ್ಗೆ ಯೋಚಿಸಿ; ಜಾತಕವನ್ನು ಸಂಪೂರ್ಣವಾಗಿ ಪರಿಶೀಲಿಸಿದ ನಂತರವೇ.",
      "ಹವಳವನ್ನು ಜಾತಕ ಪರಿಶೀಲನೆಯ ನಂತರವೇ ಧರಿಸಿ; ಇದು ಎಲ್ಲರಿಗೂ ಹೊಂದುವುದಿಲ್ಲ.",
    ],
    mild: [
      "ಮಂಗಳವಾರ ಹನುಮಾನ್ ಚಾಲೀಸಾ ಪಠಿಸಿ.",
      "ಮಂಗಳವಾರ ಮಸೂರ್ ಬೇಳೆ ಅಥವಾ ಬೆಲ್ಲ ದಾನ ಮಾಡಿ.",
      "ನಿಯಮಿತವಾಗಿ ಹನುಮಂತನ ದೇವಸ್ಥಾನಕ್ಕೆ ಹೋಗಿ.",
      "ಮಂಗಳವಾರ ಹನುಮಂತನ ಎದುರು ಸಾಸಿವೆ ಎಣ್ಣೆಯ ದೀಪ ಹಚ್ಚಿ.",
    ],
    none: ["ಮಂಗಳಕ್ಕೆ ಸಂಬಂಧಿಸಿದ ವಿಶೇಷ ಪರಿಹಾರಗಳ ಅಗತ್ಯವಿಲ್ಲ. ನಿಮ್ಮ ನಿಯಮಿತ ಆಧ್ಯಾತ್ಮಿಕ ಅಭ್ಯಾಸವನ್ನು ಮುಂದುವರಿಸಿ."],
  },
};

/** Status, diagnosis and marriage prose for te / ta / kn (written from the Hindi). */
interface SouthMangalProse {
  badge: { none: string; cancelled: string; purn: string; mild: string };
  severity: { purn: string; mild: string; none: string };
  fromLagna: (hs: string) => string;
  fromMoon: (hs: string) => string;
  diagnosisNone: string;
  diagnosis: (sign: string, houses: string, sev: string) => string;
  marriage: { none: string; cancelled: string; purn: string; mild: string };
}

const SOUTH_PROSE: Record<string, SouthMangalProse> = {
  te: {
    badge: { none: "కుజ దోషం లేదు", cancelled: "కుజ దోషం (నివృత్తితో)", purn: "పూర్ణ కుజ దోషం", mild: "స్వల్ప కుజ దోషం" },
    severity: { purn: "పూర్ణ", mild: "స్వల్ప", none: "లేని" },
    fromLagna: (hs) => `లగ్నం నుండి ${hs}`,
    fromMoon: (hs) => `చంద్రుని నుండి ${hs}`,
    diagnosisNone: "కుజుడు దోషకారక భావాలలో (1, 4, 7, 8, 12) లేడు, కాబట్టి కుజ దోషం లేదు.",
    diagnosis: (sign, houses, sev) => `కుజుడు ${sign}లో ఉన్నాడు (భావం: ${houses}). ఇది కుజ దోషపు ${sev} రూపం.`,
    marriage: {
      none: "వివాహ దృష్టితో కుజ దోషానికి సంబంధించిన ఆటంకం ఏదీ లేదు. పొంతన సాధారణంగానే చూడవచ్చు.",
      cancelled:
        "కుజ దోషం ఉన్నప్పటికీ, శాస్త్రీయ నివృత్తి వర్తించడం వల్ల దాని ప్రభావం బాగా తగ్గుతుంది. పొంతనలో సాధారణంగా దీనిని పెద్ద ఆటంకంగా పరిగణించరు.",
      purn:
        "పూర్ణ కుజ దోషం వివాహ సంబంధాలలో సవాళ్లు తీసుకురావచ్చు. భాగస్వామి జాతకంలోనూ కుజ దోషం (లేదా సమాన తీవ్రత) ఉంటే ప్రభావం సమతుల్యమవుతుందని సంప్రదాయం చెబుతుంది. ఇద్దరి జాతకాల జాగ్రత్తైన పరిశీలన, సరైన పొంతన ముఖ్యం.",
      mild:
        "స్వల్ప కుజ దోషం ప్రభావం పరిమితంగా ఉంటుంది, అయినా పొంతన చూసేటప్పుడు దీనిని లెక్కలోకి తీసుకోవడం మంచిది. భాగస్వామి జాతకాన్ని కూడా దీనితో కలిపి పరిశీలించండి.",
    },
  },
  ta: {
    badge: {
      none: "செவ்வாய் தோஷம் இல்லை",
      cancelled: "செவ்வாய் தோஷம் (நிவர்த்தியுடன்)",
      purn: "முழு செவ்வாய் தோஷம்",
      mild: "லேசான செவ்வாய் தோஷம்",
    },
    severity: { purn: "முழு", mild: "லேசான", none: "இல்லாத" },
    fromLagna: (hs) => `லக்னத்திலிருந்து ${hs}`,
    fromMoon: (hs) => `சந்திரனிலிருந்து ${hs}`,
    diagnosisNone: "செவ்வாய் தோஷம் தரும் வீடுகளில் (1, 4, 7, 8, 12) செவ்வாய் இல்லை, எனவே செவ்வாய் தோஷம் இல்லை.",
    diagnosis: (sign, houses, sev) => `செவ்வாய் ${sign} ராசியில் இருக்கிறார் (வீடு: ${houses}). இது செவ்வாய் தோஷத்தின் ${sev} வடிவம்.`,
    marriage: {
      none: "திருமணக் கோணத்தில் செவ்வாய் தோஷம் தொடர்பான தடை எதுவும் இல்லை. பொருத்தம் வழக்கம்போல் பார்க்கலாம்.",
      cancelled:
        "செவ்வாய் தோஷம் இருந்தாலும், சாஸ்திர நிவர்த்தி பொருந்துவதால் அதன் தாக்கம் வெகுவாகக் குறைகிறது. பொருத்தம் பார்க்கும்போது பொதுவாக இது பெரிய தடையாகக் கருதப்படுவதில்லை.",
      purn:
        "முழு செவ்வாய் தோஷம் திருமண உறவுகளில் சவால்களைக் கொண்டுவரலாம். துணையின் ஜாதகத்திலும் செவ்வாய் தோஷம் (அல்லது அதே அளவு தீவிரம்) இருந்தால் தாக்கம் சமநிலைப்படும் என்பது மரபு. இருவரின் ஜாதகத்தையும் கவனமாக ஆராய்வதும் சரியான பொருத்தம் பார்ப்பதும் முக்கியம்.",
      mild:
        "லேசான செவ்வாய் தோஷத்தின் தாக்கம் குறைவு, ஆனாலும் பொருத்தம் பார்க்கும்போது இதைக் கணக்கில் எடுப்பது நல்லது. துணையின் ஜாதகத்தையும் இதனுடன் சேர்த்து ஆராயுங்கள்.",
    },
  },
  kn: {
    badge: { none: "ಮಂಗಳ ದೋಷ ಇಲ್ಲ", cancelled: "ಮಂಗಳ ದೋಷ (ನಿವಾರಣೆಯೊಂದಿಗೆ)", purn: "ಪೂರ್ಣ ಮಂಗಳ ದೋಷ", mild: "ಅಲ್ಪ ಮಂಗಳ ದೋಷ" },
    severity: { purn: "ಪೂರ್ಣ", mild: "ಅಲ್ಪ", none: "ಇಲ್ಲದ" },
    fromLagna: (hs) => `ಲಗ್ನದಿಂದ ${hs}`,
    fromMoon: (hs) => `ಚಂದ್ರನಿಂದ ${hs}`,
    diagnosisNone: "ಮಂಗಳ ದೋಷಕಾರಕ ಭಾವಗಳಲ್ಲಿ (1, 4, 7, 8, 12) ಮಂಗಳ ಇಲ್ಲ, ಆದ್ದರಿಂದ ಮಂಗಳ ದೋಷ ಇಲ್ಲ.",
    diagnosis: (sign, houses, sev) => `ಮಂಗಳ ${sign} ರಾಶಿಯಲ್ಲಿದ್ದಾನೆ (ಭಾವ: ${houses}). ಇದು ಮಂಗಳ ದೋಷದ ${sev} ರೂಪ.`,
    marriage: {
      none: "ವಿವಾಹದ ದೃಷ್ಟಿಯಿಂದ ಮಂಗಳ ದೋಷಕ್ಕೆ ಸಂಬಂಧಿಸಿದ ಯಾವುದೇ ಅಡ್ಡಿ ಇಲ್ಲ. ಜಾತಕ ಹೊಂದಾಣಿಕೆಯನ್ನು ಸಾಮಾನ್ಯವಾಗಿ ನೋಡಬಹುದು.",
      cancelled:
        "ಮಂಗಳ ದೋಷ ಇದ್ದರೂ, ಶಾಸ್ತ್ರೀಯ ನಿವಾರಣೆ ಅನ್ವಯಿಸುವುದರಿಂದ ಅದರ ಪ್ರಭಾವ ಬಹಳಷ್ಟು ಕಡಿಮೆಯಾಗುತ್ತದೆ. ಹೊಂದಾಣಿಕೆಯಲ್ಲಿ ಸಾಮಾನ್ಯವಾಗಿ ಇದನ್ನು ದೊಡ್ಡ ಅಡ್ಡಿಯೆಂದು ಪರಿಗಣಿಸುವುದಿಲ್ಲ.",
      purn:
        "ಪೂರ್ಣ ಮಂಗಳ ದೋಷ ವಿವಾಹ ಸಂಬಂಧಗಳಲ್ಲಿ ಸವಾಲುಗಳನ್ನು ತರಬಹುದು. ಸಂಗಾತಿಯ ಜಾತಕದಲ್ಲೂ ಮಂಗಳ ದೋಷ (ಅಥವಾ ಸಮಾನ ತೀವ್ರತೆ) ಇದ್ದರೆ ಪ್ರಭಾವ ಸಮತೋಲನಗೊಳ್ಳುತ್ತದೆ ಎಂಬುದು ಸಂಪ್ರದಾಯ. ಇಬ್ಬರ ಜಾತಕಗಳ ಎಚ್ಚರಿಕೆಯ ಪರಿಶೀಲನೆ ಮತ್ತು ಸರಿಯಾದ ಹೊಂದಾಣಿಕೆ ಮುಖ್ಯ.",
      mild:
        "ಅಲ್ಪ ಮಂಗಳ ದೋಷದ ಪ್ರಭಾವ ಸೀಮಿತ, ಆದರೂ ಹೊಂದಾಣಿಕೆ ನೋಡುವಾಗ ಇದನ್ನು ಗಣನೆಗೆ ತೆಗೆದುಕೊಳ್ಳುವುದು ಒಳ್ಳೆಯದು. ಸಂಗಾತಿಯ ಜಾತಕವನ್ನೂ ಇದರೊಂದಿಗೆ ಸೇರಿಸಿ ಪರಿಶೀಲಿಸಿ.",
    },
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
  const south = SOUTH_PROSE[l];
  if (south) {
    if (!d.HasDosha) return south.badge.none;
    if (d.Cancelled) return south.badge.cancelled;
    return d.Status === "purn" ? south.badge.purn : south.badge.mild;
  }
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
  const south = SOUTH_PROSE[l];
  if (south) return status === "purn" ? south.severity.purn : status === "mild" ? south.severity.mild : south.severity.none;
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
  const south = SOUTH_PROSE[l];
  if (south) {
    if (!d.HasDosha) return south.diagnosisNone;
    return south.diagnosis(d.MarsPlacement?.sign ?? "", formatHouses(loc, d.HousesOccupied), severityLabel(loc, d.Status));
  }
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
  const south = SOUTH_PROSE[l];
  if (south) {
    if (lagna.length) parts.push(south.fromLagna(lagna.join(", ")));
    if (moon.length) parts.push(south.fromMoon(moon.join(", ")));
  } else if (l === "hi") {
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
  const south = SOUTH_PROSE[l];
  if (south) {
    if (!d.HasDosha) return south.marriage.none;
    if (d.Cancelled) return south.marriage.cancelled;
    return d.Status === "purn" ? south.marriage.purn : south.marriage.mild;
  }
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
