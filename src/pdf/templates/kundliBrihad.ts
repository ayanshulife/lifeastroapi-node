/**
 * Brihad Kundli (comprehensive premium kundli) report → HTML.
 *
 * Ported verbatim (design + i18n) from the server-side Go template at
 * `internal/pdf/brihad_kundli.go`. Consumes the JSON exactly as returned by
 * `GET /v1/reports/kundli/brihad` and emits a self-contained HTML document
 * ready to convert to PDF.
 *
 * This is the flagship report. The Go template renders 10 sections (each
 * guarded so absent data collapses to nothing):
 *   Cover, Birth Chart Summary (ascendant + planet table), Planetary Analysis,
 *   House Analysis, Yogas, Vimshottari Dasha, Remedies, Divisional Charts,
 *   Doshas, Predictions by Life Area, Classical Citations.
 */

import {
  esc,
  escBody,
  resolveBranding,
  coverBrandingHtml,
  layoutDocument,
  makeLabeler,
  type Branding,
  type RawBranding,
} from "../shared.js";
import {
  brihadDeepBlocks,
  renderNorthChart,
  renderGrahaSthiti,
  renderChapter,
  type BrihadDeepData,
  type BrihadNarrativeChapter,
} from "./kundliBrihadSections.js";
import { isDevanagariLocale, lordLabel } from "../locales.js";

// ---------------------------------------------------------------------------
// Data shapes — JSON keys exactly as emitted by the Go struct.
//   Go field WITHOUT `json:` tag → PascalCase field name.
//   Go field WITH `json:"x"`     → "x".
// ---------------------------------------------------------------------------

/** A sign + degree pair (ascendant and every natal planet). snake_case keys. */
export interface BrihadPlacement {
  sign?: string;
  dms_within?: string;
  nakshatra?: string;
  pada?: number;
  nak_lord?: string;
}

/** One natal planet row. */
export interface BrihadPlanet {
  name?: string;
  name_en?: string; // canonical English name — locale-independent key for the summary lookup
  placement?: BrihadPlacement;
  house_num?: number;
  retro?: boolean;
}

/** Cover metadata. */
export interface BrihadSubject {
  Name?: string;
  BirthDate?: string;
  BirthTime?: string;
  BirthPlace?: string;
  Lat?: number;
  Lon?: number;
}

/** One house's narrative + meta (PascalCase — no json tags in Go). */
export interface BrihadHouseSection {
  HouseNum?: number;
  LordEN?: string;
  LordHI?: string;
  /** Lord in the request locale (any non-en locale; omitted for en). Preferred when present. */
  LordLocal?: string;
  LordSign?: string;
  Body?: string;
}

/** One detected yoga (PascalCase). */
export interface BrihadYoga {
  NameEN?: string;
  NameHI?: string;
  /** Name in the request locale (any non-en locale; omitted for en). Preferred when present. */
  NameLocal?: string;
  Effect?: string;
  Source?: string;
}

/** One Vimshottari Mahadasha period (PascalCase). */
export interface BrihadDashaPeriod {
  Lord?: string;
  LordHI?: string;
  /** Lord in the request locale (any non-en locale; omitted for en). Preferred when present. */
  LordLocal?: string;
  StartDate?: string;
  EndDate?: string;
  DurationY?: number;
  Body?: string;
}

/** One inline remedy (PascalCase). */
export interface BrihadRemedy {
  Title?: string;
  Description?: string;
  Category?: string;
}

/** One planet's placement in a divisional chart (snake_case via json tags). */
export interface BrihadDivisionalPlanet {
  name?: string;
  sign?: string;
  house?: number;
}

/** One varga chart's render data (snake_case via json tags). */
export interface BrihadDivisional {
  varga?: string;
  name?: string;
  subtitle?: string;
  lagna_sign?: string;
  planets?: BrihadDivisionalPlanet[];
}

/** One dosha's render data (PascalCase). */
export interface BrihadDoshaEntry {
  NameEN?: string;
  NameHI?: string;
  /** Name in the request locale (any non-en locale; omitted for en). Preferred when present. */
  NameLocal?: string;
  Severity?: string;
  Body?: string;
  Source?: string;
}

/** The composite dosha block (PascalCase). Each subfield nil → absent. */
export interface BrihadDoshas {
  Mangal?: BrihadDoshaEntry | null;
  KaalSarp?: BrihadDoshaEntry | null;
  Pitra?: BrihadDoshaEntry | null;
}

/** One life-area forecast (PascalCase). */
export interface BrihadPrediction {
  Area?: string;
  Body?: string;
}

/** One classical-text reference (PascalCase). */
export interface BrihadCitation {
  Topic?: string;
  Source?: string;
  Note?: string;
}

/** The full Brihad Kundli report payload. */
export interface KundliBrihadData extends BrihadDeepData {
  Locale?: string;
  Branding?: RawBranding;
  Subject?: BrihadSubject;
  Ascendant?: BrihadPlacement;
  Planets?: BrihadPlanet[];
  Houses?: BrihadHouseSection[];
  Yogas?: BrihadYoga[];
  CurrentDasha?: BrihadDashaPeriod | null;
  UpcomingDashas?: BrihadDashaPeriod[];
  Remedies?: BrihadRemedy[];
  DivisionalCharts?: BrihadDivisional[];
  Doshas?: BrihadDoshas | null;
  Predictions?: BrihadPrediction[];
  Citations?: BrihadCitation[];
  GeneratedAt?: string;
}

// ---------------------------------------------------------------------------
// i18n — ported verbatim from brihadLabels (en/hi/mr).
// ---------------------------------------------------------------------------

export const LABELS: Record<string, Record<string, string>> = {
  en: {
    // --- Brihat deep-section labels ---
    section_avakahada: "Avakahada Chakra (Birth Details)",
    avk_paya: "Paya", avk_varna: "Varna", avk_vashya: "Vashya", avk_yoni: "Yoni",
    avk_gana: "Gana", avk_nadi: "Nadi", avk_tatva: "Tatva", avk_nak_lord: "Nakshatra Lord",
    avk_rashi_lord: "Rashi Lord", avk_lagna_lord: "Lagna Lord",
    section_panchang: "Panchang at Birth",
    panchang_intro: "The five limbs of the almanac (Panchang) at the moment of your birth.",
    panchang_tithi: "Tithi", panchang_vara: "Weekday (Vara)", panchang_nakshatra: "Nakshatra",
    panchang_yoga: "Yoga", panchang_karana: "Karana",
    section_gems: "Gem Recommendation",
    gems_intro: "Gemstones that strengthen the lords of your most benefic houses (lagna and the trikonas).",
    gems_kind: "Type", gems_stone: "Gemstone", gems_planet: "Planet", gems_reason: "Basis",
    gems_note: "Wear a gemstone only after consulting a qualified astrologer; the right weight, metal and day of wearing matter.",
    section_ghata: "Ghata Chakra (Inauspicious Points)",
    ghata_intro: "The Ghata Chakra marks the inauspicious weekday, tithi, month and nakshatra for the native.",
    ghata_weekday: "Inauspicious Weekday", ghata_tithi: "Tithi", ghata_month: "Month",
    ghata_nakshatra: "Nakshatra", ghata_yoga: "Yoga", ghata_karana: "Karana",
    ghata_prahar: "Prahar", ghata_rashi: "Ghata Rashi",
    section_chalit: "Bhava Chalit (Cuspal Chart)",
    chalit_intro: "The Chalit chart places planets by precise house cusps (Sripati), revealing house shifts the Rashi chart hides.",
    chalit_house: "House", chalit_begin: "Begins", chalit_madhya: "Midpoint",
    chalit_planets: "Planet House Shifts", chalit_rashi_house: "Rashi House",
    chalit_bhava_house: "Chalit House", chalit_shifted: "Shifted",
    section_kp: "KP System (Krishnamurti Paddhati)",
    kp_intro: "Cuspal sub-lords and planetary significators per the KP stellar system.",
    kp_star_lord: "Star Lord", kp_sub_lord: "Sub Lord", kp_subsub_lord: "Sub-Sub Lord",
    kp_significators: "Planetary Significators", kp_signifies_houses: "Signifies Houses",
    kp_ruling_planets: "Ruling Planets", kp_rp_role: "Role",
    kp_rp_lagna_nakshatra_lord: "Lagna Nakshatra Lord", kp_rp_lagna_rashi_lord: "Lagna Rashi Lord",
    kp_rp_moon_nakshatra_lord: "Moon Nakshatra Lord", kp_rp_moon_rashi_lord: "Moon Rashi Lord",
    kp_rp_day_lord: "Day Lord", kp_rp_lagna_sub_lord: "Lagna Sub Lord", kp_rp_moon_sub_lord: "Moon Sub Lord",
    section_jaimini: "Jaimini System",
    jaimini_charakarakas: "Chara Karakas", jaimini_karaka: "Karaka",
    jaimini_karakamsa: "Karakamsa", jaimini_swamsa: "Swamsa", jaimini_arudha: "Arudha Padas",
    jaimini_pada: "Pada",
    section_ishta: "Ishta Devata (Tutelary Deity)",
    ishta_intro: "The Ishta Devata is the personal deity for spiritual progress, read from the 12th from Karakamsa.",
    ishta_deity: "Deity", ishta_12th_sign: "12th-from-Karakamsa Sign", ishta_graha: "Determining Graha",
    section_maitri: "Maitri Chakra (Planetary Friendships)",
    maitri_intro: "Natural, temporal and combined (Panchadha) friendships between the grahas.",
    maitri_naisargik: "Naisargik (Natural)", maitri_tatkalik: "Tatkalik (Temporal)",
    maitri_panchadha: "Panchadha (Combined)",
    section_avastha: "Graha Avastha (Planetary States)",
    avastha_intro: "The states (avasthas) of each graha by the Baladi, Jagradadi and Deeptadi schemes.",
    avastha_baladi: "Baladi", avastha_jagradadi: "Jagradadi", avastha_deeptadi: "Deeptadi",
    section_lalkitab: "Lal Kitab Analysis",
    lalkitab_intro: "The Lal Kitab houses, ancestral debts (Rin) and Teva classification.",
    lalkitab_planets: "Planet Placements", lalkitab_rins: "Ancestral Debts (Rin)",
    lalkitab_rin: "Debt", lalkitab_status: "Status",
    lk_present: "Present", lk_absent: "Absent",
    section_shadbala: "Shadbala (Sixfold Strength)",
    shadbala_intro: "Total Shadbala in Rupas, ranked from strongest to weakest planet.",
    shadbala_rupas: "Rupas", shadbala_rank: "Rank",
    section_bhavabala: "Bhava Bala (House Strength)",
    bhavabala_intro: "Strength of each of the 12 houses — lord's strength, natural dig-bala, and aspectual bala.",
    bb_lord: "Lord Bala", bb_dig: "Dig Bala", bb_drsti: "Drishti Bala", bb_total: "Total",
    section_ashtakavarga: "Ashtakavarga",
    ashtakavarga_intro: "The Sarvashtakavarga (SAV) benefic-point totals per sign, plus per-planet Bhinnashtakavarga.",
    ashtakavarga_sav: "Sign", ashtakavarga_bindus: "Bindus", ashtakavarga_total: "Total",
    ashtakavarga_prastar: "Per-Planet Totals", ashtakavarga_planet_total: "Total Bindus",
    section_varshaphal: "Varshaphal (Annual Horoscope)",
    section_mudda: "Monthly Forecast (Mudda Dasha)",
    varshaphal_to: "to",
    varshaphal_intro: "Annual solar-return analysis with Muntha, year-lord, Sahams and Panchavargeeya strength.",
    varshaphal_year: "Year", varshaphal_muntha: "Muntha", varshaphal_lord: "Varsha Lord",
    varshaphal_sahams: "Sahams (Sensitive Points)", varshaphal_saham: "Saham",
    varshaphal_panchavargeeya: "Panchavargeeya Bala", varshaphal_vishwa: "Vishwa",
    section_rajyoga: "Rajyoga Strength & Golden Periods",
    rajyoga_strength: "Rajyoga Strength", rajyoga_planets: "Yoga-Forming Planets",
    rajyoga_swarnim: "Swarnim Kaal (Golden Periods)", rajyoga_from: "From", rajyoga_to: "To",
    title_brihad: "Brihad Kundli",
    subtitle_brihad: "A comprehensive Vedic astrology analysis",
    born: "Born",
    at: "at",
    in: "in",
    generated: "Generated on",
    // Part dividers (level-1 bookmarks) for the Part 0–7 layout.
    part_foundations: "Part 1: Foundations",
    part_life_reading: "Part 2: Your Life Reading",
    part_yoga_dosha: "Part 3: Yogas & Doshas",
    part_dasha: "Part 4: Dasha (Life Periods)",
    part_remedies: "Part 5: Remedies & Guidance",
    part_technical: "Part 6: Technical Tables",
    part_varshaphal: "Part 7: Varshaphal (Annual)",
    section_chart: "Birth Chart Summary",
    chart_lagna: "Lagna Chart", chart_navamsa: "Navamsa (D9)",
    section_graha_sthiti: "Planetary Positions",
    section_planets_analysis: "Planetary Analysis",
    section_houses: "House Analysis",
    section_yogas: "Yogas Detected in the Chart",
    section_dashas: "Vimshottari Dasha — Life Periods",
    section_remedies: "Recommended Remedies",
    ascendant: "Ascendant",
    nakshatra: "Nakshatra",
    pada: "Pada",
    planet: "Planet",
    sign: "Sign",
    degree: "Degree",
    house: "House",
    lord: "Lord",
    current_dasha: "Current Mahadasha",
    upcoming_dashas: "Upcoming Mahadashas",
    years: "years",
    date_to: "to",
    yogas_none: "No major yogas were detected for this chart configuration.",
    dashas_none: "Dasha computation is unavailable for this chart.",
    remedies_none: "No specific remedies needed at this time.",
    house_no_content: "Detailed interpretation for this house is being prepared.",
    source: "Source",
    // Phase 2 labels
    section_divisionals: "Divisional Charts",
    divisionals_intro: "The divisional charts (vargas) zoom into specific areas of life — each one refines the reading of a different domain, from wealth and siblings to marriage, career and spiritual growth.",
    section_doshas: "Doshas Detected",
    section_predictions: "Predictions by Life Area",
    section_citations: "Classical Sources & Citations",
    divisional_lagna: "Lagna",
    dosha_mangal: "Mangal Dosha",
    dosha_kaalsarp: "Kaal Sarp Dosha",
    dosha_pitra: "Pitra Dosha",
    dosha_severity_present: "Present",
    dosha_severity_cancelled: "Cancelled",
    dosha_severity_mild: "Mild",
    doshas_none_detected: "No major doshas were detected for this chart configuration.",
    area_career: "Career & Profession",
    area_marriage: "Marriage & Relationships",
    area_wealth: "Wealth & Finance",
    area_health: "Health & Vitality",
    area_education: "Education & Learning",
    area_family: "Family & Home",
    predictions_none: "Personalized predictions are being prepared for this chart.",
    citations_none: "No classical citations are available for this chart yet.",
    citations_intro:
      "Each interpretation in this report is backed by a classical Vedic text. Below is the list of sources cited:",
  },
  hi: {
    // --- Brihat deep-section labels (Hindi) ---
    section_avakahada: "अवकहड़ा चक्र (जन्म विवरण)",
    avk_paya: "पाया", avk_varna: "वर्ण", avk_vashya: "वश्य", avk_yoni: "योनि",
    avk_gana: "गण", avk_nadi: "नाड़ी", avk_tatva: "तत्व", avk_nak_lord: "नक्षत्र स्वामी",
    avk_rashi_lord: "राशि स्वामी", avk_lagna_lord: "लग्न स्वामी",
    section_panchang: "जन्म-कालीन पंचांग",
    panchang_intro: "आपके जन्म के समय का पंचांग — तिथि, वार, नक्षत्र, योग एवं करण।",
    panchang_tithi: "तिथि", panchang_vara: "वार", panchang_nakshatra: "नक्षत्र",
    panchang_yoga: "योग", panchang_karana: "करण",
    section_gems: "रत्न अनुशंसा",
    gems_intro: "आपकी कुंडली के सर्वाधिक शुभ भावों (लग्न एवं त्रिकोण) के स्वामियों को बल देने वाले रत्न।",
    gems_kind: "प्रकार", gems_stone: "रत्न", gems_planet: "ग्रह", gems_reason: "आधार",
    gems_note: "रत्न किसी योग्य ज्योतिषी से परामर्श के बाद ही धारण कीजिए; उचित वजन, धातु एवं धारण का दिन महत्वपूर्ण है।",
    section_ghata: "घात चक्र (अशुभ बिंदु)",
    ghata_intro: "घात चक्र आपके लिए अशुभ वार, तिथि, मास एवं नक्षत्र दर्शाता है।",
    ghata_weekday: "अशुभ वार", ghata_tithi: "तिथि", ghata_month: "मास",
    ghata_nakshatra: "नक्षत्र", ghata_yoga: "योग", ghata_karana: "करण",
    ghata_prahar: "प्रहर", ghata_rashi: "घात राशि",
    section_chalit: "भाव चलित (कस्पल कुंडली)",
    chalit_intro: "चलित कुंडली ग्रहों को सटीक भाव-संधि (श्रीपति) के अनुसार रखती है, जिससे राशि कुंडली में छिपे भाव-परिवर्तन प्रकट होते हैं।",
    chalit_house: "भाव", chalit_begin: "आरंभ", chalit_madhya: "मध्य",
    chalit_planets: "ग्रह भाव-परिवर्तन", chalit_rashi_house: "राशि भाव",
    chalit_bhava_house: "चलित भाव", chalit_shifted: "परिवर्तित",
    section_kp: "केपी पद्धति (कृष्णमूर्ति पद्धति)",
    kp_intro: "केपी नक्षत्र पद्धति के अनुसार भाव-संधि उप-स्वामी एवं ग्रह कारक।",
    kp_star_lord: "नक्षत्र स्वामी", kp_sub_lord: "उप स्वामी", kp_subsub_lord: "उप-उप स्वामी",
    kp_significators: "ग्रह कारक", kp_signifies_houses: "कारक भाव",
    kp_ruling_planets: "शासक ग्रह", kp_rp_role: "भूमिका",
    kp_rp_lagna_nakshatra_lord: "लग्न नक्षत्र स्वामी", kp_rp_lagna_rashi_lord: "लग्न राशि स्वामी",
    kp_rp_moon_nakshatra_lord: "चंद्र नक्षत्र स्वामी", kp_rp_moon_rashi_lord: "चंद्र राशि स्वामी",
    kp_rp_day_lord: "वार स्वामी", kp_rp_lagna_sub_lord: "लग्न उप स्वामी", kp_rp_moon_sub_lord: "चंद्र उप स्वामी",
    section_jaimini: "जैमिनी पद्धति",
    jaimini_charakarakas: "चर कारक", jaimini_karaka: "कारक",
    jaimini_karakamsa: "कारकांश", jaimini_swamsa: "स्वांश", jaimini_arudha: "अरुढ़ पद",
    jaimini_pada: "पद",
    section_ishta: "इष्ट देवता",
    ishta_intro: "इष्ट देवता आध्यात्मिक उन्नति के लिए व्यक्तिगत देवता हैं, जो कारकांश से बारहवें भाव से ज्ञात होते हैं।",
    ishta_deity: "देवता", ishta_12th_sign: "कारकांश से 12वीं राशि", ishta_graha: "निर्धारक ग्रह",
    section_maitri: "मैत्री चक्र (ग्रह मैत्री)",
    maitri_intro: "ग्रहों के बीच नैसर्गिक, तात्कालिक एवं पंचधा (संयुक्त) मैत्री संबंध।",
    maitri_naisargik: "नैसर्गिक (स्वाभाविक)", maitri_tatkalik: "तात्कालिक (कालिक)",
    maitri_panchadha: "पंचधा (संयुक्त)",
    section_avastha: "ग्रह अवस्था",
    avastha_intro: "बालादि, जाग्रदादि एवं दीप्तादि पद्धति के अनुसार प्रत्येक ग्रह की अवस्थाएँ।",
    avastha_baladi: "बालादि", avastha_jagradadi: "जाग्रदादि", avastha_deeptadi: "दीप्तादि",
    section_lalkitab: "लाल किताब विश्लेषण",
    lalkitab_intro: "लाल किताब के भाव, पितृ ऋण एवं तेवा वर्गीकरण।",
    lalkitab_planets: "ग्रह स्थिति", lalkitab_rins: "पितृ ऋण",
    lalkitab_rin: "ऋण", lalkitab_status: "स्थिति",
    lk_present: "उपस्थित", lk_absent: "अनुपस्थित",
    section_shadbala: "षड्बल (छह प्रकार का बल)",
    shadbala_intro: "रूप में कुल षड्बल, प्रबलतम से न्यूनतम ग्रह तक क्रमबद्ध।",
    shadbala_rupas: "रूप", shadbala_rank: "क्रम",
    section_bhavabala: "भाव बल (भाव की शक्ति)",
    bhavabala_intro: "बारह भावों में से प्रत्येक की शक्ति — भावेश बल, दिग्बल एवं दृष्टि बल।",
    bb_lord: "भावेश बल", bb_dig: "दिग्बल", bb_drsti: "दृष्टि बल", bb_total: "कुल",
    section_ashtakavarga: "अष्टकवर्ग",
    ashtakavarga_intro: "प्रत्येक राशि के सर्वाष्टकवर्ग (SAV) शुभ-बिंदु योग, एवं ग्रह-वार भिन्नाष्टकवर्ग।",
    ashtakavarga_sav: "राशि", ashtakavarga_bindus: "बिंदु", ashtakavarga_total: "कुल",
    ashtakavarga_prastar: "ग्रह-वार कुल", ashtakavarga_planet_total: "कुल बिंदु",
    section_varshaphal: "वर्षफल (वार्षिक कुंडली)",
    section_mudda: "मासिक भविष्यफल (मुद्दा दशा)",
    varshaphal_to: "से",
    varshaphal_intro: "मुंथा, वर्षेश, सहम एवं पंचवर्गीय बल सहित वार्षिक सौर-प्रत्यागमन विश्लेषण।",
    varshaphal_year: "वर्ष", varshaphal_muntha: "मुंथा", varshaphal_lord: "वर्षेश",
    varshaphal_sahams: "सहम (संवेदनशील बिंदु)", varshaphal_saham: "सहम",
    varshaphal_panchavargeeya: "पंचवर्गीय बल", varshaphal_vishwa: "विश्व",
    section_rajyoga: "राजयोग शक्ति एवं स्वर्णिम काल",
    rajyoga_strength: "राजयोग शक्ति", rajyoga_planets: "योगकारक ग्रह",
    rajyoga_swarnim: "स्वर्णिम काल", rajyoga_from: "से", rajyoga_to: "तक",
    title_brihad: "बृहत् कुंडली",
    subtitle_brihad: "विस्तृत वैदिक ज्योतिष विश्लेषण",
    born: "जन्म",
    at: "समय",
    in: "में",
    generated: "तैयार",
    // Part dividers (level-1 bookmarks) for the Part 0–7 layout.
    part_foundations: "भाग 1: आधार",
    part_life_reading: "भाग 2: आपका जीवन-दर्शन",
    part_yoga_dosha: "भाग 3: योग एवं दोष",
    part_dasha: "भाग 4: दशा फल",
    part_remedies: "भाग 5: उपाय एवं मार्गदर्शन",
    part_technical: "भाग 6: तकनीकी तालिकाएँ",
    part_varshaphal: "भाग 7: वर्षफल (वार्षिक)",
    section_chart: "जन्म कुंडली सारांश",
    chart_lagna: "लग्न कुण्डली", chart_navamsa: "नवमांश कुण्डली",
    section_graha_sthiti: "ग्रह स्थिति",
    section_planets_analysis: "ग्रह विश्लेषण",
    section_houses: "भाव विश्लेषण",
    section_yogas: "कुंडली में योग",
    section_dashas: "विंशोत्तरी दशा — जीवन काल",
    section_remedies: "अनुशंसित उपाय",
    ascendant: "लग्न",
    nakshatra: "नक्षत्र",
    pada: "पाद",
    planet: "ग्रह",
    sign: "राशि",
    degree: "अंश",
    house: "भाव",
    lord: "स्वामी",
    current_dasha: "वर्तमान महादशा",
    upcoming_dashas: "आगामी महादशाएँ",
    years: "वर्ष",
    date_to: "से",
    yogas_none: "इस कुंडली में कोई प्रमुख योग नहीं पाया गया।",
    dashas_none: "इस कुंडली के लिए दशा गणना उपलब्ध नहीं है।",
    remedies_none: "वर्तमान में कोई विशेष उपाय आवश्यक नहीं।",
    house_no_content: "इस भाव की विस्तृत व्याख्या तैयार की जा रही है।",
    source: "स्रोत",
    // Phase 2 labels
    section_divisionals: "वर्ग कुंडलियाँ",
    divisionals_intro: "वर्ग कुंडलियाँ जीवन के विशिष्ट क्षेत्रों को गहराई से देखती हैं — हर एक अलग पक्ष का सूक्ष्म विश्लेषण देती है, जैसे धन, भाई-बहन, विवाह, करियर एवं आध्यात्मिक उन्नति।",
    section_doshas: "दोष विश्लेषण",
    section_predictions: "जीवन-क्षेत्र के अनुसार भविष्यवाणी",
    section_citations: "शास्त्रीय स्रोत एवं सन्दर्भ",
    divisional_lagna: "लग्न",
    dosha_mangal: "मंगल दोष",
    dosha_kaalsarp: "काल सर्प दोष",
    dosha_pitra: "पितृ दोष",
    dosha_severity_present: "उपस्थित",
    dosha_severity_cancelled: "निवारित",
    dosha_severity_mild: "अल्प",
    doshas_none_detected: "इस कुंडली में कोई प्रमुख दोष नहीं पाया गया।",
    area_career: "करियर एवं व्यवसाय",
    area_marriage: "विवाह एवं सम्बन्ध",
    area_wealth: "धन एवं अर्थ",
    area_health: "स्वास्थ्य एवं ओज",
    area_education: "शिक्षा एवं अधिगम",
    area_family: "परिवार एवं गृह",
    predictions_none: "इस कुंडली के लिए वैयक्तिक भविष्यवाणियाँ तैयार की जा रही हैं।",
    citations_none: "इस कुंडली के लिए अभी कोई शास्त्रीय सन्दर्भ उपलब्ध नहीं है।",
    citations_intro:
      "इस रिपोर्ट की प्रत्येक व्याख्या किसी न किसी शास्त्रीय ग्रन्थ पर आधारित है। नीचे उद्धृत स्रोतों की सूची दी गयी है:",
  },
  mr: {
    // --- Brihat deep-section labels (Marathi) ---
    section_avakahada: "अवकहडा चक्र (जन्म तपशील)",
    avk_paya: "पाया", avk_varna: "वर्ण", avk_vashya: "वश्य", avk_yoni: "योनी",
    avk_gana: "गण", avk_nadi: "नाडी", avk_tatva: "तत्व", avk_nak_lord: "नक्षत्र स्वामी",
    avk_rashi_lord: "राशी स्वामी", avk_lagna_lord: "लग्न स्वामी",
    section_panchang: "जन्म-कालीन पंचांग",
    panchang_intro: "तुमच्या जन्माच्या वेळचे पंचांग — तिथी, वार, नक्षत्र, योग व करण.",
    panchang_tithi: "तिथी", panchang_vara: "वार", panchang_nakshatra: "नक्षत्र",
    panchang_yoga: "योग", panchang_karana: "करण",
    section_gems: "रत्न शिफारस",
    gems_intro: "तुमच्या पत्रिकेतील सर्वाधिक शुभ भावांच्या (लग्न व त्रिकोण) स्वामींना बळ देणारे रत्न.",
    gems_kind: "प्रकार", gems_stone: "रत्न", gems_planet: "ग्रह", gems_reason: "आधार",
    gems_note: "रत्न योग्य ज्योतिषाचा सल्ला घेऊनच धारण करा; योग्य वजन, धातू व धारण करण्याचा दिवस महत्त्वाचा आहे.",
    section_ghata: "घात चक्र (अशुभ बिंदू)",
    ghata_intro: "घात चक्र तुमच्यासाठी अशुभ वार, तिथी, महिना व नक्षत्र दर्शवते.",
    ghata_weekday: "अशुभ वार", ghata_tithi: "तिथी", ghata_month: "महिना",
    ghata_nakshatra: "नक्षत्र", ghata_yoga: "योग", ghata_karana: "करण",
    ghata_prahar: "प्रहर", ghata_rashi: "घात राशी",
    section_chalit: "भाव चलित (कस्पल कुंडली)",
    chalit_intro: "चलित कुंडली ग्रहांना अचूक भाव-संधी (श्रीपती) नुसार ठेवते, ज्यामुळे राशी कुंडलीत लपलेले भाव-बदल उघड होतात.",
    chalit_house: "भाव", chalit_begin: "आरंभ", chalit_madhya: "मध्य",
    chalit_planets: "ग्रह भाव-बदल", chalit_rashi_house: "राशी भाव",
    chalit_bhava_house: "चलित भाव", chalit_shifted: "बदललेले",
    section_kp: "केपी पद्धती (कृष्णमूर्ती पद्धती)",
    kp_intro: "केपी नक्षत्र पद्धतीनुसार भाव-संधी उप-स्वामी व ग्रह कारक.",
    kp_star_lord: "नक्षत्र स्वामी", kp_sub_lord: "उप स्वामी", kp_subsub_lord: "उप-उप स्वामी",
    kp_significators: "ग्रह कारक", kp_signifies_houses: "कारक भाव",
    kp_ruling_planets: "शासक ग्रह", kp_rp_role: "भूमिका",
    kp_rp_lagna_nakshatra_lord: "लग्न नक्षत्र स्वामी", kp_rp_lagna_rashi_lord: "लग्न राशी स्वामी",
    kp_rp_moon_nakshatra_lord: "चंद्र नक्षत्र स्वामी", kp_rp_moon_rashi_lord: "चंद्र राशी स्वामी",
    kp_rp_day_lord: "वार स्वामी", kp_rp_lagna_sub_lord: "लग्न उप स्वामी", kp_rp_moon_sub_lord: "चंद्र उप स्वामी",
    section_jaimini: "जैमिनी पद्धती",
    jaimini_charakarakas: "चर कारक", jaimini_karaka: "कारक",
    jaimini_karakamsa: "कारकांश", jaimini_swamsa: "स्वांश", jaimini_arudha: "अरूढ पद",
    jaimini_pada: "पद",
    section_ishta: "इष्ट देवता",
    ishta_intro: "इष्ट देवता आध्यात्मिक उन्नतीसाठी वैयक्तिक देवता आहे, जी कारकांशापासून बाराव्या भावावरून ओळखली जाते.",
    ishta_deity: "देवता", ishta_12th_sign: "कारकांशापासून 12वी राशी", ishta_graha: "निर्धारक ग्रह",
    section_maitri: "मैत्री चक्र (ग्रह मैत्री)",
    maitri_intro: "ग्रहांमधील नैसर्गिक, तात्कालिक व पंचधा (संयुक्त) मैत्री संबंध.",
    maitri_naisargik: "नैसर्गिक", maitri_tatkalik: "तात्कालिक",
    maitri_panchadha: "पंचधा (संयुक्त)",
    section_avastha: "ग्रह अवस्था",
    avastha_intro: "बालादी, जाग्रदादी व दीप्तादी पद्धतीनुसार प्रत्येक ग्रहाच्या अवस्था.",
    avastha_baladi: "बालादी", avastha_jagradadi: "जाग्रदादी", avastha_deeptadi: "दीप्तादी",
    section_lalkitab: "लाल किताब विश्लेषण",
    lalkitab_intro: "लाल किताबचे भाव, पितृ ऋण व तेवा वर्गीकरण.",
    lalkitab_planets: "ग्रह स्थिती", lalkitab_rins: "पितृ ऋण",
    lalkitab_rin: "ऋण", lalkitab_status: "स्थिती",
    lk_present: "उपस्थित", lk_absent: "अनुपस्थित",
    section_shadbala: "षड्बल (सहा प्रकारचे बल)",
    shadbala_intro: "रूपांमध्ये एकूण षड्बल, सर्वात बलवान ते सर्वात कमकुवत ग्रहापर्यंत क्रमबद्ध.",
    shadbala_rupas: "रूप", shadbala_rank: "क्रम",
    section_bhavabala: "भाव बल (भाव की शक्ति)",
    bhavabala_intro: "बारह भावों में से प्रत्येक की शक्ति — भावेश बल, दिग्बल एवं दृष्टि बल।",
    bb_lord: "भावेश बल", bb_dig: "दिग्बल", bb_drsti: "दृष्टि बल", bb_total: "कुल",
    section_ashtakavarga: "अष्टकवर्ग",
    ashtakavarga_intro: "प्रत्येक राशीचे सर्वाष्टकवर्ग (SAV) शुभ-बिंदू एकूण, व ग्रह-निहाय भिन्नाष्टकवर्ग.",
    ashtakavarga_sav: "राशी", ashtakavarga_bindus: "बिंदू", ashtakavarga_total: "एकूण",
    ashtakavarga_prastar: "ग्रह-निहाय एकूण", ashtakavarga_planet_total: "एकूण बिंदू",
    section_varshaphal: "वर्षफल (वार्षिक कुंडली)",
    section_mudda: "मासिक भविष्यफल (मुद्दा दशा)",
    varshaphal_to: "ते",
    varshaphal_intro: "मुंथा, वर्षेश, सहम व पंचवर्गीय बलासह वार्षिक सौर-प्रत्यागमन विश्लेषण.",
    varshaphal_year: "वर्ष", varshaphal_muntha: "मुंथा", varshaphal_lord: "वर्षेश",
    varshaphal_sahams: "सहम (संवेदनशील बिंदू)", varshaphal_saham: "सहम",
    varshaphal_panchavargeeya: "पंचवर्गीय बल", varshaphal_vishwa: "विश्व",
    section_rajyoga: "राजयोग शक्ती व सुवर्ण काळ",
    rajyoga_strength: "राजयोग शक्ती", rajyoga_planets: "योगकारक ग्रह",
    rajyoga_swarnim: "सुवर्ण काळ", rajyoga_from: "पासून", rajyoga_to: "पर्यंत",
    title_brihad: "बृहद् कुंडली",
    subtitle_brihad: "विस्तृत वैदिक ज्योतिष विश्लेषण",
    born: "जन्म",
    at: "वेळ",
    in: "मध्ये",
    generated: "तयार",
    // Part dividers (level-1 bookmarks) for the Part 0–7 layout.
    part_foundations: "भाग 1: आधार",
    part_life_reading: "भाग 2: तुमचे जीवन-दर्शन",
    part_yoga_dosha: "भाग 3: योग व दोष",
    part_dasha: "भाग 4: दशा फल",
    part_remedies: "भाग 5: उपाय व मार्गदर्शन",
    part_technical: "भाग 6: तांत्रिक तक्ते",
    part_varshaphal: "भाग 7: वर्षफल (वार्षिक)",
    section_chart: "जन्म कुंडली सारांश",
    chart_lagna: "लग्न कुण्डली", chart_navamsa: "नवमांश कुण्डली",
    section_graha_sthiti: "ग्रह स्थिति",
    section_planets_analysis: "ग्रह विश्लेषण",
    section_houses: "स्थान विश्लेषण",
    section_yogas: "कुंडलीतील योग",
    section_dashas: "विंशोत्तरी दशा — जीवन काल",
    section_remedies: "शिफारस केलेले उपाय",
    ascendant: "लग्न",
    nakshatra: "नक्षत्र",
    pada: "चरण",
    planet: "ग्रह",
    sign: "राशी",
    degree: "अंश",
    house: "स्थान",
    lord: "अधिपती",
    current_dasha: "वर्तमान महादशा",
    upcoming_dashas: "आगामी महादशा",
    years: "वर्षे",
    date_to: "ते",
    yogas_none: "या कुंडलीत कोणतेही प्रमुख योग आढळले नाहीत.",
    dashas_none: "या कुंडलीसाठी दशा गणना उपलब्ध नाही.",
    remedies_none: "सध्या कोणतेही विशेष उपाय आवश्यक नाहीत.",
    house_no_content: "या स्थानाची विस्तृत व्याख्या तयार केली जात आहे.",
    source: "स्रोत",
    // Phase 2 labels
    section_divisionals: "वर्ग कुंडल्या",
    divisionals_intro: "वर्ग कुंडल्या जीवनाच्या विशिष्ट क्षेत्रांचा सखोल वेध घेतात — प्रत्येक वेगळ्या पैलूचे सूक्ष्म विश्लेषण देते, जसे धन, भावंडे, विवाह, करिअर व आध्यात्मिक उन्नती.",
    section_doshas: "दोष विश्लेषण",
    section_predictions: "जीवन-क्षेत्रानुसार भाकीत",
    section_citations: "शास्त्रीय स्रोत आणि संदर्भ",
    divisional_lagna: "लग्न",
    dosha_mangal: "मंगल दोष",
    dosha_kaalsarp: "काल सर्प दोष",
    dosha_pitra: "पितृ दोष",
    dosha_severity_present: "उपस्थित",
    dosha_severity_cancelled: "निवारित",
    dosha_severity_mild: "अल्प",
    doshas_none_detected: "या कुंडलीत कोणताही प्रमुख दोष आढळला नाही.",
    area_career: "करिअर आणि व्यवसाय",
    area_marriage: "विवाह आणि नाती",
    area_wealth: "धन आणि अर्थ",
    area_health: "आरोग्य आणि तेज",
    area_education: "शिक्षण आणि अध्ययन",
    area_family: "कुटुंब आणि घर",
    predictions_none: "या कुंडलीसाठी वैयक्तिक भाकिते तयार केली जात आहेत.",
    citations_none: "या कुंडलीसाठी सध्या कोणतेही शास्त्रीय संदर्भ उपलब्ध नाहीत.",
    citations_intro:
      "या अहवालातील प्रत्येक व्याख्या एखाद्या शास्त्रीय ग्रंथावर आधारित आहे. खाली उद्धृत स्रोतांची यादी दिली आहे:",
  },
  // te / ta / kn are written from the Hindi block above (owner rule: Hindi is
  // the source for regional languages). Planet/sign names in the data come
  // from the API; these are only the template's own words.
  te: {
    section_avakahada: "అవకహడ చక్రం (జన్మ వివరాలు)",
    avk_paya: "పాయ", avk_varna: "వర్ణం", avk_vashya: "వశ్యం", avk_yoni: "యోని",
    avk_gana: "గణం", avk_nadi: "నాడి", avk_tatva: "తత్త్వం", avk_nak_lord: "నక్షత్రాధిపతి",
    avk_rashi_lord: "రాశ్యధిపతి", avk_lagna_lord: "లగ్నాధిపతి",
    section_panchang: "జన్మ సమయ పంచాంగం",
    panchang_intro: "మీ జనన సమయంలోని పంచాంగం: తిథి, వారం, నక్షత్రం, యోగం మరియు కరణం.",
    panchang_tithi: "తిథి", panchang_vara: "వారం", panchang_nakshatra: "నక్షత్రం",
    panchang_yoga: "యోగం", panchang_karana: "కరణం",
    section_gems: "రత్న సూచన",
    gems_intro: "మీ జాతకంలో అత్యంత శుభ భావాల (లగ్నం మరియు త్రికోణాలు) అధిపతులకు బలాన్నిచ్చే రత్నాలు.",
    gems_kind: "రకం", gems_stone: "రత్నం", gems_planet: "గ్రహం", gems_reason: "ఆధారం",
    gems_note: "మీ జాతకాన్ని పూర్తిగా పరిశీలించిన తర్వాతే రత్నాన్ని ధరించండి; సరైన బరువు, లోహం మరియు ధరించే రోజు ముఖ్యం.",
    section_ghata: "ఘాత చక్రం (అశుభ అంశాలు)",
    ghata_intro: "ఘాత చక్రం మీకు అశుభమైన వారం, తిథి, మాసం మరియు నక్షత్రాన్ని సూచిస్తుంది.",
    ghata_weekday: "అశుభ వారం", ghata_tithi: "తిథి", ghata_month: "మాసం",
    ghata_nakshatra: "నక్షత్రం", ghata_yoga: "యోగం", ghata_karana: "కరణం",
    ghata_prahar: "జాము", ghata_rashi: "ఘాత రాశి",
    section_chalit: "భావ చలితం (భావ సంధి చక్రం)",
    chalit_intro: "చలిత చక్రం గ్రహాలను ఖచ్చితమైన భావ సంధుల (శ్రీపతి పద్ధతి) ప్రకారం ఉంచుతుంది, దీనివల్ల రాశి చక్రంలో కనిపించని భావ మార్పులు బయటపడతాయి.",
    chalit_house: "భావం", chalit_begin: "ప్రారంభం", chalit_madhya: "మధ్యం",
    chalit_planets: "గ్రహాల భావ మార్పులు", chalit_rashi_house: "రాశి భావం",
    chalit_bhava_house: "చలిత భావం", chalit_shifted: "మారింది",
    section_kp: "కేపీ పద్ధతి (కృష్ణమూర్తి పద్ధతి)",
    kp_intro: "కేపీ నక్షత్ర పద్ధతి ప్రకారం భావ సంధి ఉప అధిపతులు మరియు గ్రహ కారకాలు.",
    kp_star_lord: "నక్షత్రాధిపతి", kp_sub_lord: "ఉప అధిపతి", kp_subsub_lord: "ఉప ఉప అధిపతి",
    kp_significators: "గ్రహ కారకాలు", kp_signifies_houses: "సూచించే భావాలు",
    kp_ruling_planets: "పాలక గ్రహాలు", kp_rp_role: "పాత్ర",
    kp_rp_lagna_nakshatra_lord: "లగ్న నక్షత్రాధిపతి", kp_rp_lagna_rashi_lord: "లగ్న రాశ్యధిపతి",
    kp_rp_moon_nakshatra_lord: "చంద్ర నక్షత్రాధిపతి", kp_rp_moon_rashi_lord: "చంద్ర రాశ్యధిపతి",
    kp_rp_day_lord: "వారాధిపతి", kp_rp_lagna_sub_lord: "లగ్న ఉప అధిపతి", kp_rp_moon_sub_lord: "చంద్ర ఉప అధిపతి",
    section_jaimini: "జైమిని పద్ధతి",
    jaimini_charakarakas: "చర కారకాలు", jaimini_karaka: "కారకుడు",
    jaimini_karakamsa: "కారకాంశ", jaimini_swamsa: "స్వాంశ", jaimini_arudha: "ఆరూఢ పదాలు",
    jaimini_pada: "పదం",
    section_ishta: "ఇష్ట దేవత",
    ishta_intro: "ఇష్ట దేవత ఆధ్యాత్మిక పురోగతికి మీ వ్యక్తిగత దైవం; కారకాంశ నుండి పన్నెండవ భావం ద్వారా తెలుస్తుంది.",
    ishta_deity: "దేవత", ishta_12th_sign: "కారకాంశ నుండి 12వ రాశి", ishta_graha: "నిర్ణయించే గ్రహం",
    section_maitri: "మైత్రీ చక్రం (గ్రహ మైత్రి)",
    maitri_intro: "గ్రహాల మధ్య నైసర్గిక, తాత్కాలిక మరియు పంచధా (సంయుక్త) మైత్రీ సంబంధాలు.",
    maitri_naisargik: "నైసర్గిక (సహజ)", maitri_tatkalik: "తాత్కాలిక",
    maitri_panchadha: "పంచధా (సంయుక్త)",
    section_avastha: "గ్రహ అవస్థలు",
    avastha_intro: "బాలాది, జాగ్రదాది మరియు దీప్తాది పద్ధతుల ప్రకారం ప్రతి గ్రహపు అవస్థలు.",
    avastha_baladi: "బాలాది", avastha_jagradadi: "జాగ్రదాది", avastha_deeptadi: "దీప్తాది",
    section_lalkitab: "లాల్ కితాబ్ విశ్లేషణ",
    lalkitab_intro: "లాల్ కితాబ్ భావాలు, పితృ ఋణాలు మరియు తేవా వర్గీకరణ.",
    lalkitab_planets: "గ్రహ స్థితి", lalkitab_rins: "పితృ ఋణాలు",
    lalkitab_rin: "ఋణం", lalkitab_status: "స్థితి",
    lk_present: "ఉంది", lk_absent: "లేదు",
    section_shadbala: "షడ్బలం (ఆరు విధాల బలం)",
    shadbala_intro: "రూపాలలో మొత్తం షడ్బలం, అత్యంత బలమైన గ్రహం నుండి బలహీనమైన గ్రహం వరకు క్రమంలో.",
    shadbala_rupas: "రూపాలు", shadbala_rank: "క్రమం",
    section_bhavabala: "భావ బలం (భావాల శక్తి)",
    bhavabala_intro: "పన్నెండు భావాలలో ప్రతి దాని బలం: భావాధిపతి బలం, దిగ్బలం మరియు దృష్టి బలం.",
    bb_lord: "భావాధిపతి బలం", bb_dig: "దిగ్బలం", bb_drsti: "దృష్టి బలం", bb_total: "మొత్తం",
    section_ashtakavarga: "అష్టకవర్గ",
    ashtakavarga_intro: "ప్రతి రాశికి సర్వాష్టకవర్గ (SAV) శుభ బిందువుల మొత్తం, మరియు గ్రహాల వారీగా భిన్నాష్టకవర్గ.",
    ashtakavarga_sav: "రాశి", ashtakavarga_bindus: "బిందువులు", ashtakavarga_total: "మొత్తం",
    ashtakavarga_prastar: "గ్రహాల వారీ మొత్తం", ashtakavarga_planet_total: "మొత్తం బిందువులు",
    section_varshaphal: "వర్షఫలం (వార్షిక జాతకం)",
    section_mudda: "మాసవారీ ఫలితాలు (ముద్దా దశ)",
    varshaphal_to: "నుండి",
    varshaphal_intro: "ముంథా, వర్షాధిపతి, సహమలు మరియు పంచవర్గీయ బలంతో కూడిన వార్షిక సౌర పునరాగమన విశ్లేషణ.",
    varshaphal_year: "సంవత్సరం", varshaphal_muntha: "ముంథా", varshaphal_lord: "వర్షాధిపతి",
    varshaphal_sahams: "సహమలు (సున్నిత బిందువులు)", varshaphal_saham: "సహమం",
    varshaphal_panchavargeeya: "పంచవర్గీయ బలం", varshaphal_vishwa: "విశ్వ",
    section_rajyoga: "రాజయోగ బలం మరియు స్వర్ణ కాలాలు",
    rajyoga_strength: "రాజయోగ బలం", rajyoga_planets: "యోగకారక గ్రహాలు",
    rajyoga_swarnim: "స్వర్ణ కాలాలు", rajyoga_from: "నుండి", rajyoga_to: "వరకు",
    title_brihad: "బృహత్ జాతకం",
    subtitle_brihad: "సమగ్ర వైదిక జ్యోతిష విశ్లేషణ",
    born: "జననం",
    at: "సమయం",
    in: "స్థానం:",
    generated: "రూపొందించిన తేదీ",
    part_foundations: "భాగం 1: పునాదులు",
    part_life_reading: "భాగం 2: మీ జీవన ఫలితాలు",
    part_yoga_dosha: "భాగం 3: యోగాలు మరియు దోషాలు",
    part_dasha: "భాగం 4: దశా ఫలితాలు",
    part_remedies: "భాగం 5: పరిహారాలు మరియు మార్గదర్శనం",
    part_technical: "భాగం 6: సాంకేతిక పట్టికలు",
    part_varshaphal: "భాగం 7: వర్షఫలం (వార్షిక)",
    section_chart: "జన్మ జాతక సారాంశం",
    chart_lagna: "లగ్న చక్రం", chart_navamsa: "నవాంశ చక్రం",
    section_graha_sthiti: "గ్రహ స్థితి",
    section_planets_analysis: "గ్రహ విశ్లేషణ",
    section_houses: "భావ విశ్లేషణ",
    section_yogas: "జాతకంలోని యోగాలు",
    section_dashas: "వింశోత్తరి దశ: జీవన కాలాలు",
    section_remedies: "సూచించిన పరిహారాలు",
    ascendant: "లగ్నం",
    nakshatra: "నక్షత్రం",
    pada: "పాదం",
    planet: "గ్రహం",
    sign: "రాశి",
    degree: "భాగలు",
    house: "భావం",
    lord: "అధిపతి",
    current_dasha: "ప్రస్తుత మహాదశ",
    upcoming_dashas: "రాబోయే మహాదశలు",
    years: "సంవత్సరాలు",
    date_to: "నుండి",
    yogas_none: "ఈ జాతకంలో ప్రధాన యోగాలు ఏవీ కనిపించలేదు.",
    dashas_none: "ఈ జాతకానికి దశా గణన అందుబాటులో లేదు.",
    remedies_none: "ప్రస్తుతం ప్రత్యేక పరిహారాలు అవసరం లేదు.",
    house_no_content: "ఈ భావానికి వివరమైన వ్యాఖ్యానం సిద్ధమవుతోంది.",
    source: "ఆధారం",
    section_divisionals: "వర్గ చక్రాలు",
    divisionals_intro: "వర్గ చక్రాలు జీవితంలోని ప్రత్యేక రంగాలను లోతుగా చూపిస్తాయి; ప్రతి చక్రం ఒక్కో అంశాన్ని సూక్ష్మంగా విశ్లేషిస్తుంది, ఉదాహరణకు ధనం, తోబుట్టువులు, వివాహం, వృత్తి మరియు ఆధ్యాత్మిక పురోగతి.",
    section_doshas: "దోష విశ్లేషణ",
    section_predictions: "జీవిత రంగాల వారీగా ఫలితాలు",
    section_citations: "శాస్త్రీయ ఆధారాలు మరియు ప్రమాణాలు",
    divisional_lagna: "లగ్నం",
    dosha_mangal: "కుజ దోషం",
    dosha_kaalsarp: "కాలసర్ప దోషం",
    dosha_pitra: "పితృ దోషం",
    dosha_severity_present: "ఉంది",
    dosha_severity_cancelled: "నివారితం",
    dosha_severity_mild: "స్వల్పం",
    doshas_none_detected: "ఈ జాతకంలో ప్రధాన దోషాలు ఏవీ కనిపించలేదు.",
    area_career: "వృత్తి మరియు వ్యాపారం",
    area_marriage: "వివాహం మరియు సంబంధాలు",
    area_wealth: "ధనం మరియు ఆర్థికం",
    area_health: "ఆరోగ్యం మరియు తేజస్సు",
    area_education: "విద్య మరియు అభ్యాసం",
    area_family: "కుటుంబం మరియు ఇల్లు",
    predictions_none: "ఈ జాతకానికి వ్యక్తిగత ఫలితాలు సిద్ధమవుతున్నాయి.",
    citations_none: "ఈ జాతకానికి ప్రస్తుతం శాస్త్రీయ ఆధారాలు అందుబాటులో లేవు.",
    citations_intro:
      "ఈ నివేదికలోని ప్రతి వ్యాఖ్యానం ఏదో ఒక శాస్త్రీయ గ్రంథంపై ఆధారపడి ఉంది. ఉదహరించిన ఆధారాల జాబితా కింద ఇవ్వబడింది:",
  },
  ta: {
    section_avakahada: "அவகஹடா சக்கரம் (ஜனன விவரம்)",
    avk_paya: "பாயா", avk_varna: "வர்ணம்", avk_vashya: "வசியம்", avk_yoni: "யோனி",
    avk_gana: "கணம்", avk_nadi: "நாடி", avk_tatva: "தத்துவம்", avk_nak_lord: "நட்சத்திர அதிபதி",
    avk_rashi_lord: "ராசி அதிபதி", avk_lagna_lord: "லக்ன அதிபதி",
    section_panchang: "ஜனன கால பஞ்சாங்கம்",
    panchang_intro: "நீங்கள் பிறந்த நேரத்தின் பஞ்சாங்கம்: திதி, வாரம், நட்சத்திரம், யோகம், கரணம்.",
    panchang_tithi: "திதி", panchang_vara: "வாரம்", panchang_nakshatra: "நட்சத்திரம்",
    panchang_yoga: "யோகம்", panchang_karana: "கரணம்",
    section_gems: "ரத்தின பரிந்துரை",
    gems_intro: "உங்கள் ஜாதகத்தின் மிகச் சுபமான வீடுகளின் (லக்னம், திரிகோணங்கள்) அதிபதிகளுக்கு பலம் தரும் ரத்தினங்கள்.",
    gems_kind: "வகை", gems_stone: "ரத்தினம்", gems_planet: "கிரகம்", gems_reason: "அடிப்படை",
    gems_note: "உங்கள் ஜாதகத்தை முழுமையாகச் சரிபார்த்த பிறகே ரத்தினம் அணியுங்கள்; சரியான எடை, உலோகம், அணியும் நாள் ஆகியவை முக்கியம்.",
    section_ghata: "காத சக்கரம் (அசுப அம்சங்கள்)",
    ghata_intro: "காத சக்கரம் உங்களுக்கு அசுபமான வாரம், திதி, மாதம், நட்சத்திரம் ஆகியவற்றைக் காட்டுகிறது.",
    ghata_weekday: "அசுப வாரம்", ghata_tithi: "திதி", ghata_month: "மாதம்",
    ghata_nakshatra: "நட்சத்திரம்", ghata_yoga: "யோகம்", ghata_karana: "கரணம்",
    ghata_prahar: "ஜாமம்", ghata_rashi: "காத ராசி",
    // House is வீடு, never பாவம் (பாவம் also means "sin"), so "Bhava Chalit"
    // and "Bhava Bala" are named by the house word too.
    section_chalit: "சலித சக்கரம் (வீட்டு சந்திகள்)",
    chalit_intro: "சலித சக்கரம் கிரகங்களைத் துல்லியமான வீட்டு சந்திகளின் (ஸ்ரீபதி முறை) படி வைக்கிறது; இதனால் ராசி சக்கரத்தில் தெரியாத வீட்டு மாற்றங்கள் வெளிப்படுகின்றன.",
    chalit_house: "வீடு", chalit_begin: "தொடக்கம்", chalit_madhya: "மத்தியம்",
    chalit_planets: "கிரகங்களின் வீட்டு மாற்றம்", chalit_rashi_house: "ராசி வீடு",
    chalit_bhava_house: "சலித வீடு", chalit_shifted: "மாறியது",
    section_kp: "கேபி முறை (கிருஷ்ணமூர்த்தி பத்ததி)",
    kp_intro: "கேபி நட்சத்திர முறைப்படி வீட்டு சந்தி உப அதிபதிகளும் கிரக காரகங்களும்.",
    kp_star_lord: "நட்சத்திர அதிபதி", kp_sub_lord: "உப அதிபதி", kp_subsub_lord: "உப உப அதிபதி",
    kp_significators: "கிரக காரகங்கள்", kp_signifies_houses: "குறிக்கும் வீடுகள்",
    kp_ruling_planets: "ஆளும் கிரகங்கள்", kp_rp_role: "பங்கு",
    kp_rp_lagna_nakshatra_lord: "லக்ன நட்சத்திர அதிபதி", kp_rp_lagna_rashi_lord: "லக்ன ராசி அதிபதி",
    kp_rp_moon_nakshatra_lord: "சந்திர நட்சத்திர அதிபதி", kp_rp_moon_rashi_lord: "சந்திர ராசி அதிபதி",
    kp_rp_day_lord: "கிழமை அதிபதி", kp_rp_lagna_sub_lord: "லக்ன உப அதிபதி", kp_rp_moon_sub_lord: "சந்திர உப அதிபதி",
    section_jaimini: "ஜைமினி முறை",
    jaimini_charakarakas: "சர காரகங்கள்", jaimini_karaka: "காரகம்",
    jaimini_karakamsa: "காரகாம்சம்", jaimini_swamsa: "ஸ்வாம்சம்", jaimini_arudha: "ஆரூட பதங்கள்",
    jaimini_pada: "பதம்",
    section_ishta: "இஷ்ட தெய்வம்",
    ishta_intro: "இஷ்ட தெய்வம் ஆன்மிக முன்னேற்றத்துக்கான உங்கள் தனிப்பட்ட தெய்வம்; காரகாம்சத்திலிருந்து பன்னிரண்டாம் வீட்டைக் கொண்டு அறியப்படுகிறது.",
    ishta_deity: "தெய்வம்", ishta_12th_sign: "காரகாம்சத்திலிருந்து 12-ஆம் ராசி", ishta_graha: "நிர்ணயிக்கும் கிரகம்",
    section_maitri: "மைத்திரி சக்கரம் (கிரக நட்பு)",
    maitri_intro: "கிரகங்களுக்கு இடையிலான இயற்கை, தற்காலிக, பஞ்சதா (கூட்டு) நட்பு உறவுகள்.",
    maitri_naisargik: "நைசர்கிக (இயற்கை)", maitri_tatkalik: "தாத்காலிக (தற்காலிக)",
    maitri_panchadha: "பஞ்சதா (கூட்டு)",
    section_avastha: "கிரக அவஸ்தைகள்",
    avastha_intro: "பாலாதி, ஜாக்ரதாதி, தீப்தாதி முறைகளின்படி ஒவ்வொரு கிரகத்தின் அவஸ்தைகள்.",
    avastha_baladi: "பாலாதி", avastha_jagradadi: "ஜாக்ரதாதி", avastha_deeptadi: "தீப்தாதி",
    section_lalkitab: "லால் கிதாப் பகுப்பாய்வு",
    lalkitab_intro: "லால் கிதாப் வீடுகள், பித்ரு கடன்கள், தேவா வகைப்பாடு.",
    lalkitab_planets: "கிரக நிலை", lalkitab_rins: "பித்ரு கடன்கள் (ரிணம்)",
    lalkitab_rin: "கடன்", lalkitab_status: "நிலை",
    lk_present: "உள்ளது", lk_absent: "இல்லை",
    section_shadbala: "ஷட்பலம் (ஆறு வகை பலம்)",
    shadbala_intro: "ரூபங்களில் மொத்த ஷட்பலம், வலுவான கிரகத்திலிருந்து வலுக்குறைந்த கிரகம் வரை வரிசைப்படுத்தப்பட்டது.",
    shadbala_rupas: "ரூபம்", shadbala_rank: "வரிசை",
    section_bhavabala: "வீட்டு பலம்",
    bhavabala_intro: "பன்னிரண்டு வீடுகள் ஒவ்வொன்றின் பலம்: வீட்டு அதிபதி பலம், திக் பலம், திருஷ்டி பலம்.",
    bb_lord: "அதிபதி பலம்", bb_dig: "திக் பலம்", bb_drsti: "திருஷ்டி பலம்", bb_total: "மொத்தம்",
    section_ashtakavarga: "அஷ்டகவர்க்கம்",
    ashtakavarga_intro: "ஒவ்வொரு ராசிக்கும் சர்வாஷ்டகவர்க்க (SAV) சுப பிந்துக்களின் கூட்டுத்தொகை, கிரக வாரியான பின்னாஷ்டகவர்க்கம்.",
    ashtakavarga_sav: "ராசி", ashtakavarga_bindus: "பிந்துக்கள்", ashtakavarga_total: "மொத்தம்",
    ashtakavarga_prastar: "கிரக வாரியான மொத்தம்", ashtakavarga_planet_total: "மொத்த பிந்துக்கள்",
    section_varshaphal: "வருஷ பலன் (ஆண்டு ஜாதகம்)",
    section_mudda: "மாதாந்திர பலன் (முத்தா திசை)",
    varshaphal_to: "முதல்",
    varshaphal_intro: "முந்தா, வருஷ அதிபதி, சகமங்கள், பஞ்சவர்கீய பலம் ஆகியவற்றுடன் ஆண்டு சூரிய மீள்வருகை பகுப்பாய்வு.",
    varshaphal_year: "ஆண்டு", varshaphal_muntha: "முந்தா", varshaphal_lord: "வருஷ அதிபதி",
    varshaphal_sahams: "சகமங்கள் (நுட்பமான புள்ளிகள்)", varshaphal_saham: "சகமம்",
    varshaphal_panchavargeeya: "பஞ்சவர்கீய பலம்", varshaphal_vishwa: "விஸ்வ",
    section_rajyoga: "ராஜயோக பலமும் பொற்காலங்களும்",
    rajyoga_strength: "ராஜயோக பலம்", rajyoga_planets: "யோககாரக கிரகங்கள்",
    rajyoga_swarnim: "பொற்காலங்கள்", rajyoga_from: "முதல்", rajyoga_to: "வரை",
    title_brihad: "பிருஹத் ஜாதகம்",
    subtitle_brihad: "விரிவான வேத ஜோதிட பகுப்பாய்வு",
    born: "பிறப்பு",
    at: "நேரம்",
    in: "நிலை:",
    generated: "தயாரித்த நாள்",
    part_foundations: "பகுதி 1: அடிப்படைகள்",
    part_life_reading: "பகுதி 2: உங்கள் வாழ்க்கைப் பலன்",
    part_yoga_dosha: "பகுதி 3: யோகங்களும் தோஷங்களும்",
    part_dasha: "பகுதி 4: திசா பலன்",
    part_remedies: "பகுதி 5: பரிகாரங்களும் வழிகாட்டலும்",
    part_technical: "பகுதி 6: தொழில்நுட்ப அட்டவணைகள்",
    part_varshaphal: "பகுதி 7: வருஷ பலன் (ஆண்டு)",
    section_chart: "ஜனன ஜாதகச் சுருக்கம்",
    chart_lagna: "லக்ன சக்கரம்", chart_navamsa: "நவாம்ச சக்கரம்",
    section_graha_sthiti: "கிரக நிலை",
    section_planets_analysis: "கிரக பகுப்பாய்வு",
    section_houses: "வீடுகளின் பகுப்பாய்வு",
    section_yogas: "ஜாதகத்தில் உள்ள யோகங்கள்",
    section_dashas: "விம்சோத்தரி திசை: வாழ்க்கைக் காலங்கள்",
    section_remedies: "பரிந்துரைக்கப்பட்ட பரிகாரங்கள்",
    ascendant: "லக்னம்",
    nakshatra: "நட்சத்திரம்",
    pada: "பாதம்",
    planet: "கிரகம்",
    sign: "ராசி",
    degree: "பாகை",
    house: "வீடு",
    lord: "அதிபதி",
    current_dasha: "நடப்பு திசை",
    upcoming_dashas: "வரவிருக்கும் திசைகள்",
    years: "ஆண்டுகள்",
    date_to: "முதல்",
    yogas_none: "இந்த ஜாதகத்தில் முக்கிய யோகங்கள் எதுவும் காணப்படவில்லை.",
    dashas_none: "இந்த ஜாதகத்துக்கு திசை கணிப்பு கிடைக்கவில்லை.",
    remedies_none: "தற்போது சிறப்புப் பரிகாரம் எதுவும் தேவையில்லை.",
    house_no_content: "இந்த வீட்டுக்கான விரிவான விளக்கம் தயாராகிறது.",
    source: "ஆதாரம்",
    section_divisionals: "வர்க்க சக்கரங்கள்",
    divisionals_intro: "வர்க்க சக்கரங்கள் வாழ்க்கையின் குறிப்பிட்ட துறைகளை ஆழமாகக் காட்டுகின்றன; ஒவ்வொன்றும் ஒரு பக்கத்தை நுட்பமாக விளக்குகிறது: செல்வம், உடன்பிறந்தோர், திருமணம், தொழில், ஆன்மிக முன்னேற்றம் போன்றவை.",
    section_doshas: "தோஷ பகுப்பாய்வு",
    section_predictions: "வாழ்க்கைத் துறை வாரியான பலன்கள்",
    section_citations: "சாஸ்திர ஆதாரங்களும் மேற்கோள்களும்",
    divisional_lagna: "லக்னம்",
    dosha_mangal: "செவ்வாய் தோஷம்",
    dosha_kaalsarp: "கால சர்ப்ப தோஷம்",
    dosha_pitra: "பித்ரு தோஷம்",
    dosha_severity_present: "உள்ளது",
    dosha_severity_cancelled: "நிவர்த்தி",
    dosha_severity_mild: "லேசானது",
    doshas_none_detected: "இந்த ஜாதகத்தில் முக்கிய தோஷம் எதுவும் காணப்படவில்லை.",
    area_career: "தொழிலும் வணிகமும்",
    area_marriage: "திருமணமும் உறவுகளும்",
    area_wealth: "செல்வமும் பொருளாதாரமும்",
    area_health: "உடல்நலமும் தேஜஸும்",
    area_education: "கல்வியும் கற்றலும்",
    area_family: "குடும்பமும் இல்லமும்",
    predictions_none: "இந்த ஜாதகத்துக்கான தனிப்பட்ட பலன்கள் தயாராகின்றன.",
    citations_none: "இந்த ஜாதகத்துக்கு இப்போது சாஸ்திர மேற்கோள்கள் எதுவும் கிடைக்கவில்லை.",
    citations_intro:
      "இந்த அறிக்கையின் ஒவ்வொரு விளக்கமும் ஏதேனும் ஒரு சாஸ்திர நூலை அடிப்படையாகக் கொண்டது. மேற்கோள் காட்டப்பட்ட ஆதாரங்களின் பட்டியல் கீழே:",
  },
  kn: {
    section_avakahada: "ಅವಕಹಡಾ ಚಕ್ರ (ಜನ್ಮ ವಿವರ)",
    avk_paya: "ಪಾಯ", avk_varna: "ವರ್ಣ", avk_vashya: "ವಶ್ಯ", avk_yoni: "ಯೋನಿ",
    avk_gana: "ಗಣ", avk_nadi: "ನಾಡಿ", avk_tatva: "ತತ್ವ", avk_nak_lord: "ನಕ್ಷತ್ರಾಧಿಪತಿ",
    avk_rashi_lord: "ರಾಶ್ಯಧಿಪತಿ", avk_lagna_lord: "ಲಗ್ನಾಧಿಪತಿ",
    section_panchang: "ಜನನ ಕಾಲದ ಪಂಚಾಂಗ",
    panchang_intro: "ನಿಮ್ಮ ಜನನ ಸಮಯದ ಪಂಚಾಂಗ: ತಿಥಿ, ವಾರ, ನಕ್ಷತ್ರ, ಯೋಗ ಮತ್ತು ಕರಣ.",
    panchang_tithi: "ತಿಥಿ", panchang_vara: "ವಾರ", panchang_nakshatra: "ನಕ್ಷತ್ರ",
    panchang_yoga: "ಯೋಗ", panchang_karana: "ಕರಣ",
    section_gems: "ರತ್ನ ಶಿಫಾರಸು",
    gems_intro: "ನಿಮ್ಮ ಜಾತಕದ ಅತ್ಯಂತ ಶುಭ ಭಾವಗಳ (ಲಗ್ನ ಮತ್ತು ತ್ರಿಕೋಣಗಳು) ಅಧಿಪತಿಗಳಿಗೆ ಬಲ ನೀಡುವ ರತ್ನಗಳು.",
    gems_kind: "ಪ್ರಕಾರ", gems_stone: "ರತ್ನ", gems_planet: "ಗ್ರಹ", gems_reason: "ಆಧಾರ",
    gems_note: "ನಿಮ್ಮ ಜಾತಕವನ್ನು ಸಂಪೂರ್ಣವಾಗಿ ಪರಿಶೀಲಿಸಿದ ನಂತರವೇ ರತ್ನವನ್ನು ಧರಿಸಿ; ಸರಿಯಾದ ತೂಕ, ಲೋಹ ಮತ್ತು ಧರಿಸುವ ದಿನ ಮುಖ್ಯ.",
    section_ghata: "ಘಾತ ಚಕ್ರ (ಅಶುಭ ಅಂಶಗಳು)",
    ghata_intro: "ಘಾತ ಚಕ್ರ ನಿಮಗೆ ಅಶುಭವಾದ ವಾರ, ತಿಥಿ, ಮಾಸ ಮತ್ತು ನಕ್ಷತ್ರವನ್ನು ತೋರಿಸುತ್ತದೆ.",
    ghata_weekday: "ಅಶುಭ ವಾರ", ghata_tithi: "ತಿಥಿ", ghata_month: "ಮಾಸ",
    ghata_nakshatra: "ನಕ್ಷತ್ರ", ghata_yoga: "ಯೋಗ", ghata_karana: "ಕರಣ",
    ghata_prahar: "ಪ್ರಹರ", ghata_rashi: "ಘಾತ ರಾಶಿ",
    section_chalit: "ಭಾವ ಚಲಿತ (ಭಾವ ಸಂಧಿ ಚಕ್ರ)",
    chalit_intro: "ಚಲಿತ ಚಕ್ರ ಗ್ರಹಗಳನ್ನು ನಿಖರವಾದ ಭಾವ ಸಂಧಿಗಳ (ಶ್ರೀಪತಿ ಪದ್ಧತಿ) ಪ್ರಕಾರ ಇರಿಸುತ್ತದೆ; ಇದರಿಂದ ರಾಶಿ ಚಕ್ರದಲ್ಲಿ ಕಾಣದ ಭಾವ ಬದಲಾವಣೆಗಳು ಹೊರಬರುತ್ತವೆ.",
    chalit_house: "ಭಾವ", chalit_begin: "ಆರಂಭ", chalit_madhya: "ಮಧ್ಯ",
    chalit_planets: "ಗ್ರಹಗಳ ಭಾವ ಬದಲಾವಣೆ", chalit_rashi_house: "ರಾಶಿ ಭಾವ",
    chalit_bhava_house: "ಚಲಿತ ಭಾವ", chalit_shifted: "ಬದಲಾಗಿದೆ",
    section_kp: "ಕೆಪಿ ಪದ್ಧತಿ (ಕೃಷ್ಣಮೂರ್ತಿ ಪದ್ಧತಿ)",
    kp_intro: "ಕೆಪಿ ನಕ್ಷತ್ರ ಪದ್ಧತಿಯ ಪ್ರಕಾರ ಭಾವ ಸಂಧಿ ಉಪ ಅಧಿಪತಿಗಳು ಮತ್ತು ಗ್ರಹ ಕಾರಕಗಳು.",
    kp_star_lord: "ನಕ್ಷತ್ರಾಧಿಪತಿ", kp_sub_lord: "ಉಪ ಅಧಿಪತಿ", kp_subsub_lord: "ಉಪ ಉಪ ಅಧಿಪತಿ",
    kp_significators: "ಗ್ರಹ ಕಾರಕಗಳು", kp_signifies_houses: "ಸೂಚಿಸುವ ಭಾವಗಳು",
    kp_ruling_planets: "ಆಳುವ ಗ್ರಹಗಳು", kp_rp_role: "ಪಾತ್ರ",
    kp_rp_lagna_nakshatra_lord: "ಲಗ್ನ ನಕ್ಷತ್ರಾಧಿಪತಿ", kp_rp_lagna_rashi_lord: "ಲಗ್ನ ರಾಶ್ಯಧಿಪತಿ",
    kp_rp_moon_nakshatra_lord: "ಚಂದ್ರ ನಕ್ಷತ್ರಾಧಿಪತಿ", kp_rp_moon_rashi_lord: "ಚಂದ್ರ ರಾಶ್ಯಧಿಪತಿ",
    kp_rp_day_lord: "ವಾರಾಧಿಪತಿ", kp_rp_lagna_sub_lord: "ಲಗ್ನ ಉಪ ಅಧಿಪತಿ", kp_rp_moon_sub_lord: "ಚಂದ್ರ ಉಪ ಅಧಿಪತಿ",
    section_jaimini: "ಜೈಮಿನಿ ಪದ್ಧತಿ",
    jaimini_charakarakas: "ಚರ ಕಾರಕಗಳು", jaimini_karaka: "ಕಾರಕ",
    jaimini_karakamsa: "ಕಾರಕಾಂಶ", jaimini_swamsa: "ಸ್ವಾಂಶ", jaimini_arudha: "ಆರೂಢ ಪದಗಳು",
    jaimini_pada: "ಪದ",
    section_ishta: "ಇಷ್ಟ ದೇವತೆ",
    ishta_intro: "ಇಷ್ಟ ದೇವತೆ ಆಧ್ಯಾತ್ಮಿಕ ಪ್ರಗತಿಗಾಗಿ ನಿಮ್ಮ ವೈಯಕ್ತಿಕ ದೇವರು; ಕಾರಕಾಂಶದಿಂದ ಹನ್ನೆರಡನೇ ಭಾವದ ಮೂಲಕ ತಿಳಿಯುತ್ತದೆ.",
    ishta_deity: "ದೇವತೆ", ishta_12th_sign: "ಕಾರಕಾಂಶದಿಂದ 12ನೇ ರಾಶಿ", ishta_graha: "ನಿರ್ಧರಿಸುವ ಗ್ರಹ",
    section_maitri: "ಮೈತ್ರಿ ಚಕ್ರ (ಗ್ರಹ ಮೈತ್ರಿ)",
    maitri_intro: "ಗ್ರಹಗಳ ನಡುವಿನ ನೈಸರ್ಗಿಕ, ತಾತ್ಕಾಲಿಕ ಮತ್ತು ಪಂಚಧಾ (ಸಂಯುಕ್ತ) ಮೈತ್ರಿ ಸಂಬಂಧಗಳು.",
    maitri_naisargik: "ನೈಸರ್ಗಿಕ (ಸಹಜ)", maitri_tatkalik: "ತಾತ್ಕಾಲಿಕ",
    maitri_panchadha: "ಪಂಚಧಾ (ಸಂಯುಕ್ತ)",
    section_avastha: "ಗ್ರಹ ಅವಸ್ಥೆಗಳು",
    avastha_intro: "ಬಾಲಾದಿ, ಜಾಗ್ರದಾದಿ ಮತ್ತು ದೀಪ್ತಾದಿ ಪದ್ಧತಿಗಳ ಪ್ರಕಾರ ಪ್ರತಿಯೊಂದು ಗ್ರಹದ ಅವಸ್ಥೆಗಳು.",
    avastha_baladi: "ಬಾಲಾದಿ", avastha_jagradadi: "ಜಾಗ್ರದಾದಿ", avastha_deeptadi: "ದೀಪ್ತಾದಿ",
    section_lalkitab: "ಲಾಲ್ ಕಿತಾಬ್ ವಿಶ್ಲೇಷಣೆ",
    lalkitab_intro: "ಲಾಲ್ ಕಿತಾಬ್ ಭಾವಗಳು, ಪಿತೃ ಋಣಗಳು ಮತ್ತು ತೇವಾ ವರ್ಗೀಕರಣ.",
    lalkitab_planets: "ಗ್ರಹ ಸ್ಥಿತಿ", lalkitab_rins: "ಪಿತೃ ಋಣಗಳು",
    lalkitab_rin: "ಋಣ", lalkitab_status: "ಸ್ಥಿತಿ",
    lk_present: "ಇದೆ", lk_absent: "ಇಲ್ಲ",
    section_shadbala: "ಷಡ್ಬಲ (ಆರು ಬಗೆಯ ಬಲ)",
    shadbala_intro: "ರೂಪಗಳಲ್ಲಿ ಒಟ್ಟು ಷಡ್ಬಲ, ಅತ್ಯಂತ ಬಲಿಷ್ಠ ಗ್ರಹದಿಂದ ಅತ್ಯಂತ ದುರ್ಬಲ ಗ್ರಹದವರೆಗೆ ಕ್ರಮವಾಗಿ.",
    shadbala_rupas: "ರೂಪ", shadbala_rank: "ಕ್ರಮ",
    section_bhavabala: "ಭಾವ ಬಲ (ಭಾವಗಳ ಶಕ್ತಿ)",
    bhavabala_intro: "ಹನ್ನೆರಡು ಭಾವಗಳಲ್ಲಿ ಪ್ರತಿಯೊಂದರ ಬಲ: ಭಾವಾಧಿಪತಿ ಬಲ, ದಿಗ್ಬಲ ಮತ್ತು ದೃಷ್ಟಿ ಬಲ.",
    bb_lord: "ಭಾವಾಧಿಪತಿ ಬಲ", bb_dig: "ದಿಗ್ಬಲ", bb_drsti: "ದೃಷ್ಟಿ ಬಲ", bb_total: "ಒಟ್ಟು",
    section_ashtakavarga: "ಅಷ್ಟಕವರ್ಗ",
    ashtakavarga_intro: "ಪ್ರತಿ ರಾಶಿಯ ಸರ್ವಾಷ್ಟಕವರ್ಗ (SAV) ಶುಭ ಬಿಂದುಗಳ ಒಟ್ಟು, ಮತ್ತು ಗ್ರಹವಾರು ಭಿನ್ನಾಷ್ಟಕವರ್ಗ.",
    ashtakavarga_sav: "ರಾಶಿ", ashtakavarga_bindus: "ಬಿಂದುಗಳು", ashtakavarga_total: "ಒಟ್ಟು",
    ashtakavarga_prastar: "ಗ್ರಹವಾರು ಒಟ್ಟು", ashtakavarga_planet_total: "ಒಟ್ಟು ಬಿಂದುಗಳು",
    section_varshaphal: "ವರ್ಷಫಲ (ವಾರ್ಷಿಕ ಜಾತಕ)",
    section_mudda: "ಮಾಸಿಕ ಫಲ (ಮುದ್ದಾ ದಶೆ)",
    varshaphal_to: "ರಿಂದ",
    varshaphal_intro: "ಮುಂಥಾ, ವರ್ಷಾಧಿಪತಿ, ಸಹಮಗಳು ಮತ್ತು ಪಂಚವರ್ಗೀಯ ಬಲದೊಂದಿಗೆ ವಾರ್ಷಿಕ ಸೌರ ಪುನರಾಗಮನ ವಿಶ್ಲೇಷಣೆ.",
    varshaphal_year: "ವರ್ಷ", varshaphal_muntha: "ಮುಂಥಾ", varshaphal_lord: "ವರ್ಷಾಧಿಪತಿ",
    varshaphal_sahams: "ಸಹಮಗಳು (ಸೂಕ್ಷ್ಮ ಬಿಂದುಗಳು)", varshaphal_saham: "ಸಹಮ",
    varshaphal_panchavargeeya: "ಪಂಚವರ್ಗೀಯ ಬಲ", varshaphal_vishwa: "ವಿಶ್ವ",
    section_rajyoga: "ರಾಜಯೋಗ ಬಲ ಮತ್ತು ಸುವರ್ಣ ಕಾಲ",
    rajyoga_strength: "ರಾಜಯೋಗ ಬಲ", rajyoga_planets: "ಯೋಗಕಾರಕ ಗ್ರಹಗಳು",
    rajyoga_swarnim: "ಸುವರ್ಣ ಕಾಲ", rajyoga_from: "ರಿಂದ", rajyoga_to: "ವರೆಗೆ",
    title_brihad: "ಬೃಹತ್ ಜಾತಕ",
    subtitle_brihad: "ಸಮಗ್ರ ವೈದಿಕ ಜ್ಯೋತಿಷ ವಿಶ್ಲೇಷಣೆ",
    born: "ಜನನ",
    at: "ಸಮಯ",
    in: "ಸ್ಥಿತಿ:",
    generated: "ತಯಾರಿಸಿದ ದಿನಾಂಕ",
    part_foundations: "ಭಾಗ 1: ಅಡಿಪಾಯ",
    part_life_reading: "ಭಾಗ 2: ನಿಮ್ಮ ಜೀವನ ಫಲ",
    part_yoga_dosha: "ಭಾಗ 3: ಯೋಗಗಳು ಮತ್ತು ದೋಷಗಳು",
    part_dasha: "ಭಾಗ 4: ದಶಾ ಫಲ",
    part_remedies: "ಭಾಗ 5: ಪರಿಹಾರಗಳು ಮತ್ತು ಮಾರ್ಗದರ್ಶನ",
    part_technical: "ಭಾಗ 6: ತಾಂತ್ರಿಕ ಕೋಷ್ಟಕಗಳು",
    part_varshaphal: "ಭಾಗ 7: ವರ್ಷಫಲ (ವಾರ್ಷಿಕ)",
    section_chart: "ಜನ್ಮ ಜಾತಕ ಸಾರಾಂಶ",
    chart_lagna: "ಲಗ್ನ ಕುಂಡಲಿ", chart_navamsa: "ನವಾಂಶ ಕುಂಡಲಿ",
    section_graha_sthiti: "ಗ್ರಹ ಸ್ಥಿತಿ",
    section_planets_analysis: "ಗ್ರಹ ವಿಶ್ಲೇಷಣೆ",
    section_houses: "ಭಾವ ವಿಶ್ಲೇಷಣೆ",
    section_yogas: "ಜಾತಕದಲ್ಲಿನ ಯೋಗಗಳು",
    section_dashas: "ವಿಂಶೋತ್ತರಿ ದಶೆ: ಜೀವನ ಕಾಲಗಳು",
    section_remedies: "ಶಿಫಾರಸು ಮಾಡಿದ ಪರಿಹಾರಗಳು",
    ascendant: "ಲಗ್ನ",
    nakshatra: "ನಕ್ಷತ್ರ",
    pada: "ಪಾದ",
    planet: "ಗ್ರಹ",
    sign: "ರಾಶಿ",
    degree: "ಅಂಶ",
    house: "ಭಾವ",
    lord: "ಅಧಿಪತಿ",
    current_dasha: "ಪ್ರಸ್ತುತ ಮಹಾದಶೆ",
    upcoming_dashas: "ಮುಂಬರುವ ಮಹಾದಶೆಗಳು",
    years: "ವರ್ಷಗಳು",
    date_to: "ರಿಂದ",
    yogas_none: "ಈ ಜಾತಕದಲ್ಲಿ ಯಾವುದೇ ಪ್ರಮುಖ ಯೋಗ ಕಂಡುಬಂದಿಲ್ಲ.",
    dashas_none: "ಈ ಜಾತಕಕ್ಕೆ ದಶಾ ಗಣನೆ ಲಭ್ಯವಿಲ್ಲ.",
    remedies_none: "ಈಗ ಯಾವುದೇ ವಿಶೇಷ ಪರಿಹಾರದ ಅಗತ್ಯವಿಲ್ಲ.",
    house_no_content: "ಈ ಭಾವದ ವಿವರವಾದ ವ್ಯಾಖ್ಯಾನ ಸಿದ್ಧವಾಗುತ್ತಿದೆ.",
    source: "ಆಧಾರ",
    section_divisionals: "ವರ್ಗ ಚಕ್ರಗಳು",
    divisionals_intro: "ವರ್ಗ ಚಕ್ರಗಳು ಜೀವನದ ನಿರ್ದಿಷ್ಟ ಕ್ಷೇತ್ರಗಳನ್ನು ಆಳವಾಗಿ ತೋರಿಸುತ್ತವೆ; ಪ್ರತಿಯೊಂದೂ ಒಂದು ಅಂಶದ ಸೂಕ್ಷ್ಮ ವಿಶ್ಲೇಷಣೆ ನೀಡುತ್ತದೆ, ಉದಾಹರಣೆಗೆ ಧನ, ಸಹೋದರರು, ವಿವಾಹ, ವೃತ್ತಿ ಮತ್ತು ಆಧ್ಯಾತ್ಮಿಕ ಪ್ರಗತಿ.",
    section_doshas: "ದೋಷ ವಿಶ್ಲೇಷಣೆ",
    section_predictions: "ಜೀವನ ಕ್ಷೇತ್ರವಾರು ಫಲಗಳು",
    section_citations: "ಶಾಸ್ತ್ರೀಯ ಆಧಾರಗಳು ಮತ್ತು ಉಲ್ಲೇಖಗಳು",
    divisional_lagna: "ಲಗ್ನ",
    dosha_mangal: "ಮಂಗಳ ದೋಷ",
    dosha_kaalsarp: "ಕಾಲಸರ್ಪ ದೋಷ",
    dosha_pitra: "ಪಿತೃ ದೋಷ",
    dosha_severity_present: "ಇದೆ",
    dosha_severity_cancelled: "ನಿವಾರಣೆಯಾಗಿದೆ",
    dosha_severity_mild: "ಅಲ್ಪ",
    doshas_none_detected: "ಈ ಜಾತಕದಲ್ಲಿ ಯಾವುದೇ ಪ್ರಮುಖ ದೋಷ ಕಂಡುಬಂದಿಲ್ಲ.",
    area_career: "ವೃತ್ತಿ ಮತ್ತು ವ್ಯವಹಾರ",
    area_marriage: "ವಿವಾಹ ಮತ್ತು ಸಂಬಂಧಗಳು",
    area_wealth: "ಧನ ಮತ್ತು ಆರ್ಥಿಕ ಸ್ಥಿತಿ",
    area_health: "ಆರೋಗ್ಯ ಮತ್ತು ಚೈತನ್ಯ",
    area_education: "ವಿದ್ಯೆ ಮತ್ತು ಕಲಿಕೆ",
    area_family: "ಕುಟುಂಬ ಮತ್ತು ಮನೆ",
    predictions_none: "ಈ ಜಾತಕಕ್ಕೆ ವೈಯಕ್ತಿಕ ಫಲಗಳು ಸಿದ್ಧವಾಗುತ್ತಿವೆ.",
    citations_none: "ಈ ಜಾತಕಕ್ಕೆ ಸದ್ಯ ಯಾವುದೇ ಶಾಸ್ತ್ರೀಯ ಉಲ್ಲೇಖ ಲಭ್ಯವಿಲ್ಲ.",
    citations_intro:
      "ಈ ವರದಿಯ ಪ್ರತಿಯೊಂದು ವ್ಯಾಖ್ಯಾನವೂ ಯಾವುದಾದರೂ ಒಂದು ಶಾಸ್ತ್ರೀಯ ಗ್ರಂಥವನ್ನು ಆಧರಿಸಿದೆ. ಉಲ್ಲೇಖಿಸಿದ ಆಧಾರಗಳ ಪಟ್ಟಿ ಕೆಳಗಿದೆ:",
  },
  // ml is written from the Hindi (house ഭാവം, Mangal Dosha ചൊവ്വാദോഷം). The
  // Hindi "consult an astrologer" gem note becomes "check your chart fully".
  ml: {
    section_avakahada: "അവകഹഡ ചക്രം (ജനന വിവരങ്ങൾ)",
    avk_paya: "പായ", avk_varna: "വർണം", avk_vashya: "വശ്യം", avk_yoni: "യോനി",
    avk_gana: "ഗണം", avk_nadi: "നാഡി", avk_tatva: "തത്ത്വം", avk_nak_lord: "നക്ഷത്രാധിപൻ",
    avk_rashi_lord: "രാശ്യാധിപൻ", avk_lagna_lord: "ലഗ്നാധിപൻ",
    section_panchang: "ജനനസമയത്തെ പഞ്ചാംഗം",
    panchang_intro: "നിങ്ങളുടെ ജനനസമയത്തെ പഞ്ചാംഗം: തിഥി, വാരം, നക്ഷത്രം, യോഗം, കരണം.",
    panchang_tithi: "തിഥി", panchang_vara: "വാരം", panchang_nakshatra: "നക്ഷത്രം",
    panchang_yoga: "യോഗം", panchang_karana: "കരണം",
    section_gems: "രത്ന നിർദ്ദേശം",
    gems_intro: "നിങ്ങളുടെ ജാതകത്തിലെ ഏറ്റവും ശുഭമായ ഭാവങ്ങളുടെ (ലഗ്നവും ത്രികോണങ്ങളും) അധിപന്മാർക്ക് ബലം നൽകുന്ന രത്നങ്ങൾ.",
    gems_kind: "തരം", gems_stone: "രത്നം", gems_planet: "ഗ്രഹം", gems_reason: "അടിസ്ഥാനം",
    gems_note: "നിങ്ങളുടെ ജാതകം പൂർണമായി പരിശോധിച്ച ശേഷം മാത്രം രത്നം ധരിക്കുക; ശരിയായ തൂക്കം, ലോഹം, ധരിക്കുന്ന ദിവസം എന്നിവ പ്രധാനമാണ്.",
    section_ghata: "ഘാത ചക്രം (അശുഭ ഘടകങ്ങൾ)",
    ghata_intro: "ഘാത ചക്രം നിങ്ങൾക്ക് അശുഭമായ വാരം, തിഥി, മാസം, നക്ഷത്രം എന്നിവ കാണിക്കുന്നു.",
    ghata_weekday: "അശുഭ വാരം", ghata_tithi: "തിഥി", ghata_month: "മാസം",
    ghata_nakshatra: "നക്ഷത്രം", ghata_yoga: "യോഗം", ghata_karana: "കരണം",
    ghata_prahar: "യാമം", ghata_rashi: "ഘാത രാശി",
    section_chalit: "ഭാവ ചലിതം (ഭാവസന്ധി ചക്രം)",
    chalit_intro: "ചലിത ചക്രം ഗ്രഹങ്ങളെ കൃത്യമായ ഭാവസന്ധികൾ (ശ്രീപതി പദ്ധതി) അനുസരിച്ച് സ്ഥാപിക്കുന്നു; ഇതിലൂടെ രാശിചക്രത്തിൽ കാണാത്ത ഭാവമാറ്റങ്ങൾ വ്യക്തമാകുന്നു.",
    chalit_house: "ഭാവം", chalit_begin: "ആരംഭം", chalit_madhya: "മധ്യം",
    chalit_planets: "ഗ്രഹങ്ങളുടെ ഭാവമാറ്റം", chalit_rashi_house: "രാശി ഭാവം",
    chalit_bhava_house: "ചലിത ഭാവം", chalit_shifted: "മാറിയത്",
    section_kp: "കെപി പദ്ധതി (കൃഷ്ണമൂർത്തി പദ്ധതി)",
    kp_intro: "കെപി നക്ഷത്ര പദ്ധതി പ്രകാരമുള്ള ഭാവസന്ധി ഉപാധിപന്മാരും ഗ്രഹകാരകങ്ങളും.",
    kp_star_lord: "നക്ഷത്രാധിപൻ", kp_sub_lord: "ഉപാധിപൻ", kp_subsub_lord: "ഉപ-ഉപാധിപൻ",
    kp_significators: "ഗ്രഹകാരകങ്ങൾ", kp_signifies_houses: "സൂചിപ്പിക്കുന്ന ഭാവങ്ങൾ",
    kp_ruling_planets: "ഭരിക്കുന്ന ഗ്രഹങ്ങൾ", kp_rp_role: "പങ്ക്",
    kp_rp_lagna_nakshatra_lord: "ലഗ്ന നക്ഷത്രാധിപൻ", kp_rp_lagna_rashi_lord: "ലഗ്ന രാശ്യാധിപൻ",
    kp_rp_moon_nakshatra_lord: "ചന്ദ്ര നക്ഷത്രാധിപൻ", kp_rp_moon_rashi_lord: "ചന്ദ്ര രാശ്യാധിപൻ",
    kp_rp_day_lord: "വാരാധിപൻ", kp_rp_lagna_sub_lord: "ലഗ്ന ഉപാധിപൻ", kp_rp_moon_sub_lord: "ചന്ദ്ര ഉപാധിപൻ",
    section_jaimini: "ജൈമിനി പദ്ധതി",
    jaimini_charakarakas: "ചരകാരകങ്ങൾ", jaimini_karaka: "കാരകൻ",
    jaimini_karakamsa: "കാരകാംശം", jaimini_swamsa: "സ്വാംശം", jaimini_arudha: "ആരൂഢ പദങ്ങൾ",
    jaimini_pada: "പദം",
    section_ishta: "ഇഷ്ടദേവത",
    ishta_intro: "ആത്മീയ ഉന്നതിക്കായുള്ള നിങ്ങളുടെ വ്യക്തിപരമായ ദേവതയാണ് ഇഷ്ടദേവത; കാരകാംശത്തിൽ നിന്ന് പന്ത്രണ്ടാം ഭാവത്തിലൂടെ ഇത് അറിയാം.",
    ishta_deity: "ദേവത", ishta_12th_sign: "കാരകാംശത്തിൽ നിന്ന് 12-ാം രാശി", ishta_graha: "നിർണയിക്കുന്ന ഗ്രഹം",
    section_maitri: "മൈത്രി ചക്രം (ഗ്രഹമൈത്രി)",
    maitri_intro: "ഗ്രഹങ്ങൾ തമ്മിലുള്ള നൈസർഗിക, താൽക്കാലിക, പഞ്ചധാ (സംയുക്ത) മൈത്രീബന്ധങ്ങൾ.",
    maitri_naisargik: "നൈസർഗികം (സ്വാഭാവികം)", maitri_tatkalik: "താൽക്കാലികം",
    maitri_panchadha: "പഞ്ചധാ (സംയുക്തം)",
    section_avastha: "ഗ്രഹാവസ്ഥകൾ",
    avastha_intro: "ബാലാദി, ജാഗ്രദാദി, ദീപ്താദി പദ്ധതികൾ പ്രകാരം ഓരോ ഗ്രഹത്തിന്റെയും അവസ്ഥകൾ.",
    avastha_baladi: "ബാലാദി", avastha_jagradadi: "ജാഗ്രദാദി", avastha_deeptadi: "ദീപ്താദി",
    section_lalkitab: "ലാൽ കിതാബ് വിശകലനം",
    lalkitab_intro: "ലാൽ കിതാബ് ഭാവങ്ങൾ, പിതൃ ഋണങ്ങൾ, തേവ വർഗീകരണം.",
    lalkitab_planets: "ഗ്രഹസ്ഥിതി", lalkitab_rins: "പിതൃ ഋണങ്ങൾ",
    lalkitab_rin: "ഋണം", lalkitab_status: "സ്ഥിതി",
    lk_present: "ഉണ്ട്", lk_absent: "ഇല്ല",
    section_shadbala: "ഷഡ്ബലം (ആറുതരം ബലം)",
    shadbala_intro: "രൂപത്തിലുള്ള ആകെ ഷഡ്ബലം, ഏറ്റവും ബലമുള്ള ഗ്രഹം മുതൽ ഏറ്റവും കുറഞ്ഞതു വരെ ക്രമത്തിൽ.",
    shadbala_rupas: "രൂപ", shadbala_rank: "ക്രമം",
    section_bhavabala: "ഭാവബലം (ഭാവങ്ങളുടെ ശക്തി)",
    bhavabala_intro: "പന്ത്രണ്ടു ഭാവങ്ങളിൽ ഓരോന്നിന്റെയും ശക്തി: ഭാവാധിപ ബലം, ദിഗ്ബലം, ദൃഷ്ടിബലം.",
    bb_lord: "ഭാവാധിപ ബലം", bb_dig: "ദിഗ്ബലം", bb_drsti: "ദൃഷ്ടിബലം", bb_total: "ആകെ",
    section_ashtakavarga: "അഷ്ടകവർഗം",
    ashtakavarga_intro: "ഓരോ രാശിയുടെയും സർവാഷ്ടകവർഗ (SAV) ശുഭബിന്ദുക്കളുടെ ആകെത്തുകയും ഗ്രഹം തിരിച്ചുള്ള ഭിന്നാഷ്ടകവർഗവും.",
    ashtakavarga_sav: "രാശി", ashtakavarga_bindus: "ബിന്ദുക്കൾ", ashtakavarga_total: "ആകെ",
    ashtakavarga_prastar: "ഗ്രഹം തിരിച്ചുള്ള ആകെ", ashtakavarga_planet_total: "ആകെ ബിന്ദുക്കൾ",
    section_varshaphal: "വർഷഫലം (വാർഷിക ജാതകം)",
    section_mudda: "മാസഫലം (മുദ്ദ ദശ)",
    varshaphal_to: "മുതൽ",
    varshaphal_intro: "മുന്ഥ, വർഷാധിപൻ, സഹമങ്ങൾ, പഞ്ചവർഗീയ ബലം എന്നിവ ഉൾപ്പെടുന്ന വാർഷിക സൗര പുനരാഗമന വിശകലനം.",
    varshaphal_year: "വർഷം", varshaphal_muntha: "മുന്ഥ", varshaphal_lord: "വർഷാധിപൻ",
    varshaphal_sahams: "സഹമങ്ങൾ (സൂക്ഷ്മ ബിന്ദുക്കൾ)", varshaphal_saham: "സഹമം",
    varshaphal_panchavargeeya: "പഞ്ചവർഗീയ ബലം", varshaphal_vishwa: "വിശ്വ",
    section_rajyoga: "രാജയോഗ ബലവും സുവർണ കാലവും",
    rajyoga_strength: "രാജയോഗ ബലം", rajyoga_planets: "യോഗകാരക ഗ്രഹങ്ങൾ",
    rajyoga_swarnim: "സുവർണ കാലം", rajyoga_from: "ആരംഭം", rajyoga_to: "അവസാനം",
    title_brihad: "ബൃഹത് ജാതകം",
    subtitle_brihad: "സമഗ്ര വൈദിക ജ്യോതിഷ വിശകലനം",
    born: "ജനനം",
    at: "സമയം",
    in: "സ്ഥിതി:",
    generated: "തയ്യാറാക്കിയ തീയതി",
    part_foundations: "ഭാഗം 1: അടിസ്ഥാനം",
    part_life_reading: "ഭാഗം 2: നിങ്ങളുടെ ജീവിതഫലം",
    part_yoga_dosha: "ഭാഗം 3: യോഗങ്ങളും ദോഷങ്ങളും",
    part_dasha: "ഭാഗം 4: ദശാഫലം",
    part_remedies: "ഭാഗം 5: പരിഹാരങ്ങളും മാർഗനിർദ്ദേശവും",
    part_technical: "ഭാഗം 6: സാങ്കേതിക പട്ടികകൾ",
    part_varshaphal: "ഭാഗം 7: വർഷഫലം (വാർഷികം)",
    section_chart: "ജന്മജാതക സംഗ്രഹം",
    chart_lagna: "ലഗ്ന ചക്രം", chart_navamsa: "നവാംശ ചക്രം",
    section_graha_sthiti: "ഗ്രഹസ്ഥിതി",
    section_planets_analysis: "ഗ്രഹ വിശകലനം",
    section_houses: "ഭാവ വിശകലനം",
    section_yogas: "ജാതകത്തിലെ യോഗങ്ങൾ",
    section_dashas: "വിംശോത്തരി ദശ: ജീവിതകാലങ്ങൾ",
    section_remedies: "നിർദ്ദേശിക്കുന്ന പരിഹാരങ്ങൾ",
    ascendant: "ലഗ്നം",
    nakshatra: "നക്ഷത്രം",
    pada: "പാദം",
    planet: "ഗ്രഹം",
    sign: "രാശി",
    degree: "ഡിഗ്രി",
    house: "ഭാവം",
    lord: "അധിപൻ",
    current_dasha: "നിലവിലെ മഹാദശ",
    upcoming_dashas: "വരാനിരിക്കുന്ന മഹാദശകൾ",
    years: "വർഷം",
    date_to: "മുതൽ",
    yogas_none: "ഈ ജാതകത്തിൽ പ്രധാന യോഗങ്ങളൊന്നും കണ്ടെത്തിയില്ല.",
    dashas_none: "ഈ ജാതകത്തിന് ദശാഗണനം ലഭ്യമല്ല.",
    remedies_none: "ഇപ്പോൾ പ്രത്യേക പരിഹാരങ്ങളൊന്നും ആവശ്യമില്ല.",
    house_no_content: "ഈ ഭാവത്തിന്റെ വിശദമായ വ്യാഖ്യാനം തയ്യാറായിക്കൊണ്ടിരിക്കുന്നു.",
    source: "ആധാരം",
    section_divisionals: "വർഗ ചക്രങ്ങൾ",
    divisionals_intro: "വർഗ ചക്രങ്ങൾ ജീവിതത്തിലെ പ്രത്യേക മേഖലകളെ ആഴത്തിൽ കാണിക്കുന്നു; ധനം, സഹോദരങ്ങൾ, വിവാഹം, തൊഴിൽ, ആത്മീയ ഉന്നതി തുടങ്ങി ഓരോന്നും ഓരോ വശത്തിന്റെ സൂക്ഷ്മ വിശകലനം നൽകുന്നു.",
    section_doshas: "ദോഷ വിശകലനം",
    section_predictions: "ജീവിതമേഖല തിരിച്ചുള്ള ഫലങ്ങൾ",
    section_citations: "ശാസ്ത്രീയ ആധാരങ്ങളും പരാമർശങ്ങളും",
    divisional_lagna: "ലഗ്നം",
    dosha_mangal: "ചൊവ്വാദോഷം",
    dosha_kaalsarp: "കാലസർപ്പദോഷം",
    dosha_pitra: "പിതൃദോഷം",
    dosha_severity_present: "ഉണ്ട്",
    dosha_severity_cancelled: "പരിഹൃതം",
    dosha_severity_mild: "നേരിയത്",
    doshas_none_detected: "ഈ ജാതകത്തിൽ പ്രധാന ദോഷങ്ങളൊന്നും കണ്ടെത്തിയില്ല.",
    area_career: "തൊഴിലും വ്യാപാരവും",
    area_marriage: "വിവാഹവും ബന്ധങ്ങളും",
    area_wealth: "ധനവും സാമ്പത്തിക സ്ഥിതിയും",
    area_health: "ആരോഗ്യവും ഓജസ്സും",
    area_education: "വിദ്യാഭ്യാസവും പഠനവും",
    area_family: "കുടുംബവും വീടും",
    predictions_none: "ഈ ജാതകത്തിനുള്ള വ്യക്തിഗത ഫലങ്ങൾ തയ്യാറായിക്കൊണ്ടിരിക്കുന്നു.",
    citations_none: "ഈ ജാതകത്തിന് ഇപ്പോൾ ശാസ്ത്രീയ പരാമർശങ്ങളൊന്നും ലഭ്യമല്ല.",
    citations_intro:
      "ഈ റിപ്പോർട്ടിലെ ഓരോ വ്യാഖ്യാനവും ഏതെങ്കിലും ഒരു ശാസ്ത്രീയ ഗ്രന്ഥത്തെ ആധാരമാക്കിയുള്ളതാണ്. പരാമർശിച്ച ആധാരങ്ങളുടെ പട്ടിക താഴെ:",
  },
};

/** House number 1..12 → primary significations (ported from houseTopics). */
const HOUSE_TOPICS: Record<string, Record<number, string>> = {
  en: {
    1: "Self, Lagna, Personality",
    2: "Wealth, Family, Speech",
    3: "Siblings, Courage, Communication",
    4: "Mother, Home, Comforts",
    5: "Children, Education, Creativity",
    6: "Enemies, Health, Service",
    7: "Marriage, Partnership, Business",
    8: "Longevity, Hidden, Transformation",
    9: "Father, Fortune, Dharma",
    10: "Career, Status, Action",
    11: "Gains, Friends, Aspirations",
    12: "Loss, Liberation, Foreign",
  },
  hi: {
    1: "आत्म, लग्न, व्यक्तित्व",
    2: "धन, कुटुम्ब, वाणी",
    3: "सहोदर, साहस, संचार",
    4: "माता, गृह, सुख",
    5: "सन्तान, शिक्षा, सृजन",
    6: "शत्रु, स्वास्थ्य, सेवा",
    7: "विवाह, साझेदारी, व्यवसाय",
    8: "आयु, गुप्त, परिवर्तन",
    9: "पिता, भाग्य, धर्म",
    10: "कर्म, पद, कार्य",
    11: "लाभ, मित्र, आकांक्षा",
    12: "व्यय, मोक्ष, विदेश",
  },
  mr: {
    1: "स्व, लग्न, व्यक्तिमत्त्व",
    2: "धन, कुटुंब, वाणी",
    3: "भावंडे, धैर्य, संवाद",
    4: "माता, घर, सुख",
    5: "संतान, शिक्षण, सर्जनशीलता",
    6: "शत्रू, आरोग्य, सेवा",
    7: "विवाह, भागीदारी, व्यवसाय",
    8: "आयुष्य, गुप्त, परिवर्तन",
    9: "पिता, भाग्य, धर्म",
    10: "कर्म, पद, कार्य",
    11: "लाभ, मित्र, आकांक्षा",
    12: "व्यय, मोक्ष, परदेश",
  },
  te: {
    1: "స్వభావం, లగ్నం, వ్యక్తిత్వం",
    2: "ధనం, కుటుంబం, వాక్కు",
    3: "తోబుట్టువులు, ధైర్యం, సంభాషణ",
    4: "తల్లి, ఇల్లు, సుఖం",
    5: "సంతానం, విద్య, సృజన",
    6: "శత్రువులు, ఆరోగ్యం, సేవ",
    7: "వివాహం, భాగస్వామ్యం, వ్యాపారం",
    8: "ఆయుష్షు, రహస్యం, పరివర్తన",
    9: "తండ్రి, భాగ్యం, ధర్మం",
    10: "కర్మ, పదవి, కార్యం",
    11: "లాభం, మిత్రులు, ఆకాంక్షలు",
    12: "వ్యయం, మోక్షం, విదేశం",
  },
  ta: {
    1: "சுயம், லக்னம், ஆளுமை",
    2: "செல்வம், குடும்பம், வாக்கு",
    3: "உடன்பிறந்தோர், தைரியம், தொடர்பு",
    4: "தாய், இல்லம், சுகம்",
    5: "குழந்தைகள், கல்வி, படைப்பாற்றல்",
    6: "எதிரிகள், உடல்நலம், சேவை",
    7: "திருமணம், கூட்டாண்மை, வணிகம்",
    8: "ஆயுள், மறைபொருள், மாற்றம்",
    9: "தந்தை, பாக்கியம், தர்மம்",
    10: "கர்மம், பதவி, செயல்",
    11: "லாபம், நண்பர்கள், ஆசைகள்",
    12: "விரயம், மோட்சம், வெளிநாடு",
  },
  kn: {
    1: "ಸ್ವಭಾವ, ಲಗ್ನ, ವ್ಯಕ್ತಿತ್ವ",
    2: "ಧನ, ಕುಟುಂಬ, ವಾಕ್",
    3: "ಸಹೋದರರು, ಧೈರ್ಯ, ಸಂವಹನ",
    4: "ತಾಯಿ, ಮನೆ, ಸುಖ",
    5: "ಸಂತಾನ, ವಿದ್ಯೆ, ಸೃಜನಶೀಲತೆ",
    6: "ಶತ್ರುಗಳು, ಆರೋಗ್ಯ, ಸೇವೆ",
    7: "ವಿವಾಹ, ಪಾಲುದಾರಿಕೆ, ವ್ಯವಹಾರ",
    8: "ಆಯುಷ್ಯ, ರಹಸ್ಯ, ಪರಿವರ್ತನೆ",
    9: "ತಂದೆ, ಭಾಗ್ಯ, ಧರ್ಮ",
    10: "ಕರ್ಮ, ಸ್ಥಾನಮಾನ, ಕಾರ್ಯ",
    11: "ಲಾಭ, ಸ್ನೇಹಿತರು, ಆಕಾಂಕ್ಷೆಗಳು",
    12: "ವ್ಯಯ, ಮೋಕ್ಷ, ವಿದೇಶ",
  },
  ml: {
    1: "സ്വഭാവം, ലഗ്നം, വ്യക്തിത്വം",
    2: "ധനം, കുടുംബം, വാക്ക്",
    3: "സഹോദരങ്ങൾ, ധൈര്യം, ആശയവിനിമയം",
    4: "മാതാവ്, വീട്, സുഖം",
    5: "സന്താനം, വിദ്യ, സർഗാത്മകത",
    6: "ശത്രുക്കൾ, ആരോഗ്യം, സേവനം",
    7: "വിവാഹം, പങ്കാളിത്തം, വ്യാപാരം",
    8: "ആയുസ്സ്, രഹസ്യം, പരിവർത്തനം",
    9: "പിതാവ്, ഭാഗ്യം, ധർമം",
    10: "കർമം, പദവി, പ്രവൃത്തി",
    11: "ലാഭം, സുഹൃത്തുക്കൾ, ആഗ്രഹങ്ങൾ",
    12: "വ്യയം, മോക്ഷം, വിദേശം",
  },
};

/** Remedy category → localized label (ported from remedyCategoryLabels). */
const REMEDY_CATEGORY_LABELS: Record<string, Record<string, string>> = {
  en: { mantra: "Mantra", donation: "Donation", fast: "Fast", gemstone: "Gemstone", yantra: "Yantra" },
  hi: { mantra: "मंत्र", donation: "दान", fast: "व्रत", gemstone: "रत्न", yantra: "यंत्र" },
  mr: { mantra: "मंत्र", donation: "दान", fast: "उपवास", gemstone: "रत्न", yantra: "यंत्र" },
  te: { mantra: "మంత్రం", donation: "దానం", fast: "వ్రతం", gemstone: "రత్నం", yantra: "యంత్రం" },
  ta: { mantra: "மந்திரம்", donation: "தானம்", fast: "விரதம்", gemstone: "ரத்தினம்", yantra: "யந்திரம்" },
  kn: { mantra: "ಮಂತ್ರ", donation: "ದಾನ", fast: "ವ್ರತ", gemstone: "ರತ್ನ", yantra: "ಯಂತ್ರ" },
  ml: { mantra: "മന്ത്രം", donation: "ദാനം", fast: "വ്രതം", gemstone: "രത്നം", yantra: "യന്ത്രം" },
};

/** Per-planet generic summary (ported from planetSummaries). */
const PLANET_SUMMARIES: Record<string, Record<string, string>> = {
  en: {
    Sun: "Soul, vitality, authority, father — represents the core self and life force.",
    Moon: "Mind, emotion, mother, the public — governs mental wellbeing and intuition.",
    Mars: "Energy, courage, action, siblings — drives initiative and physical strength.",
    Mercury: "Intellect, speech, learning, communication — shapes analytical capacity.",
    Jupiter: "Wisdom, fortune, dharma, teachers — expansive, benevolent, growth-bringing.",
    Venus: "Love, beauty, comforts, partnership — governs aesthetics and relationships.",
    Saturn: "Discipline, longevity, karma, hardship — slow, structured, enduring lessons.",
    Rahu: "Worldly desire, foreign, ambition — amplifies and obscures simultaneously.",
    Ketu: "Detachment, spirituality, past karma — dissolves attachment, brings insight.",
  },
  hi: {
    Sun: "आत्मा, ओज, अधिकार, पिता — आत्म और प्राण-शक्ति का प्रतिनिधित्व।",
    Moon: "मन, भाव, माता, जनता — मानसिक कल्याण एवं अंतर्ज्ञान का अधिपति।",
    Mars: "ऊर्जा, साहस, कर्म, सहोदर — पहल एवं शारीरिक बल को संचालित करता है।",
    Mercury: "बुद्धि, वाणी, अधिगम, संचार — विश्लेषणात्मक क्षमता को आकार देता है।",
    Jupiter: "ज्ञान, भाग्य, धर्म, गुरु — विस्तार, परोपकार, समृद्धि का स्रोत।",
    Venus: "प्रेम, सौन्दर्य, सुख, साझेदारी — सौंदर्यबोध एवं सम्बन्धों का अधिपति।",
    Saturn: "अनुशासन, आयु, कर्म, कठिनाई — धीमे, संरचित, स्थायी पाठ।",
    Rahu: "सांसारिक इच्छा, विदेश, महत्वाकांक्षा — साथ-साथ बढ़ाता एवं छिपाता है।",
    Ketu: "वैराग्य, अध्यात्म, पूर्व कर्म — आसक्ति को विसर्जित करता है, अंतर्दृष्टि देता है।",
  },
  mr: {
    Sun: "आत्मा, तेज, अधिकार, पिता — आत्म आणि प्राणशक्तीचे प्रतिनिधित्व.",
    Moon: "मन, भावना, माता, जनता — मानसिक स्वास्थ्य आणि अंतर्ज्ञानाचा अधिपती.",
    Mars: "ऊर्जा, धैर्य, कर्म, भावंडे — पुढाकार आणि शारीरिक बळ चालवतो.",
    Mercury: "बुद्धी, वाणी, शिक्षण, संवाद — विश्लेषणात्मक क्षमता घडवतो.",
    Jupiter: "ज्ञान, भाग्य, धर्म, गुरू — विस्तार, परोपकार, समृद्धीचा स्त्रोत.",
    Venus: "प्रेम, सौंदर्य, सुख, भागीदारी — सौंदर्यबोध आणि नात्यांचा अधिपती.",
    Saturn: "शिस्त, आयुष्य, कर्म, कष्ट — हळू, संरचित, स्थायी धडे.",
    Rahu: "सांसारिक इच्छा, परदेश, महत्त्वाकांक्षा — एकाच वेळी वाढवतो आणि लपवतो.",
    Ketu: "वैराग्य, अध्यात्म, पूर्व कर्म — आसक्ती विरघळवतो, अंतर्दृष्टी देतो.",
  },
  te: {
    Sun: "ఆత్మ, తేజస్సు, అధికారం, తండ్రి. మీ అంతరంగ స్వభావాన్ని, ప్రాణశక్తిని సూచిస్తాడు.",
    Moon: "మనస్సు, భావాలు, తల్లి, ప్రజలు. మానసిక శ్రేయస్సుకు, అంతర్దృష్టికి అధిపతి.",
    Mars: "శక్తి, ధైర్యం, కర్మ, తోబుట్టువులు. చొరవను, శారీరక బలాన్ని నడిపిస్తాడు.",
    Mercury: "బుద్ధి, వాక్కు, అభ్యాసం, సంభాషణ. విశ్లేషణ సామర్థ్యాన్ని తీర్చిదిద్దుతాడు.",
    Jupiter: "జ్ఞానం, భాగ్యం, ధర్మం, గురుజనులు. విస్తరణ, పరోపకారం, సమృద్ధికి మూలం.",
    Venus: "ప్రేమ, సౌందర్యం, సుఖం, భాగస్వామ్యం. సౌందర్య దృష్టికి, సంబంధాలకు అధిపతి.",
    Saturn: "క్రమశిక్షణ, ఆయుష్షు, కర్మ, కష్టం. నెమ్మదిగా, క్రమంగా, శాశ్వతంగా నిలిచే పాఠాలు నేర్పుతాడు.",
    Rahu: "ప్రాపంచిక కోరికలు, విదేశం, ఆకాంక్ష. ఒకేసారి పెంచుతాడు, మరుగుపరుస్తాడు.",
    Ketu: "వైరాగ్యం, ఆధ్యాత్మికత, పూర్వ కర్మ. ఆసక్తిని కరిగిస్తాడు, అంతర్దృష్టిని ఇస్తాడు.",
  },
  ta: {
    Sun: "ஆன்மா, தேஜஸ், அதிகாரம், தந்தை. உங்கள் அக இயல்பையும் உயிர்ச்சக்தியையும் குறிக்கிறார்.",
    Moon: "மனம், உணர்வுகள், தாய், பொதுமக்கள். மன நலத்துக்கும் உள்ளுணர்வுக்கும் அதிபதி.",
    Mars: "ஆற்றல், தைரியம், செயல், உடன்பிறந்தோர். முன்முயற்சியையும் உடல் வலிமையையும் இயக்குகிறார்.",
    Mercury: "புத்தி, வாக்கு, கற்றல், தொடர்பு. பகுத்தாயும் திறனை வடிவமைக்கிறார்.",
    Jupiter: "ஞானம், பாக்கியம், தர்மம், வழிகாட்டிகள். விரிவு, பரோபகாரம், வளம் ஆகியவற்றின் மூலம்.",
    Venus: "அன்பு, அழகு, சுகம், கூட்டாண்மை. அழகுணர்ச்சிக்கும் உறவுகளுக்கும் அதிபதி.",
    Saturn: "ஒழுக்கம், ஆயுள், கர்மம், கஷ்டம். மெதுவான, ஒழுங்கான, நிலைத்து நிற்கும் பாடங்களைத் தருகிறார்.",
    Rahu: "உலக ஆசைகள், வெளிநாடு, லட்சியம். ஒரே நேரத்தில் பெருக்கவும் மறைக்கவும் செய்கிறார்.",
    Ketu: "வைராக்கியம், ஆன்மிகம், பூர்வ கர்மம். பற்றைக் கரைத்து உள்நோக்கைத் தருகிறார்.",
  },
  kn: {
    Sun: "ಆತ್ಮ, ತೇಜಸ್ಸು, ಅಧಿಕಾರ, ತಂದೆ. ನಿಮ್ಮ ಅಂತರಂಗದ ಸ್ವಭಾವ ಮತ್ತು ಪ್ರಾಣಶಕ್ತಿಯನ್ನು ಸೂಚಿಸುತ್ತಾನೆ.",
    Moon: "ಮನಸ್ಸು, ಭಾವನೆ, ತಾಯಿ, ಜನಸಾಮಾನ್ಯರು. ಮಾನಸಿಕ ಯೋಗಕ್ಷೇಮ ಮತ್ತು ಅಂತರ್ಜ್ಞಾನದ ಅಧಿಪತಿ.",
    Mars: "ಶಕ್ತಿ, ಧೈರ್ಯ, ಕರ್ಮ, ಸಹೋದರರು. ಉಪಕ್ರಮ ಮತ್ತು ದೈಹಿಕ ಬಲವನ್ನು ನಡೆಸುತ್ತಾನೆ.",
    Mercury: "ಬುದ್ಧಿ, ವಾಕ್, ಕಲಿಕೆ, ಸಂವಹನ. ವಿಶ್ಲೇಷಣಾ ಸಾಮರ್ಥ್ಯವನ್ನು ರೂಪಿಸುತ್ತಾನೆ.",
    Jupiter: "ಜ್ಞಾನ, ಭಾಗ್ಯ, ಧರ್ಮ, ಗುರುಜನರು. ವಿಸ್ತಾರ, ಪರೋಪಕಾರ ಮತ್ತು ಸಮೃದ್ಧಿಯ ಮೂಲ.",
    Venus: "ಪ್ರೀತಿ, ಸೌಂದರ್ಯ, ಸುಖ, ಪಾಲುದಾರಿಕೆ. ಸೌಂದರ್ಯಪ್ರಜ್ಞೆ ಮತ್ತು ಸಂಬಂಧಗಳ ಅಧಿಪತಿ.",
    Saturn: "ಶಿಸ್ತು, ಆಯುಷ್ಯ, ಕರ್ಮ, ಕಷ್ಟ. ನಿಧಾನವಾದ, ಕ್ರಮಬದ್ಧ, ಶಾಶ್ವತ ಪಾಠಗಳನ್ನು ಕಲಿಸುತ್ತಾನೆ.",
    Rahu: "ಲೌಕಿಕ ಆಸೆ, ವಿದೇಶ, ಮಹತ್ವಾಕಾಂಕ್ಷೆ. ಏಕಕಾಲದಲ್ಲಿ ಹೆಚ್ಚಿಸುತ್ತಾನೆ ಮತ್ತು ಮರೆಮಾಡುತ್ತಾನೆ.",
    Ketu: "ವೈರಾಗ್ಯ, ಆಧ್ಯಾತ್ಮ, ಪೂರ್ವ ಕರ್ಮ. ಆಸಕ್ತಿಯನ್ನು ಕರಗಿಸಿ ಒಳನೋಟವನ್ನು ನೀಡುತ್ತಾನೆ.",
  },
  ml: {
    Sun: "ആത്മാവ്, ഓജസ്സ്, അധികാരം, പിതാവ്. നിങ്ങളുടെ ആന്തരിക സ്വത്വത്തെയും പ്രാണശക്തിയെയും സൂചിപ്പിക്കുന്നു.",
    Moon: "മനസ്സ്, വികാരം, മാതാവ്, ജനങ്ങൾ. മാനസിക ക്ഷേമത്തിന്റെയും അന്തർജ്ഞാനത്തിന്റെയും അധിപൻ.",
    Mars: "ഊർജം, ധൈര്യം, കർമം, സഹോദരങ്ങൾ. മുൻകൈയെയും ശാരീരിക ബലത്തെയും നയിക്കുന്നു.",
    Mercury: "ബുദ്ധി, വാക്ക്, പഠനം, ആശയവിനിമയം. വിശകലനശേഷിക്ക് രൂപം നൽകുന്നു.",
    Jupiter: "ജ്ഞാനം, ഭാഗ്യം, ധർമം, ഗുരുജനങ്ങൾ. വികാസം, പരോപകാരം, സമൃദ്ധി എന്നിവയുടെ ഉറവിടം.",
    Venus: "സ്നേഹം, സൗന്ദര്യം, സുഖം, പങ്കാളിത്തം. സൗന്ദര്യബോധത്തിന്റെയും ബന്ധങ്ങളുടെയും അധിപൻ.",
    Saturn: "അച്ചടക്കം, ആയുസ്സ്, കർമം, ക്ലേശം. സാവധാനത്തിലുള്ള, ചിട്ടയായ, നിലനിൽക്കുന്ന പാഠങ്ങൾ പഠിപ്പിക്കുന്നു.",
    Rahu: "ലൗകിക ആഗ്രഹം, വിദേശം, മഹത്ത്വാകാംക്ഷ. ഒരേ സമയം വർധിപ്പിക്കുകയും മറയ്ക്കുകയും ചെയ്യുന്നു.",
    Ketu: "വൈരാഗ്യം, ആത്മീയത, പൂർവകർമം. ആസക്തികളെ അലിയിച്ച് ഉൾക്കാഴ്ച നൽകുന്നു.",
  },
};

// ---------------------------------------------------------------------------
// Locale-aware helpers (mirror the Go template FuncMap).
// ---------------------------------------------------------------------------

function pickLocale(loc: string | undefined): string {
  return loc && LABELS[loc] ? loc : "en";
}

export function houseTopic(loc: string, n: number): string {
  return HOUSE_TOPICS[loc]?.[n] ?? HOUSE_TOPICS.en?.[n] ?? "";
}

function categoryLabel(loc: string, cat: string | undefined): string {
  const c = cat ?? "";
  return (REMEDY_CATEGORY_LABELS[loc] && REMEDY_CATEGORY_LABELS[loc][c]) ?? c;
}

function planetSummary(loc: string, name: string | undefined): string {
  const n = name ?? "";
  return PLANET_SUMMARIES[loc]?.[n] ?? PLANET_SUMMARIES.en?.[n] ?? "";
}

/**
 * Lord label: the API's LordLocal when present (any non-en locale), else LordHI
 * for hi/mr, the engine's native planet name for te/ta/kn, else LordEN.
 */
export function houseLordLabel(loc: string, h: BrihadHouseSection): string {
  if (h.LordLocal) return h.LordLocal;
  return lordLabel(loc, h.LordEN, h.LordHI);
}

/**
 * Yoga display name: the API's NameLocal when present (any non-en locale),
 * else NameHI for hi/mr, else NameEN. (Older API builds sent no NameLocal; the
 * Devanagari NameHI is never shown for te/ta/kn because it is the wrong script.)
 */
export function yogaNameLabel(loc: string, y: BrihadYoga): string {
  if (y.NameLocal) return y.NameLocal;
  if (isDevanagariLocale(loc) && y.NameHI) return y.NameHI;
  return y.NameEN ?? "";
}

export function dashaLordLabel(loc: string, d: BrihadDashaPeriod): string {
  if (d.LordLocal) return d.LordLocal;
  return lordLabel(loc, d.Lord, d.LordHI);
}

/** Dosha display name: the API's NameLocal when present, else the template label. */
export function doshaNameLabel(label: (k: string) => string, entry: BrihadDoshaEntry, nameKey: string): string {
  return entry.NameLocal || label(nameKey);
}

/** severityLabel: look up "dosha_severity_<severity>", fall back to raw. */
export function severityLabel(label: (k: string) => string, severity: string | undefined): string {
  const s = severity ?? "";
  const key = "dosha_severity_" + s;
  const found = label(key);
  return found || s;
}

/** areaLabel: look up "area_<area>", fall back to raw. */
function areaLabel(label: (k: string) => string, area: string | undefined): string {
  const a = area ?? "";
  const key = "area_" + a;
  const found = label(key);
  return found || a;
}

export function anyDoshaPresent(d: BrihadDoshas | null | undefined): boolean {
  if (!d) return false;
  return !!d.Mangal || !!d.KaalSarp || !!d.Pitra;
}

// ---------------------------------------------------------------------------
// Renderer.
// ---------------------------------------------------------------------------

/** Brihad-specific CSS — appended after BASE_CSS. Mirrors the Go <style>. */
const EXTRA_CSS = `
/* Brihad uses a Puppeteer running header/footer in the page margin. The
   @page margin here MUST match the page.pdf margin (BRIHAD_PDF_MARGIN =
   26mm/16mm top/bottom) so that whichever Chromium honours, body content
   always stays inside the same safe box and never overlaps the header/footer
   bands. (The old 18/22mm BASE_CSS margin let content ride up into the
   header.) Drop the in-body fixed footer + watermark too. */
@page { size: A4; margin: 26mm 0 16mm 0; }
body > footer { display: none !important; }
body::before { display: none !important; }
/* Side gutters live on the body so the running header/footer can still bleed
   to the page edges like the benchmark's page-number tab. */
.section { padding-left: 14mm; padding-right: 14mm; }
.cover { padding-left: 0; padding-right: 0; }

/* ====================================================================
   LifeAstro design system — "Royal Purple + Gold" (premium/luxe). A
   DISTINCT identity, deliberately NOT the benchmark's teal/orange look:
   royal-purple primaries + gold accents + soft-lavender backgrounds, and a
   gold double-rule heading underline (not a slanted bar). The --as-* var
   names are kept only so the rest of the CSS need not change.
   ==================================================================== */
:root {
  /* LifeAstro "Hindu Spiritual / Saffron" palette — warm dharmic colours
     (saffron, haldi-gold, sindoor-maroon) on cream. All accents are
     dark/saturated enough to read clearly on white or the cream zebra. */
  --as-teal:#c25e10;   /* deep saffron (primary)            */
  --as-green:#a8451a;  /* burnt orange-brown                */
  --as-amber:#b8860b;  /* haldi gold (readable on white)    */
  --as-dorange:#9e2b25;/* sindoor maroon (heading accent)   */
  --as-slate:#6b4a2f;  /* warm brown ink-2                  */
  --as-olive:#9c6f1e;  /* antique gold                      */
  --as-blue:#8a3324;   /* deep terracotta                   */
  --as-lteal:#c0631e;  /* saffron-orange                    */
  --as-salmon:#b5471f; /* rust                              */
  --as-lamber:#9a7b1e; /* gold (readable)                   */
  --as-gold:#8a5a00;   /* dark saffron-gold (cover)         */
  --as-tab:#8a1f17;    /* deep maroon page accent           */
  --as-zebra:#fcf3e3;  /* warm cream zebra (bg only)        */
  --as-cardbg:#fffaf0; /* ivory card bg                     */
  --as-ink:#3a2410;    /* deep warm-brown ink               */
  /* Legacy "secondary" small-muted text → readable warm brown (gold is too
     light as body text; gold stays for accents/borders). */
  --brand-secondary:#7a5a3a;
}
/* Typography — airy density (~larger body + generous line-height) so the
   report reads premium, not a wall of text. */
body { color: var(--as-ink); font-size: 11.5pt; line-height: 1.8; }

/* Section heading — purple title with a DISTINCT gold double-rule underline
   (thick gold bar + thin purple hairline beneath) — a different signature
   from the benchmark's slanted single bar. */
.section > h2 {
  color: var(--as-teal); font-size: 21.6pt; font-weight: 700;
  border: none; padding: 0 0 2.5mm; margin: 0 0 5mm; position: relative;
}
.section > h2::after {
  content: ""; position: absolute; left: 0; bottom: 0; height: 1.6mm; width: 52mm;
  background: var(--as-amber);
  border-radius: 1mm;
  box-shadow: 0 2.4mm 0 -0.9mm var(--as-teal); /* thin purple hairline below the gold bar */
}
.section:nth-of-type(2n) > h2 { color: var(--as-dorange); }
.section:nth-of-type(3n) > h2 { color: var(--as-blue); }

/* Tables — colored header row + zebra body. */
.section table { border-collapse: separate; border-spacing: 0; margin: 4mm 0; width: 100%; }
.section table thead th {
  background: var(--as-teal); color: #fff; font-weight: 600; font-size: 10pt;
  padding: 2.5mm 3mm; text-align: left; border: none;
}
.section table tbody td {
  padding: 3mm 3.5mm; font-size: 10.5pt; border: none; border-bottom: 1px solid #eaeaea;
  vertical-align: top;
}
.section table tbody tr:nth-child(odd) td { background: var(--as-zebra); }
.section table tbody tr:nth-child(even) td { background: #ffffff; }
/* Page-break hygiene: never split a row; keep header with its first rows;
   don't strand a heading at the page bottom. */
.section table tr { page-break-inside: avoid; }
.section table thead { display: table-header-group; }
.section h4 { page-break-after: avoid; }
/* NOTE: h2/h3 do NOT use page-break-after:avoid — gluing a heading to a tall
   following block (e.g. a 400px divisional chart) pushed the whole group to
   the next page and left the forced section page nearly blank. */
.yoga-block, .north-chart { page-break-inside: avoid; }
/* The diamond chart stays atomic, and the chart+heading stick together, but
   a divisional block as a whole may break (its table can flow) so a tall
   first block doesn't orphan an entire blank page before it. */
/* Keep ONLY the diamond atomic (.north-chart avoid-inside). Do NOT chain
   the heading→chart with avoid-before/after — that built an unbreakable
   group taller than a page, which orphaned a whole blank page before it. */

/* Narrative-chapter section headings keep the same slanted-underline look but
   the per-rule sub-headings (h3) are colored + tight. */
/* Each per-rule block (h3 + body) gets card-like breathing room so a page
   holds a few rich blocks, not a wall of text — matches the benchmark's
   ~230 w/pp feel. */
.narrative-chapter h3 {
  color: var(--as-dorange); font-size: 13.5pt; font-weight: 700;
  margin: 9mm 0 3mm; page-break-after: avoid;
}
.narrative-chapter h3:first-of-type { margin-top: 4mm; }
.narrative-chapter p { margin: 0 0 5mm; text-align: justify; line-height: 1.85; }
.narrative-chapter ul { margin: 0 0 5mm 7mm; }
.narrative-chapter li { margin-bottom: 2.5mm; line-height: 1.7; }

/* Sub-section h3 inside compute sections (e.g. KP significators, Maitri tables) */
.section h3 { color: var(--as-teal); font-size: 12.5pt; font-weight: 700; margin: 6mm 0 2.5mm; page-break-after: avoid; }
.section h4 { color: var(--as-slate); font-size: 11pt; font-weight: 700; margin: 4mm 0 2mm; }
.section p { margin: 3mm 0; line-height: 1.7; }

/* Intro paragraph right under a heading — muted. */
.section > p:first-of-type { color: #555; }

/* Table of contents (विषय-सूची) — teal banner + dotted-leader rows with
   color-coded page numbers. */
.toc-section { padding-top: 4mm; }
.toc-banner {
  background: var(--as-teal); color: #fff; font-size: 16pt; font-weight: 700;
  text-align: center; padding: 3mm; border-radius: 4mm; margin: 0 0 6mm;
}
.toc-row { display: flex; align-items: baseline; margin: 2.4mm 0; font-size: 12pt; }
.toc-row .toc-title { color: #444; white-space: nowrap; }
.toc-row .toc-dots { flex: 1 1 auto; border-bottom: 1px dotted #bbb; margin: 0 2mm 1mm; }
.toc-row .toc-page { font-weight: 700; font-size: 13pt; }
/* 2-level TOC: Part rows bold (level 1), section rows indented (level 2). */
.toc-row.toc-part { margin: 4mm 0 1.5mm; }
.toc-row.toc-part .toc-title { color: var(--as-teal); font-weight: 700; font-size: 12.5pt; }
.toc-row.toc-sub { margin-left: 7mm; }
.toc-row.toc-sub .toc-title { color: #555; }

/* Part banner — a level-1 grouping heading spliced to the TOP of the first
 * section of each Part (NOT its own page, so there's no blank Part page). The
 * host section already forces a page break, so the banner opens that page with
 * the section's content flowing right below it. Rendered LARGER than ordinary
 * section headings (24pt vs 21.6pt) so it reads as the top of the hierarchy
 * and the outline/TOC level-detection by font-size works. */
.part-banner { margin: 0 0 6mm; page-break-after: avoid; }
.part-banner .part-h2 {
  background: var(--as-teal); color: #fff; text-align: center;
  padding: 6mm 4mm; border-radius: 3mm; font-size: 24pt; border-bottom: none;
  margin: 0;
}
/* A merged-in sub-heading: the second piece's old top heading, demoted to a
 * sub-heading when two same-topic sections fold into one. In-section divider. */
h3.merged-sub {
  font-size: 14pt; color: var(--as-teal); margin: 7mm 0 2mm;
  padding-top: 3mm; border-top: 0.3mm solid #e3d9c0;
}

/* Graha Sthiti — planet cards grid with glyph images (3-up). */
.graha-grid { display: flex; flex-wrap: wrap; gap: 4mm; margin: 5mm 0; }
.graha-card {
  flex: 0 0 calc(33.333% - 3mm); display: flex; align-items: center; gap: 3mm;
  background: #fff; border: 1px solid #eee; border-radius: 2mm; padding: 3mm;
  box-shadow: 0 1px 2px rgba(0,0,0,0.05); page-break-inside: avoid;
}
.graha-card .graha-glyph { flex: 0 0 auto; line-height: 0; }
.graha-card .graha-name { font-weight: 700; font-size: 11pt; color: var(--as-ink); }
.graha-card .graha-pos { font-size: 9.5pt; color: var(--as-teal); margin-top: 0.5mm; }
.graha-card .graha-nak { font-size: 9pt; color: #777; }

/* Rajyoga donut — pinned colors. */
.rajyoga-power { text-align: center; margin: 6mm 0; }
.rajyoga-power .rajyoga-pct {
  display: inline-block; font-size: 30pt; font-weight: 700; color: var(--as-teal);
  border: 5px solid var(--as-teal); border-radius: 50%; width: 36mm; height: 36mm;
  line-height: 36mm; }
.rajyoga-power .rajyoga-label { color: var(--as-slate); font-size: 11pt; margin-top: 2mm; }
.cover h1 { font-size: 32pt; font-weight: 700; letter-spacing: 1pt; }
.cover .subtitle { color: var(--brand-secondary); font-size: 14pt; margin-bottom: 14mm; font-style: italic; }
.cover .subject { font-size: 18pt; font-weight: 600; }
/* Each top-level section starts on a fresh page for a clean opening. The
   blank-page bug (a section heading chained avoid-together with a tall
   440px chart into an unbreakable group) is fixed separately by NOT chaining
   heading→chart, so this forced break no longer orphans empty pages. */
.section { page-break-before: always; margin-top: 4mm; }
.section.first { page-break-before: auto; }
.planet-block, .house-block {
  margin: 4mm 0; padding: 4mm 5mm; background: #fafafa;
  border-left: 3px solid var(--brand-primary); page-break-inside: avoid;
}
.planet-block .meta, .house-block .meta {
  color: var(--brand-secondary); font-size: 10pt; margin-bottom: 2mm;
}
/* Yoga blocks — each name becomes a numbered colored pill badge (rotating
   palette like the benchmark). Counter drives the number. */
/* Yoga blocks — a clean LifeAstro card (NOT the benchmark's garish rotating
   pill): a numbered gold ✦ disc + maroon name on a cream card with a saffron
   left rule. Single, consistent, elegant. */
.section.yogas-section { counter-reset: yoga; }
.yoga-block {
  counter-increment: yoga; margin: 5mm 0; padding: 4mm 5mm 4mm 6mm;
  background: var(--as-cardbg); border-left: 1mm solid var(--as-teal);
  border-radius: 0 2mm 2mm 0; page-break-inside: avoid;
}
.yoga-block .name {
  display: block; position: relative; padding-left: 11mm;
  font-size: 13pt; font-weight: 700; color: var(--as-dorange);
  margin-bottom: 1.5mm; line-height: 1.3;
}
.yoga-block .name::before {
  content: counter(yoga); position: absolute; left: 0; top: -0.5mm;
  width: 7.5mm; height: 7.5mm; border-radius: 50%;
  background: var(--as-amber); color: #fff; font-size: 11pt; font-weight: 700;
  display: flex; align-items: center; justify-content: center;
}
.yoga-block .shloka { color: #9e2b25; font-style: italic; text-align: center; margin: 2mm 6mm; line-height: 1.55; }
.yoga-block .body { text-align: justify; }
.yoga-block .summary { font-weight: 700; color: var(--as-teal); text-align: center; margin: 2.5mm 4mm 0; }
.yoga-block .source { color: var(--as-slate); font-size: 9pt; font-style: italic; margin-top: 2mm; }
.dasha-block {
  margin: 4mm 0; padding: 5mm; background: #f0fdf4;
  border-left: 4px solid #16a34a; page-break-inside: avoid;
}
.dasha-block.upcoming { background: #fafafa; border-left-color: var(--brand-secondary); }
.dasha-block .header-row { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 2mm; }
.dasha-block .lord { font-size: 14pt; font-weight: 700; color: var(--brand-primary); }
.dasha-block .dates { color: var(--brand-secondary); font-size: 10pt; }
.remedy-block {
  margin: 3mm 0; padding: 3mm 5mm; background: #fafafa;
  border-left: 3px solid var(--brand-secondary); page-break-inside: avoid;
}
.remedy-block .title { font-weight: 600; margin-bottom: 1mm; }
.remedy-block .category {
  display: inline-block; padding: 1mm 3mm; background: var(--brand-secondary);
  color: #fff; font-size: 9pt; border-radius: 1mm; margin-left: 3mm; vertical-align: middle;
}
.empty-list { margin: 3mm 0; color: var(--brand-secondary); font-style: italic; }
/* Mudda-Dasha month-wise timeline cards */
.mudda-period {
  margin: 4mm 0; padding: 3mm 5mm 3mm 5mm; background: var(--as-cardbg, #fffaf0);
  border-left: 4px solid var(--as-teal, #c25e10); border-radius: 1mm;
  page-break-inside: avoid;
}
.mudda-head {
  font-size: 12pt; font-weight: 700; color: var(--as-dorange, #9e2b25);
  margin: 0 0 1.5mm; padding-bottom: 1mm; border-bottom: 1px solid #eadcc0;
}
.mudda-summary { font-style: italic; color: var(--as-ink, #3a2410); margin: 0 0 2mm; }
.mudda-area { margin: 1mm 0; font-size: 10.5pt; }
.mudda-area strong { color: var(--as-teal, #c25e10); }
.mudda-guidance {
  margin: 2.5mm 0 0; padding: 2mm 3mm; background: #fff7e8;
  border: 1px dashed var(--as-amber, #b8860b); border-radius: 1mm;
}
.mudda-guidance p { margin: 0.8mm 0; font-size: 10pt; }
.mudda-guidance strong { color: var(--as-dorange, #9e2b25); }
/* The whole divisional block must NOT be atomic — chart(110mm)+full table is
   taller than the space left under a section heading, which orphaned a near-
   blank page. Only the diamond (.north-chart) stays atomic; the table flows. */
/* Keep each varga's chart + its table together on one page. The chart is
   sized (300px ≈ 79mm) so the whole block stays under a page height, so this
   never orphans a blank page (the earlier blank-page issue was at 400px). */
.divisional-block { margin: 6mm 0; page-break-inside: avoid; }
.divisional-block .vsubtitle { color: var(--brand-secondary); font-style: italic; font-size: 10pt; margin: 0 0 2mm; }
.divisional-block .lagna-line { font-size: 10pt; margin-bottom: 2mm; }
.dosha-block {
  margin: 4mm 0; padding: 4mm 5mm; border-left: 4px solid #b91c1c;
  background: #fef2f2; page-break-inside: avoid;
}
.dosha-block.cancelled { border-left-color: #16a34a; background: #f0fdf4; }
.dosha-block.mild { border-left-color: #ca8a04; background: #fefce8; }
.dosha-block .header-row { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 2mm; }
.dosha-block .name { font-size: 13pt; font-weight: 700; color: var(--brand-primary); }
.dosha-block .severity {
  display: inline-block; padding: 1mm 3mm; font-size: 9pt; font-weight: 600;
  border-radius: 1mm; color: #fff; background: #b91c1c;
}
.dosha-block.cancelled .severity { background: #16a34a; }
.dosha-block.mild .severity { background: #ca8a04; }
.dosha-block .source { color: var(--brand-secondary); font-size: 9pt; font-style: italic; margin-top: 2mm; }
.prediction-block {
  margin: 4mm 0; padding: 4mm 5mm; background: #f5f3ff;
  border-left: 3px solid #7c3aed; page-break-inside: avoid;
}
.prediction-block h3 { margin: 0 0 2mm; color: #5b21b6; }
.citation-row { display: flex; gap: 4mm; padding: 2mm 0; border-bottom: 1px dotted #d4d4d4; font-size: 10pt; }
.citation-row .topic { width: 38%; font-weight: 600; }
.citation-row .source { width: 30%; font-style: italic; color: var(--brand-secondary); }
.citation-row .note { flex: 1; color: var(--brand-secondary); }
`;

/**
 * Render the Brihad Kundli report as a self-contained HTML document.
 *
 * @param data     The JSON returned by `GET /v1/reports/kundli/brihad`.
 * @param branding Optional caller branding overrides (merged over `data.Branding`).
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

export function renderKundliBrihadHtml(data: KundliBrihadData, branding?: Branding): string {
  const b = resolveBranding(data.Branding, branding);
  const loc = pickLocale(data.Locale);
  const label = makeLabeler(LABELS, loc);

  const subject = data.Subject ?? {};
  const asc = data.Ascendant ?? {};
  const planets = Array.isArray(data.Planets) ? data.Planets : [];
  const houses = Array.isArray(data.Houses) ? data.Houses : [];
  const yogas = Array.isArray(data.Yogas) ? data.Yogas : [];
  const upcoming = Array.isArray(data.UpcomingDashas) ? data.UpcomingDashas : [];
  const remedies = Array.isArray(data.Remedies) ? data.Remedies : [];
  const divisionals = Array.isArray(data.DivisionalCharts) ? data.DivisionalCharts : [];
  const predictions = Array.isArray(data.Predictions) ? data.Predictions : [];
  const citations = Array.isArray(data.Citations) ? data.Citations : [];

  const parts: string[] = [];

  // ── Named section builders ─────────────────────────────────────────────
  // Each builder returns the section's HTML (or "" when it has no content).
  // The Part 0–7 layout walk below decides the ORDER in which they appear —
  // this is the single source of truth for the report's page organization.
  // (See docs/BRIHAD_PDF_STRUCTURE_PLAN.md.) Keeping order data-driven means
  // the printed TOC and the PDF bookmark tree always match the body.
  const chapters = (data as { narrative_chapters?: BrihadNarrativeChapter[] }).narrative_chapters ?? [];
  const chapterByKey = new Map(chapters.map((c) => [c.key, c]));
  /** Emit a narrative chapter by family key, or "" if the corpus had none. */
  const chapter = (key: string): string => {
    const ch = chapterByKey.get(key);
    return ch ? renderChapter(ch, loc) : "";
  };
  // A Part divider is a level-1 grouping banner. It must NOT be its own page —
  // that left a near-blank page (just the banner) before the first section.
  // Instead we emit a sentinel here and, in the layout walk, splice the banner
  // into the TOP of the first real section that follows, so the banner sits
  // above that section's content on the SAME page (one bookmark target, no
  // blank page). PART_SENTINEL is an internal token, never rendered as-is.
  const PART_SENTINEL = " PART ";
  const partHeading = (key: string): string =>
    `${PART_SENTINEL}<div class="part-banner"><h2 class="part-h2">${esc(label(key))}</h2></div>`;

  /**
   * Merge same-topic sections into ONE section under ONE `<h2>`, so a topic
   * appears exactly once (one heading, one TOC row, one bookmark). The first
   * non-empty piece supplies the canonical `<h2>`; each later piece's own
   * `<h2>…</h2>` is demoted to an `<h3>` sub-heading and its body folded in.
   * This is how the divisional/varshaphal/yoga/dosha/houses pairs stop being
   * two separate sections (see docs/BRIHAD_PDF_STRUCTURE_PLAN.md §5.2).
   *
   * `heading` overrides the merged section's `<h2>` (e.g. a clean "Varga
   * Kundali + Analysis" label); omit to keep the first piece's heading.
   */
  const mergeSections = (heading: string | undefined, ...pieces: string[]): string => {
    const present = pieces.filter((p) => p && p.trim().length > 0);
    if (present.length === 0) return "";
    if (present.length === 1 && !heading) return present[0]!;

    // Extract the FIRST piece's <h2> (the canonical heading) unless overridden.
    const h2Re = /<section class="section[^"]*">\s*([\s\S]*?)<h2>([\s\S]*?)<\/h2>([\s\S]*?)<\/section>/;
    const innerOf = (html: string): { lead: string; h2: string; body: string } => {
      const m = h2Re.exec(html);
      if (!m) return { lead: "", h2: "", body: html };
      return { lead: m[1] ?? "", h2: m[2] ?? "", body: m[3] ?? "" };
    };

    const first = innerOf(present[0]!);
    const h2 = heading ? esc(heading) : first.h2;
    // Lead = invisible TOC marker etc. from the first piece (keep it so the
    // page-locator still lands on this merged section).
    let merged = `<section class="section">\n${first.lead}<h2>${h2}</h2>${first.body}`;
    for (let i = 1; i < present.length; i++) {
      const part = innerOf(present[i]!);
      // Demote the later piece's heading to an <h3> so its context survives,
      // and append its body. (lead markers from later pieces are dropped — only
      // the merged section needs ONE locator.)
      if (part.h2) merged += `\n<h3 class="merged-sub">${part.h2}</h3>`;
      merged += part.body;
    }
    merged += `\n</section>`;
    return merged;
  };

  // --- Cover ------------------------------------------------------------
  parts.push(`<section class="cover">
${coverBrandingHtml(b)}
<h1>${esc(label("title_brihad"))}</h1>
<div class="subtitle">${esc(label("subtitle_brihad"))}</div>
<div class="subject">${esc(subject.Name)}</div>
<div class="meta">
${esc(label("born"))} ${esc(subject.BirthDate)} ${esc(label("at"))} ${esc(subject.BirthTime)}<br>
${esc(subject.BirthPlace)}
</div>
<div class="generated">
${esc(label("generated"))} ${esc(formatGenerated(data.GeneratedAt))}
</div>
</section>`);

  // --- Section 1: Birth Chart Summary (ascendant + planet table) --------
  const chartBlock = ((): string => {
    const ascNak = esc(asc.nakshatra);
    const rows = planets
      .map((p) => {
        const pl = p.placement ?? {};
        const retro = p.retro ? " (R)" : "";
        return `<tr>
<td>${esc(p.name)}${retro}</td>
<td>${esc(pl.sign)}</td>
<td>${esc(pl.dms_within)}</td>
<td>${esc(p.house_num)}</td>
<td>${esc(pl.nakshatra)} (${esc(pl.pada)})</td>
</tr>`;
      })
      .join("\n");

    // North-Indian diamond charts: Lagna (D1) + Navamsa (D9), side by side.
    const d1Rows = planets.map((p) => ({
      name: p.name_en ?? p.name,
      house: typeof p.house_num === "number" ? p.house_num : Number(p.house_num),
      retro: !!p.retro,
    }));
    // Lagna + Navamsa charts — large (260px each) so the diamond + planets
    // are clearly legible, side by side on one row.
    const d1 = renderNorthChart(asc.sign, d1Rows, label("chart_lagna"), loc, b.primaryColor, 260);
    const d9data = (Array.isArray(data.DivisionalCharts) ? data.DivisionalCharts : []).find(
      (dc) => dc.varga === "D9",
    );
    const d9 = d9data
      ? renderNorthChart(d9data.lagna_sign, d9data.planets ?? [], label("chart_navamsa"), loc, b.primaryColor, 260)
      : "";
    const chartsHtml =
      d1 || d9
        ? `<div style="display:flex;justify-content:center;gap:6mm;flex-wrap:wrap;margin:6mm 0;">${d1}${d9}</div>`
        : "";

    return `<section class="section first">
<h2>${esc(label("section_chart"))}</h2>
<p>
<strong>${esc(label("ascendant"))}:</strong>
${esc(asc.sign)} (${esc(asc.dms_within)}),
${esc(label("nakshatra"))}: ${ascNak},
${esc(label("pada"))} ${esc(asc.pada)}
</p>
${chartsHtml}
<table>
<thead>
<tr>
<th>${esc(label("planet"))}</th>
<th>${esc(label("sign"))}</th>
<th>${esc(label("degree"))}</th>
<th>${esc(label("house"))}</th>
<th>${esc(label("nakshatra"))}</th>
</tr>
</thead>
<tbody>
${rows}
</tbody>
</table>
</section>`;
  })();

  // --- Graha Sthiti: planet-cards grid with glyph images ----------------
  const grahaSthitiBlock = renderGrahaSthiti(planets, label("section_graha_sthiti")) || "";

  // --- विस्तृत भविष्यफल (Detailed Prediction): the consumer-facing life
  // reading that OPENS Part 2 (like the benchmark). Pulled from the narrative
  // chapters; excluded from the later narrative loop to avoid a duplicate.
  const vistritBlock = chapter("vistrit_bhavishya");

  // --- Section 2: Planetary Analysis ------------------------------------
  const planetsAnalysisBlock = ((): string => {
    const blocks = planets
      .map((p) => {
        const pl = p.placement ?? {};
        return `<div class="planet-block">
<h3>${esc(p.name)}</h3>
<div class="meta">
${esc(pl.sign)} (${esc(pl.dms_within)}),
${esc(label("house"))} ${esc(p.house_num)},
${esc(label("nakshatra"))}: ${esc(pl.nakshatra)}
</div>
<p>${esc(planetSummary(loc, p.name_en ?? p.name))}</p>
</div>`;
      })
      .join("\n");
    if (!blocks) return "";
    return `<section class="section">
<h2>${esc(label("section_planets_analysis"))}</h2>
${blocks}
</section>`;
  })();

  // --- Section 3: House Analysis (houses + house-lord placement, merged) -
  const housesBlock = ((): string => {
    const blocks = houses
      .map((h) => {
        const num = h.HouseNum ?? 0;
        const lordSign = h.LordSign
          ? ` (${esc(label("in"))} ${esc(h.LordSign)})`
          : "";
        const body = h.Body
          ? `<p>${escBody(h.Body, loc)}</p>`
          : `<p class="empty-list">${esc(label("house_no_content"))}</p>`;
        return `<div class="house-block">
<h3>${esc(label("house"))} ${esc(num)}: ${esc(houseTopic(loc, num))}</h3>
<div class="meta">
${esc(label("lord"))}: ${esc(houseLordLabel(loc, h))}${lordSign}
</div>
${body}
</div>`;
      })
      .join("\n");
    if (!blocks) return "";
    return `<section class="section">
<h2>${esc(label("section_houses"))}</h2>
${blocks}
</section>`;
  })();

  // --- Section 4: Yogas (short list) ------------------------------------
  const yogasBlock = ((): string => {
    if (!yogas.length) return "";
    const inner = yogas
      .map((y) => {
        // Source name intentionally omitted (hard rule: no source names in body).
        return `<div class="yoga-block">
<div class="name">${esc(yogaNameLabel(loc, y))}</div>
<p>${escBody(y.Effect, loc)}</p>
</div>`;
      })
      .join("\n");
    return `<section class="section">
<h2>${esc(label("section_yogas"))}</h2>
${inner}
</section>`;
  })();

  // --- Section 5: Dashas (Vimshottari current + upcoming summary) -------
  const dashasBlock = ((): string => {
    const cur = data.CurrentDasha;
    let inner = "";
    if (cur) {
      inner += `<h3>${esc(label("current_dasha"))}</h3>
<div class="dasha-block">
<div class="header-row">
<span class="lord">${esc(dashaLordLabel(loc, cur))}</span>
<span class="dates">${esc(cur.StartDate)} &nbsp;${esc(label("date_to") || "to")}&nbsp; ${esc(cur.EndDate)} (${esc(cur.DurationY)} ${esc(label("years"))})</span>
</div>
<p>${escBody(cur.Body, loc)}</p>
</div>`;
    }
    if (upcoming.length) {
      const blocks = upcoming
        .map(
          (d) => `<div class="dasha-block upcoming">
<div class="header-row">
<span class="lord">${esc(dashaLordLabel(loc, d))}</span>
<span class="dates">${esc(d.StartDate)} &nbsp;${esc(label("date_to") || "to")}&nbsp; ${esc(d.EndDate)} (${esc(d.DurationY)} ${esc(label("years"))})</span>
</div>
<p>${escBody(d.Body, loc)}</p>
</div>`,
        )
        .join("\n");
      inner += `\n<h3>${esc(label("upcoming_dashas"))}</h3>\n${blocks}`;
    }
    if (!cur && !upcoming.length) return "";
    return `<section class="section">
<h2>${esc(label("section_dashas"))}</h2>
${inner}
</section>`;
  })();

  // --- Section 6: Remedies ----------------------------------------------
  const remediesBlock = ((): string => {
    if (!remedies.length) return "";
    const inner = remedies
      .map(
        (r) => `<div class="remedy-block">
<span class="title">${esc(r.Title)}</span>
<span class="category">${esc(categoryLabel(loc, r.Category))}</span>
<p>${escBody(r.Description, loc)}</p>
</div>`,
      )
      .join("\n");
    return `<section class="section">
<h2>${esc(label("section_remedies"))}</h2>
${inner}
</section>`;
  })();

  // --- Section 7 (Phase 2): Divisional Charts ---------------------------
  const divisionalsBlock = ((): string => {
    if (!divisionals.length) return "";
    const blocks = divisionals
      .map((d) => {
        const dplanets = Array.isArray(d.planets) ? d.planets : [];
        const rows = dplanets
          .map(
            (p) => `<tr>
<td>${esc(p.name)}</td>
<td>${esc(p.sign)}</td>
<td>${esc(p.house)}</td>
</tr>`,
          )
          .join("\n");
        // Chart on top (big, centred) with the placement table BELOW it, so
        // the diamond gets full width/space instead of being squeezed beside
        // the table.
        const dChart = renderNorthChart(d.lagna_sign, dplanets, `${d.varga ?? ""}`, loc, b.primaryColor, 300);
        return `<div class="divisional-block">
<h3>${esc(d.varga)}: ${esc(d.name)}</h3>
<p class="vsubtitle">${esc(d.subtitle)}</p>
<div class="lagna-line">
<strong>${esc(label("divisional_lagna"))}:</strong>
${esc(d.lagna_sign)}
</div>
<div style="text-align:center;margin:4mm 0;">${dChart}</div>
<table>
<thead>
<tr>
<th>${esc(label("planet"))}</th>
<th>${esc(label("sign"))}</th>
<th>${esc(label("house"))}</th>
</tr>
</thead>
<tbody>
${rows}
</tbody>
</table>
</div>`;
      })
      .join("\n");

    return `<section class="section">
<h2>${esc(label("section_divisionals"))}</h2>
<p class="section-intro">${esc(label("divisionals_intro"))}</p>
${blocks}
</section>`;
  })();

  // --- Section 8 (Phase 2): Doshas (short composite block) --------------
  const doshasBlock = ((): string => {
    if (!data.Doshas) return "";
    const d = data.Doshas;
    let inner: string;
    if (anyDoshaPresent(d)) {
      const block = (entry: BrihadDoshaEntry | null | undefined, nameKey: string): string => {
        if (!entry) return "";
        const sev = entry.Severity ?? "";
        // Source name intentionally omitted (hard rule: no source names in body).
        return `<div class="dosha-block ${esc(sev)}">
<div class="header-row">
<span class="name">${esc(doshaNameLabel(label, entry, nameKey))}</span>
<span class="severity">${esc(severityLabel(label, sev))}</span>
</div>
<p>${escBody(entry.Body, loc)}</p>
</div>`;
      };
      inner =
        block(d.Mangal, "dosha_mangal") +
        block(d.KaalSarp, "dosha_kaalsarp") +
        block(d.Pitra, "dosha_pitra");
    } else {
      inner = `<p class="empty-list">${esc(label("doshas_none_detected"))}</p>`;
    }
    return `<section class="section">
<h2>${esc(label("section_doshas"))}</h2>
${inner}
</section>`;
  })();

  // --- Section 9 (Phase 2): Predictions by Life Area --------------------
  const predictionsBlock = ((): string => {
    if (!predictions.length) return "";
    const blocks = predictions
      .map(
        (p) => `<div class="prediction-block">
<h3>${esc(areaLabel(label, p.Area))}</h3>
<p>${escBody(p.Body, loc)}</p>
</div>`,
      )
      .join("\n");
    return `<section class="section">
<h2>${esc(label("section_predictions"))}</h2>
${blocks}
</section>`;
  })();

  // ── Deep-section renderers, addressable by key ─────────────────────────
  // Each is a Brihat technical/remedy/varshaphal section. They were previously
  // emitted in a fixed list; now the layout walk places them into the right
  // Part. Empty data → "".
  const deep = brihadDeepBlocks(label, data, loc);

  // ── The Part 0–7 layout (single source of truth for page order) ────────
  // Sections that are empty for this chart contribute "" and are filtered out.
  // Part dividers are level-1 bookmarks; the sections under them are level-2.
  // See docs/BRIHAD_PDF_STRUCTURE_PLAN.md for the rationale.
  const layout: string[] = [
    // PART 1 — Foundations (snapshot + basic tables)
    partHeading("part_foundations"),
    chartBlock,
    grahaSthitiBlock,
    deep.avakahada,
    deep.panchang,
    deep.ghata,
    deep.chalit,

    // PART 2 — Your Life Reading (warm, consumer-facing core)
    partHeading("part_life_reading"),
    vistritBlock,
    chapter("lagna"),
    chapter("moon_sign"),
    chapter("sun_sign"),
    chapter("nakshatra"),
    planetsAnalysisBlock,
    chapter("planets_in_signs"),
    chapter("planets_in_houses"),
    // Houses + house-lords → ONE "भाव विश्लेषण" section (each house's topic +
    // its lord placement + narrative together).
    mergeSections(label("section_houses"), housesBlock, chapter("house_lords")),
    chapter("planet_nakshatra"),
    chapter("conjunctions"),
    chapter("graha_drishti"),

    // PART 3 — Yogas & Doshas (each ONCE)
    partHeading("part_yoga_dosha"),
    // Yoga short-list + deep yoga narrative → ONE yoga section.
    mergeSections(label("section_yogas"), yogasBlock, chapter("yogas")),
    deep.rajyoga,
    // Dosha composite block + deep dosha narrative → ONE dosha section.
    mergeSections(label("section_doshas"), doshasBlock, chapter("dosha_phal")),
    chapter("karakas"),

    // PART 4 — Dasha (life-timing — our depth USP)
    partHeading("part_dasha"),
    dashasBlock,
    chapter("dasha_phal"),
    chapter("antardasha_lagna"),
    chapter("yogini_dasha"),
    chapter("chara_dasha"),
    chapter("sade_sati"),
    chapter("transit"),

    // PART 5 — Remedies & Guidance
    partHeading("part_remedies"),
    predictionsBlock,
    chapter("outlook"),
    deep.ishta,
    deep.lalkitab,
    remediesBlock,
    deep.gems,

    // PART 6 — Technical Tables (grouped at END)
    partHeading("part_technical"),
    // Divisional charts (grids) + per-varga narrative → ONE section.
    mergeSections(label("section_divisionals"), divisionalsBlock, chapter("divisional_phal")),
    deep.shadbala,
    deep.bhavabala,
    deep.ashtakavarga,
    deep.maitri,
    deep.avasthas,
    deep.kp,
    deep.jaimini,

    // PART 7 — Varshaphal (annual — LAST). Tables + narrative → ONE section,
    // so each year's tables sit beside its reading instead of 100pp apart.
    partHeading("part_varshaphal"),
    mergeSections(label("section_varshaphal"), deep.varshaphal, chapter("varshaphal")),
    deep.mudda,
  ];

  // Walk the layout. A Part sentinel is held until the NEXT real section, then
  // its banner is spliced just inside that section's opening tag — so the Part
  // heading opens that section's page (no standalone blank Part page). A Part
  // with no following section (shouldn't happen) is dropped rather than left
  // as an empty page.
  let pendingBanner = "";
  const spliceBanner = (sectionHtml: string, banner: string): string => {
    // Insert the banner right after the first ">" of the opening <section ...>.
    const gt = sectionHtml.indexOf(">");
    if (gt === -1) return banner + sectionHtml;
    return sectionHtml.slice(0, gt + 1) + "\n" + banner + sectionHtml.slice(gt + 1);
  };
  for (const html of layout) {
    if (!html || html.trim().length === 0) continue;
    if (html.startsWith(PART_SENTINEL)) {
      pendingBanner = html.slice(PART_SENTINEL.length); // hold the banner div
      continue;
    }
    if (pendingBanner) {
      parts.push(spliceBanner(html, pendingBanner));
      pendingBanner = "";
    } else {
      parts.push(html);
    }
  }

  // NOTE: the classical-citations / sources section is INTENTIONALLY NOT
  // rendered. Per the product's hard rule, no book/author/website source
  // names may appear in the report body — citations stay in API metadata
  // only. (The `citations` data is received but deliberately not shown.)
  void citations;

  return layoutDocument({
    lang: loc,
    title: `${label("title_brihad")}: ${subject.Name ?? ""}`,
    branding: b,
    bodyHtml: parts.join("\n\n"),
    extraCss: EXTRA_CSS,
    // Brihad's footer is the Puppeteer footerTemplate (see kundliBrihadPdf).
    pageFooter: false,
  });
}
