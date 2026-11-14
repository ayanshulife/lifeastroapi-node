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
import { localizeLord, localizeWeekday } from "../locales.js";

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
  te: {
    title: "సంఖ్యాశాస్త్ర నివేదిక",
    born: "జననం",
    generated: "రూపొందించిన తేదీ",
    driver: "మూలాంకం",
    driver_alt: "జన్మ తేదీ సంఖ్య",
    conductor: "భాగ్యాంకం",
    conductor_alt: "జీవన మార్గం",
    soul: "అంతరాత్మ సంఖ్య",
    personality: "వ్యక్తిత్వ సంఖ్య",
    destiny: "నామ సంఖ్య",
    section_driver: "మూలాంకం",
    section_conductor: "భాగ్యాంకం",
    section_soul: "అంతరాత్మ సంఖ్య",
    section_personality: "వ్యక్తిత్వ సంఖ్య",
    section_destiny: "నామ సంఖ్య",
    section_compatibility: "అనుకూల సంఖ్యలు",
    compat_intro: "మీ మూలాంకంతో అనుకూలమైన సంఖ్యలు",
  },
  // Tamil numerology names: பிறவி எண் (birth / driver), விதி எண் (life path /
  // conductor), பெயர் எண் (name / destiny).
  ta: {
    title: "எண் கணித அறிக்கை",
    born: "பிறப்பு",
    generated: "தயாரித்த நாள்",
    driver: "பிறவி எண்",
    driver_alt: "பிறந்த தேதி எண்",
    conductor: "விதி எண்",
    conductor_alt: "வாழ்க்கைப் பாதை",
    soul: "ஆன்ம எண்",
    personality: "ஆளுமை எண்",
    destiny: "பெயர் எண்",
    section_driver: "பிறவி எண்",
    section_conductor: "விதி எண்",
    section_soul: "ஆன்ம எண்",
    section_personality: "ஆளுமை எண்",
    section_destiny: "பெயர் எண்",
    section_compatibility: "இணக்கமான எண்கள்",
    compat_intro: "உங்கள் பிறவி எண்ணுடன் இணக்கமான எண்கள்",
  },
  kn: {
    title: "ಸಂಖ್ಯಾಶಾಸ್ತ್ರ ವರದಿ",
    born: "ಜನನ",
    generated: "ತಯಾರಿಸಿದ ದಿನಾಂಕ",
    driver: "ಮೂಲಾಂಕ",
    driver_alt: "ಜನ್ಮ ದಿನಾಂಕ ಸಂಖ್ಯೆ",
    conductor: "ಭಾಗ್ಯಾಂಕ",
    conductor_alt: "ಜೀವನ ಮಾರ್ಗ",
    soul: "ಅಂತರಾತ್ಮ ಸಂಖ್ಯೆ",
    personality: "ವ್ಯಕ್ತಿತ್ವ ಸಂಖ್ಯೆ",
    destiny: "ನಾಮ ಸಂಖ್ಯೆ",
    section_driver: "ಮೂಲಾಂಕ",
    section_conductor: "ಭಾಗ್ಯಾಂಕ",
    section_soul: "ಅಂತರಾತ್ಮ ಸಂಖ್ಯೆ",
    section_personality: "ವ್ಯಕ್ತಿತ್ವ ಸಂಖ್ಯೆ",
    section_destiny: "ನಾಮ ಸಂಖ್ಯೆ",
    section_compatibility: "ಅನುಕೂಲ ಸಂಖ್ಯೆಗಳು",
    compat_intro: "ನಿಮ್ಮ ಮೂಲಾಂಕದೊಂದಿಗೆ ಹೊಂದುವ ಸಂಖ್ಯೆಗಳು",
  },
  ml: {
    title: "സംഖ്യാശാസ്ത്ര റിപ്പോർട്ട്",
    born: "ജനനം",
    generated: "തയ്യാറാക്കിയ തീയതി",
    driver: "മൂലാങ്കം",
    driver_alt: "ജനനത്തീയതി സംഖ്യ",
    conductor: "ഭാഗ്യാങ്കം",
    conductor_alt: "ജീവിതപാത",
    soul: "അന്തരാത്മ സംഖ്യ",
    personality: "വ്യക്തിത്വ സംഖ്യ",
    destiny: "നാമ സംഖ്യ",
    section_driver: "മൂലാങ്കം",
    section_conductor: "ഭാഗ്യാങ്കം",
    section_soul: "അന്തരാത്മ സംഖ്യ",
    section_personality: "വ്യക്തിത്വ സംഖ്യ",
    section_destiny: "നാമ സംഖ്യ",
    section_compatibility: "അനുയോജ്യ സംഖ്യകൾ",
    compat_intro: "നിങ്ങളുടെ മൂലാങ്കവുമായി യോജിക്കുന്ന സംഖ്യകൾ",
  },
  gu: {
    title: "અંકશાસ્ત્ર રિપોર્ટ",
    born: "જન્મ",
    generated: "તૈયાર",
    driver: "મૂળાંક",
    driver_alt: "જન્મ તારીખ અંક",
    conductor: "ભાગ્યાંક",
    conductor_alt: "જીવન પથ",
    soul: "અંતરાત્મા અંક",
    personality: "વ્યક્તિત્વ અંક",
    destiny: "નામ અંક",
    section_driver: "મૂળાંક",
    section_conductor: "ભાગ્યાંક",
    section_soul: "અંતરાત્મા અંક",
    section_personality: "વ્યક્તિત્વ અંક",
    section_destiny: "નામ અંક",
    section_compatibility: "સુસંગત અંક",
    compat_intro: "આપના મૂળાંક સાથે અનુકૂળ અંક",
  },
  bn: {
    title: "সংখ্যাতত্ত্ব রিপোর্ট",
    born: "জন্ম",
    generated: "তৈরি",
    driver: "মূলাঙ্ক",
    driver_alt: "জন্মতারিখের সংখ্যা",
    conductor: "ভাগ্যাঙ্ক",
    conductor_alt: "জীবনপথ",
    soul: "অন্তরাত্মার সংখ্যা",
    personality: "ব্যক্তিত্বের সংখ্যা",
    destiny: "নামের সংখ্যা",
    section_driver: "মূলাঙ্ক",
    section_conductor: "ভাগ্যাঙ্ক",
    section_soul: "অন্তরাত্মার সংখ্যা",
    section_personality: "ব্যক্তিত্বের সংখ্যা",
    section_destiny: "নামের সংখ্যা",
    section_compatibility: "সঙ্গতিপূর্ণ সংখ্যা",
    compat_intro: "আপনার মূলাঙ্কের সঙ্গে অনুকূল সংখ্যা",
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
  te: { planet: "గ్రహం", day: "వారం", color: "రంగు", gemstone: "రత్నం", deity: "దేవత", direction: "దిశ" },
  ta: { planet: "கிரகம்", day: "கிழமை", color: "நிறம்", gemstone: "ரத்தினம்", deity: "தெய்வம்", direction: "திசை" },
  kn: { planet: "ಗ್ರಹ", day: "ವಾರ", color: "ಬಣ್ಣ", gemstone: "ರತ್ನ", deity: "ದೇವತೆ", direction: "ದಿಕ್ಕು" },
  ml: { planet: "ഗ്രഹം", day: "ദിവസം", color: "നിറം", gemstone: "രത്നം", deity: "ദേവത", direction: "ദിക്ക്" },
  gu: { planet: "ગ્રહ", day: "વાર", color: "રંગ", gemstone: "રત્ન", deity: "દેવતા", direction: "દિશા" },
  bn: { planet: "গ্রহ", day: "বার", color: "রং", gemstone: "রত্ন", deity: "দেবতা", direction: "দিক" },
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
  te: {
    "1": "నాయకత్వం, స్వతంత్రత, మౌలికత. దృఢమైన సంకల్పశక్తి, చొరవ తీసుకునే సామర్థ్యం. స్వయంగా ప్రారంభించే పనుల్లో మీరు బాగా రాణిస్తారు; ఇతరుల ఆధీనంలో పనిచేయడం మీకు నచ్చదు.",
    "2": "సున్నితత్వం, సహకారం, భాగస్వామ్యం. ఇతరుల భావాలను మీరు బాగా గ్రహిస్తారు; కలిసి పనిచేసే వాతావరణంలో వికసిస్తారు.",
    "3": "వ్యక్తీకరణ, సృజనాత్మకత, ఆశావాదం. సంభాషణ, అభ్యాసం మీకు సహజ బలాలు; బోధన, రచన, కళలు అనుకూలం.",
    "4": "ఆచరణాత్మకత, క్రమబద్ధత, కష్టపడే తత్వం. పద్ధతిగా, క్రమశిక్షణతో పనిచేస్తారు; ఓర్పుతో శాశ్వత పునాదులు నిర్మిస్తారు.",
    "5": "స్వేచ్ఛ, మార్పు, బహుముఖ ప్రతిభ. జిజ్ఞాస, సాహసం, వేగంగా నేర్చుకునే గుణం; ఆసక్తి నిలవాలంటే మీకు వైవిధ్యం అవసరం.",
    "6": "బాధ్యత, సామరస్యం, కుటుంబం. పోషించే స్వభావం; ఇతరుల సంరక్షణలో, సౌందర్య సృష్టిలో మీరు జీవిత లక్ష్యాన్ని కనుగొంటారు.",
    "7": "ఆధ్యాత్మికత, ఆత్మపరిశీలన, విశ్లేషణ. లోతైన సత్యాన్ని అన్వేషిస్తారు; పరిశోధన, తత్త్వశాస్త్రం, సాధనలో రాణిస్తారు.",
    "8": "శక్తి, ఆకాంక్ష, భౌతిక నైపుణ్యం. విజయం కోసం బలమైన తపన; సంపదను, సంస్థలను నిర్మించి నిర్వహించగల సామర్థ్యం.",
    "9": "కరుణ, విశ్వజనీనత, సంపూర్ణత. మానవతా దృక్పథం; ఉదారంగా ఇస్తారు, మీ ఆచరణతో ఇతరులకు ప్రేరణ ఇస్తారు.",
    "11": "మాస్టర్ అంతర్దర్శి: ఉన్నత ఆధ్యాత్మిక సున్నితత్వం. సంఖ్య 2 శక్తికి విస్తరించిన రూపం; దూరదృష్టితో పాటు నరాల తీవ్రత కూడా ఉంటుంది.",
    "22": "మాస్టర్ నిర్మాత: పెద్ద దార్శనికతను సాకారం చేసే సామర్థ్యం. సంఖ్య 4 శక్తికి విస్తరించిన రూపం; ఆదర్శాలను స్పష్టమైన వారసత్వంగా మారుస్తారు.",
    "33": "మాస్టర్ గురువు: నైపుణ్యంతో కూడిన అంకితభావం. సంఖ్య 6 శక్తికి విస్తరించిన రూపం; కరుణతో కూడిన సేవకు ఉదాహరణగా జీవిస్తారు.",
  },
  ta: {
    "1": "தலைமை, சுதந்திரம், தனித்தன்மை. உறுதியான மன உறுதியும் முன்முயற்சி எடுக்கும் திறனும். நீங்களே தொடங்கும் பணிகளில் சிறந்து விளங்குவீர்கள்; பிறர் கட்டுப்பாட்டில் இருப்பது உங்களுக்குப் பிடிக்காது.",
    "2": "உணர்திறன், ஒத்துழைப்பு, கூட்டாண்மை. பிறரின் உணர்வுகளை நன்றாகப் புரிந்துகொள்வீர்கள்; கூட்டு முயற்சிச் சூழலில் செழிப்பீர்கள்.",
    "3": "வெளிப்பாடு, படைப்பாற்றல், நம்பிக்கை. பேச்சும் கற்றலும் உங்கள் இயல்பான பலம்; கற்பித்தல், எழுத்து, கலை சாதகம்.",
    "4": "நடைமுறை அறிவு, ஒழுங்கு, உழைப்பு. முறையாகவும் ஒழுக்கத்துடனும் செயல்படுவீர்கள்; பொறுமையுடன் நிலையான அடித்தளம் அமைப்பீர்கள்.",
    "5": "சுதந்திரம், மாற்றம், பன்முகத் திறமை. ஆர்வம், துணிச்சல், விரைவாகக் கற்கும் தன்மை; ஈடுபாடு நீடிக்க உங்களுக்குப் பல்வகைமை தேவை.",
    "6": "பொறுப்பு, இணக்கம், குடும்பம். பேணிக் காக்கும் இயல்பு; பிறரைக் கவனிப்பதிலும் அழகை உருவாக்குவதிலும் வாழ்க்கை நோக்கைக் காண்பீர்கள்.",
    "7": "ஆன்மிகம், சுயபரிசோதனை, பகுப்பாய்வு. ஆழ்ந்த உண்மையைத் தேடுவீர்கள்; ஆராய்ச்சி, தத்துவம், சாதனையில் சிறப்பீர்கள்.",
    "8": "சக்தி, லட்சியம், பொருள்சார் திறமை. சாதனைக்கான வலுவான உந்துதல்; செல்வத்தையும் நிறுவனங்களையும் உருவாக்கி நிர்வகிக்கும் திறன்.",
    "9": "கருணை, உலகளாவிய பார்வை, நிறைவு. மனிதநேய இயல்பு; தாராளமாகக் கொடுப்பீர்கள், உங்கள் நடத்தையால் பிறருக்கு ஊக்கம் தருவீர்கள்.",
    "11": "மாஸ்டர் உள்ளுணர்வாளர்: உயர்ந்த ஆன்மிக உணர்திறன். எண் 2-இன் ஆற்றலின் பெருக்கப்பட்ட வடிவம்; தொலைநோக்குத் திறனுடன் நரம்புத் தீவிரமும் இருக்கும்.",
    "22": "மாஸ்டர் கட்டமைப்பாளர்: பெரிய கனவுகளை நனவாக்கும் திறன். எண் 4-இன் ஆற்றலின் பெருக்கப்பட்ட வடிவம்; லட்சியங்களை உறுதியான மரபாக மாற்றுவீர்கள்.",
    "33": "மாஸ்டர் ஆசிரியர்: திறமையுடன் கூடிய அர்ப்பணிப்பு. எண் 6-இன் ஆற்றலின் பெருக்கப்பட்ட வடிவம்; கருணையுள்ள சேவைக்கு எடுத்துக்காட்டாக வாழ்வீர்கள்.",
  },
  kn: {
    "1": "ನಾಯಕತ್ವ, ಸ್ವಾತಂತ್ರ್ಯ, ಮೌಲಿಕತೆ. ದೃಢ ಇಚ್ಛಾಶಕ್ತಿ ಮತ್ತು ಮುನ್ನುಗ್ಗುವ ಸಾಮರ್ಥ್ಯ. ನೀವೇ ಆರಂಭಿಸುವ ಕೆಲಸಗಳಲ್ಲಿ ಚೆನ್ನಾಗಿ ಮಿಂಚುತ್ತೀರಿ; ಬೇರೆಯವರ ನಿಯಂತ್ರಣದಲ್ಲಿರುವುದು ನಿಮಗೆ ಇಷ್ಟವಾಗುವುದಿಲ್ಲ.",
    "2": "ಸೂಕ್ಷ್ಮತೆ, ಸಹಕಾರ, ಪಾಲುದಾರಿಕೆ. ಇತರರ ಭಾವನೆಗಳನ್ನು ಚೆನ್ನಾಗಿ ಅರಿಯುತ್ತೀರಿ; ಸಹಯೋಗದ ವಾತಾವರಣದಲ್ಲಿ ಅರಳುತ್ತೀರಿ.",
    "3": "ಅಭಿವ್ಯಕ್ತಿ, ಸೃಜನಶೀಲತೆ, ಆಶಾವಾದ. ಸಂವಹನ ಮತ್ತು ಕಲಿಕೆ ನಿಮ್ಮ ಸಹಜ ಶಕ್ತಿಗಳು; ಬೋಧನೆ, ಬರವಣಿಗೆ, ಕಲೆ ಅನುಕೂಲ.",
    "4": "ಪ್ರಾಯೋಗಿಕತೆ, ವ್ಯವಸ್ಥೆ, ಪರಿಶ್ರಮ. ಕ್ರಮಬದ್ಧವಾಗಿ, ಶಿಸ್ತಿನಿಂದ ಕೆಲಸ ಮಾಡುತ್ತೀರಿ; ತಾಳ್ಮೆಯಿಂದ ಶಾಶ್ವತ ಅಡಿಪಾಯ ಕಟ್ಟುತ್ತೀರಿ.",
    "5": "ಸ್ವಾತಂತ್ರ್ಯ, ಬದಲಾವಣೆ, ಬಹುಮುಖ ಪ್ರತಿಭೆ. ಕುತೂಹಲ, ಸಾಹಸ, ವೇಗವಾಗಿ ಕಲಿಯುವ ಗುಣ; ಆಸಕ್ತಿ ಉಳಿಯಲು ನಿಮಗೆ ವೈವಿಧ್ಯ ಬೇಕು.",
    "6": "ಜವಾಬ್ದಾರಿ, ಸಾಮರಸ್ಯ, ಕುಟುಂಬ. ಪೋಷಿಸುವ ಸ್ವಭಾವ; ಇತರರ ಆರೈಕೆ ಮತ್ತು ಸೌಂದರ್ಯ ಸೃಷ್ಟಿಯಲ್ಲಿ ಜೀವನದ ಉದ್ದೇಶ ಕಾಣುತ್ತೀರಿ.",
    "7": "ಆಧ್ಯಾತ್ಮಿಕತೆ, ಆತ್ಮಾವಲೋಕನ, ವಿಶ್ಲೇಷಣೆ. ಆಳವಾದ ಸತ್ಯವನ್ನು ಹುಡುಕುತ್ತೀರಿ; ಸಂಶೋಧನೆ, ತತ್ವಶಾಸ್ತ್ರ, ಸಾಧನೆಯಲ್ಲಿ ಮಿಂಚುತ್ತೀರಿ.",
    "8": "ಶಕ್ತಿ, ಮಹತ್ವಾಕಾಂಕ್ಷೆ, ಭೌತಿಕ ಕೌಶಲ. ಸಾಧನೆಗೆ ಬಲವಾದ ತುಡಿತ; ಸಂಪತ್ತು ಮತ್ತು ಉದ್ಯಮಗಳನ್ನು ಕಟ್ಟಿ ನಿರ್ವಹಿಸುವ ಸಾಮರ್ಥ್ಯ.",
    "9": "ಕರುಣೆ, ವಿಶ್ವಮಾನವತೆ, ಪೂರ್ಣತೆ. ಮಾನವೀಯ ಮನೋಭಾವ; ಉದಾರವಾಗಿ ನೀಡುತ್ತೀರಿ, ನಿಮ್ಮ ನಡೆಯಿಂದ ಇತರರಿಗೆ ಪ್ರೇರಣೆ ನೀಡುತ್ತೀರಿ.",
    "11": "ಮಾಸ್ಟರ್ ಅಂತರ್ದರ್ಶಿ: ಉನ್ನತ ಆಧ್ಯಾತ್ಮಿಕ ಸೂಕ್ಷ್ಮತೆ. ಸಂಖ್ಯೆ 2ರ ಶಕ್ತಿಯ ವರ್ಧಿತ ರೂಪ; ದೂರದೃಷ್ಟಿಯ ಜೊತೆಗೆ ನರಗಳ ತೀವ್ರತೆಯೂ ಇರುತ್ತದೆ.",
    "22": "ಮಾಸ್ಟರ್ ನಿರ್ಮಾತೃ: ದೊಡ್ಡ ದೃಷ್ಟಿಕೋನಗಳನ್ನು ಸಾಕಾರಗೊಳಿಸುವ ಸಾಮರ್ಥ್ಯ. ಸಂಖ್ಯೆ 4ರ ಶಕ್ತಿಯ ವರ್ಧಿತ ರೂಪ; ಆದರ್ಶಗಳನ್ನು ಸ್ಪಷ್ಟ ಪರಂಪರೆಯಾಗಿ ಬದಲಿಸುತ್ತೀರಿ.",
    "33": "ಮಾಸ್ಟರ್ ಗುರು: ಕೌಶಲದೊಂದಿಗೆ ಸಮರ್ಪಣೆ. ಸಂಖ್ಯೆ 6ರ ಶಕ್ತಿಯ ವರ್ಧಿತ ರೂಪ; ಕರುಣೆಯ ಸೇವೆಗೆ ಉದಾಹರಣೆಯಾಗಿ ಬದುಕುತ್ತೀರಿ.",
  },
  ml: {
    "1": "നേതൃത്വം, സ്വാതന്ത്ര്യം, മൗലികത. ഉറച്ച ഇച്ഛാശക്തിയും മുൻകൈ എടുക്കാനുള്ള കഴിവും. സ്വയം തുടങ്ങുന്ന കാര്യങ്ങളിൽ നിങ്ങൾ മികവു കാട്ടും; മറ്റുള്ളവരുടെ നിയന്ത്രണത്തിൽ പ്രവർത്തിക്കുന്നത് നിങ്ങൾക്ക് ഇഷ്ടമല്ല.",
    "2": "സംവേദനക്ഷമത, സഹകരണം, പങ്കാളിത്തം. മറ്റുള്ളവരുടെ വികാരങ്ങൾ നിങ്ങൾ നന്നായി തിരിച്ചറിയും; ഒത്തൊരുമിച്ചു പ്രവർത്തിക്കുന്ന അന്തരീക്ഷത്തിൽ നിങ്ങൾ വളരും.",
    "3": "ആവിഷ്കാരം, സർഗാത്മകത, ശുഭാപ്തിവിശ്വാസം. ആശയവിനിമയവും പഠനവും നിങ്ങളുടെ സ്വാഭാവിക കരുത്താണ്; അധ്യാപനം, എഴുത്ത്, കല എന്നിവ അനുകൂലം.",
    "4": "പ്രായോഗികത, ചിട്ട, കഠിനാധ്വാനം. ക്രമത്തോടെയും അച്ചടക്കത്തോടെയും പ്രവർത്തിക്കും; ക്ഷമയോടെ ഉറച്ച അടിത്തറ പണിയും.",
    "5": "സ്വാതന്ത്ര്യം, മാറ്റം, ബഹുമുഖപ്രതിഭ. ജിജ്ഞാസ, സാഹസികത, വേഗത്തിൽ പഠിക്കാനുള്ള കഴിവ്; താൽപ്പര്യം നിലനിൽക്കാൻ നിങ്ങൾക്ക് വൈവിധ്യം ആവശ്യമാണ്.",
    "6": "ഉത്തരവാദിത്തം, ഐക്യം, കുടുംബം. പരിപാലിക്കുന്ന സ്വഭാവം; മറ്റുള്ളവരെ സംരക്ഷിക്കുന്നതിലും സൗന്ദര്യം സൃഷ്ടിക്കുന്നതിലും നിങ്ങൾ ജീവിതലക്ഷ്യം കണ്ടെത്തും.",
    "7": "ആത്മീയത, ആത്മപരിശോധന, വിശകലനം. ആഴമേറിയ സത്യം തേടുന്നവർ; ഗവേഷണം, തത്ത്വചിന്ത, സാധന എന്നിവയിൽ നിങ്ങൾ ശോഭിക്കും.",
    "8": "ശക്തി, മഹത്ത്വാകാംക്ഷ, ഭൗതിക കാര്യക്ഷമത. നേട്ടങ്ങൾക്കായുള്ള ശക്തമായ ആഗ്രഹം; സമ്പത്തും സംരംഭങ്ങളും കെട്ടിപ്പടുത്തു നടത്താനുള്ള കഴിവ്.",
    "9": "കരുണ, വിശ്വമാനവികത, പൂർണത. മാനവികമായ മനോഭാവം; ഉദാരമായി നൽകും, സ്വന്തം മാതൃകയിലൂടെ മറ്റുള്ളവർക്കു പ്രചോദനമാകും.",
    "11": "മാസ്റ്റർ അന്തർജ്ഞാനി: ഉയർന്ന ആത്മീയ സംവേദനക്ഷമത. സംഖ്യ 2-ന്റെ ഊർജത്തിന്റെ വർധിതരൂപം; ദീർഘവീക്ഷണത്തോടൊപ്പം നാഡീവ്യൂഹത്തിന്റെ തീവ്രതയും ഉണ്ടാകും.",
    "22": "മാസ്റ്റർ നിർമാതാവ്: വലിയ ദർശനങ്ങൾ യാഥാർഥ്യമാക്കാനുള്ള കഴിവ്. സംഖ്യ 4-ന്റെ ഊർജത്തിന്റെ വർധിതരൂപം; ആദർശങ്ങളെ മൂർത്തമായ പൈതൃകമാക്കി മാറ്റും.",
    "33": "മാസ്റ്റർ ഗുരു: കഴിവിനൊപ്പം സമർപ്പണം. സംഖ്യ 6-ന്റെ ഊർജത്തിന്റെ വർധിതരൂപം; കരുണാപൂർണമായ സേവനത്തിന്റെ മാതൃകയായി ജീവിക്കും.",
  },
  gu: {
    "1": "નેતૃત્વ, સ્વતંત્રતા, મૌલિકતા. દૃઢ ઇચ્છાશક્તિ અને પહેલ કરવાની ક્ષમતા. આપ જાતે શરૂ કરેલાં કાર્યોમાં શ્રેષ્ઠ રહો છો; બીજાના નિયંત્રણમાં રહેવું આપને ગમતું નથી.",
    "2": "સંવેદનશીલતા, સહયોગ, ભાગીદારી. આપ ભાવનાઓના પ્રવાહને સારી રીતે પારખો છો; સહયોગભર્યા વાતાવરણમાં આપ ખીલી ઊઠો છો.",
    "3": "અભિવ્યક્તિ, સર્જનાત્મકતા, આશાવાદ. સંવાદ અને અભ્યાસ આપની સ્વાભાવિક શક્તિઓ છે; શિક્ષણ, લેખન અને કલા અનુકૂળ છે.",
    "4": "વ્યવહારુતા, વ્યવસ્થા, પરિશ્રમ. આપ પદ્ધતિસર અને અનુશાસિત છો; ધીરજથી સ્થાયી પાયો રચો છો.",
    "5": "સ્વતંત્રતા, પરિવર્તન, બહુમુખી પ્રતિભા. જિજ્ઞાસુ, સાહસિક અને ઝડપથી શીખનારા; રસ જાળવી રાખવા આપને વિવિધતા જોઈએ છે.",
    "6": "જવાબદારી, સામંજસ્ય, પરિવાર. પોષણ કરનારો સ્વભાવ; બીજાની સંભાળ અને સૌંદર્યની રચનામાં આપને જીવનનો હેતુ મળે છે.",
    "7": "આધ્યાત્મિકતા, આત્મનિરીક્ષણ, વિશ્લેષણ. આપ ઊંડા સત્યના શોધક છો; સંશોધન, દર્શન અને સાધનામાં આપ ખીલો છો.",
    "8": "શક્તિ, મહત્ત્વાકાંક્ષા, ભૌતિક કુશળતા. સિદ્ધિની પ્રબળ ઇચ્છા; સંપત્તિ અને ઉદ્યોગ ઊભા કરવાની ક્ષમતા.",
    "9": "કરુણા, વૈશ્વિકતા, પૂર્ણતા. માનવતાવાદી વૃત્તિ; આપ ઉદારતાથી આપો છો અને પોતાના ઉદાહરણથી પ્રેરણા આપો છો.",
    "11": "માસ્ટર અંતર્દર્શી: ઉચ્ચ આધ્યાત્મિક સંવેદનશીલતા. અંક 2ની ઊર્જાનું વિસ્તૃત રૂપ; દૂરદર્શી ક્ષમતા સાથે જ્ઞાનતંતુઓની તીવ્રતા.",
    "22": "માસ્ટર નિર્માતા: વિશાળ દૃષ્ટિને સાકાર કરવાની ક્ષમતા. અંક 4ની ઊર્જાનું વિસ્તૃત રૂપ; આપ આદર્શોને મૂર્ત વારસામાં બદલો છો.",
    "33": "માસ્ટર શિક્ષક: કૌશલ્ય સાથે સમર્પણ. અંક 6ની ઊર્જાનું વિસ્તૃત રૂપ; આપ કરુણાભરી સેવાનું ઉદાહરણ બનીને જીવો છો.",
  },
  bn: {
    "1": "নেতৃত্ব, স্বাধীনতা, মৌলিকতা। দৃঢ় ইচ্ছাশক্তি আর উদ্যোগ নেওয়ার ক্ষমতা। নিজে শুরু করা কাজে আপনি সবচেয়ে ভালো করেন; অন্যের নিয়ন্ত্রণে থাকা আপনার পছন্দ নয়।",
    "2": "সংবেদনশীলতা, সহযোগিতা, অংশীদারি। মনের স্রোত আপনি ভালো বুঝতে পারেন; সহযোগিতার পরিবেশে আপনি বিকশিত হন।",
    "3": "প্রকাশ, সৃজনশীলতা, আশাবাদ। কথা বলা আর শেখা আপনার স্বাভাবিক শক্তি; শিক্ষকতা, লেখালেখি আর শিল্পকলা অনুকূল।",
    "4": "বাস্তববুদ্ধি, শৃঙ্খলা, পরিশ্রম। আপনি পদ্ধতিমাফিক আর নিয়মনিষ্ঠ; ধৈর্যের সঙ্গে স্থায়ী ভিত গড়ে তোলেন।",
    "5": "স্বাধীনতা, পরিবর্তন, বহুমুখী প্রতিভা। আপনি কৌতূহলী, সাহসী আর দ্রুত শেখেন; আগ্রহ ধরে রাখতে আপনার বৈচিত্র্য দরকার।",
    "6": "দায়িত্ব, সম্প্রীতি, পরিবার। যত্নশীল স্বভাব; অন্যের দেখাশোনা আর সৌন্দর্য সৃষ্টিতে আপনি জীবনের উদ্দেশ্য খুঁজে পান।",
    "7": "আধ্যাত্মিকতা, আত্মসমীক্ষা, বিশ্লেষণ। আপনি গভীর সত্যের সন্ধানী; গবেষণা, দর্শন আর সাধনায় আপনি বিকশিত হন।",
    "8": "শক্তি, উচ্চাকাঙ্ক্ষা, বৈষয়িক দক্ষতা। সাফল্যের প্রবল ইচ্ছা; সম্পদ আর উদ্যোগ গড়ে তোলার ক্ষমতা আপনার আছে।",
    "9": "করুণা, বিশ্বজনীনতা, পূর্ণতা। মানবিক প্রবৃত্তি; আপনি উদারভাবে দেন আর নিজের দৃষ্টান্তে অন্যকে অনুপ্রাণিত করেন।",
    "11": "মাস্টার অন্তর্দর্শী: উচ্চ আধ্যাত্মিক সংবেদনশীলতা। 2 সংখ্যার শক্তির বর্ধিত রূপ; দূরদর্শী ক্ষমতার সঙ্গে স্নায়ুর তীব্রতা।",
    "22": "মাস্টার নির্মাতা: বড় স্বপ্নকে বাস্তবে রূপ দেওয়ার ক্ষমতা। 4 সংখ্যার শক্তির বর্ধিত রূপ; আপনি আদর্শকে বাস্তব উত্তরাধিকারে পরিণত করেন।",
    "33": "মাস্টার শিক্ষক: দক্ষতার সঙ্গে নিষ্ঠা। 6 সংখ্যার শক্তির বর্ধিত রূপ; আপনি করুণাময় সেবার দৃষ্টান্ত হয়ে জীবন কাটান।",
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
  locale: string,
): string {
  if (!factors) return "";
  // The API sends every factor value in the request language. Older API builds
  // sent English for te/ta/kn/ml/gu/bn, so planet and weekday names are still
  // mapped to the engine's native names (already-native values pass through).
  return `<dl class="factors-grid">
  <dt>${esc(fl("planet"))}</dt><dd>${esc(localizeLord(locale, factors.planet))}</dd>
  <dt>${esc(fl("day"))}</dt><dd>${esc(localizeWeekday(locale, factors.day))}</dd>
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
  ${factorsHtml(factors, fl, locale)}
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
