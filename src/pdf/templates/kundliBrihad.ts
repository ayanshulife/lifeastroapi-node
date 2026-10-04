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
  LordSign?: string;
  Body?: string;
}

/** One detected yoga (PascalCase). */
export interface BrihadYoga {
  NameEN?: string;
  NameHI?: string;
  Effect?: string;
  Source?: string;
}

/** One Vimshottari Mahadasha period (PascalCase). */
export interface BrihadDashaPeriod {
  Lord?: string;
  LordHI?: string;
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
};

/** Remedy category → localized label (ported from remedyCategoryLabels). */
const REMEDY_CATEGORY_LABELS: Record<string, Record<string, string>> = {
  en: { mantra: "Mantra", donation: "Donation", fast: "Fast", gemstone: "Gemstone", yantra: "Yantra" },
  hi: { mantra: "मंत्र", donation: "दान", fast: "व्रत", gemstone: "रत्न", yantra: "यंत्र" },
  mr: { mantra: "मंत्र", donation: "दान", fast: "उपवास", gemstone: "रत्न", yantra: "यंत्र" },
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

/** Lord label: prefer LordHI for hi/mr, else LordEN. */
export function houseLordLabel(loc: string, h: BrihadHouseSection): string {
  if ((loc === "hi" || loc === "mr") && h.LordHI) return h.LordHI;
  return h.LordEN ?? "";
}

export function yogaNameLabel(loc: string, y: BrihadYoga): string {
  if ((loc === "hi" || loc === "mr") && y.NameHI) return y.NameHI;
  return y.NameEN ?? "";
}

export function dashaLordLabel(loc: string, d: BrihadDashaPeriod): string {
  if ((loc === "hi" || loc === "mr") && d.LordHI) return d.LordHI;
  return d.Lord ?? "";
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
<span class="name">${esc(label(nameKey))}</span>
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
