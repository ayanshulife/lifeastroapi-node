/**
 * Locale tables shared by the PDF templates.
 *
 * Planet, sign and weekday names are copied from the LifeAstroAPI Go engine
 * (`internal/vedic`: PlanetTE/TA/KN/ML, RashiTE/TA/KN/ML, localize_byname.go,
 * terms_native.go) so a template that has to localize an English key itself
 * (e.g. a dasha `Lord` the API only sends in English + Hindi) spells it exactly
 * as the API's own localized chart fields do.
 */

/** Locales written in Devanagari (the API's `*HI` fields cover these). */
export const DEVANAGARI_LOCALES: readonly string[] = ["hi", "mr"];
/** South-Indian locales with their own script and label tables. */
export const SOUTH_LOCALES: readonly string[] = ["te", "ta", "kn", "ml"];
/** Every Indic locale the PDF templates carry labels for. */
export const INDIC_LOCALES: readonly string[] = [...DEVANAGARI_LOCALES, ...SOUTH_LOCALES];

export function isDevanagariLocale(locale: string | undefined): boolean {
  return !!locale && DEVANAGARI_LOCALES.includes(locale);
}
export function isSouthLocale(locale: string | undefined): boolean {
  return !!locale && SOUTH_LOCALES.includes(locale);
}
export function isIndicLocale(locale: string | undefined): boolean {
  return !!locale && INDIC_LOCALES.includes(locale);
}

/**
 * Font stack with every Indic script the API can emit. Used for body text and
 * for the places that set their own font (page-margin footer, Brihad running
 * header/footer, chart SVG) so a Telugu/Tamil/Kannada string never falls back
 * to a font without those glyphs.
 */
export const INDIC_FONT_STACK =
  "'Noto Sans', 'Noto Sans Devanagari', 'Noto Sans Telugu', 'Noto Sans Tamil', " +
  "'Noto Sans Kannada', 'Noto Sans Bengali', 'Noto Sans Gujarati', 'Noto Sans Gurmukhi', " +
  "'Noto Sans Malayalam', sans-serif";

/** Same stack with double quotes, safe inside an HTML `style="..."` attribute. */
export const INDIC_FONT_STACK_ATTR = INDIC_FONT_STACK.replace(/'/g, "");

// ── Planet names (= Go vedic.PlanetTE / PlanetTA / PlanetKN) ────────────────

export const PLANET_NAMES: Record<string, Record<string, string>> = {
  te: {
    Sun: "సూర్యుడు", Moon: "చంద్రుడు", Mars: "కుజుడు", Mercury: "బుధుడు",
    Jupiter: "గురువు", Venus: "శుక్రుడు", Saturn: "శని", Rahu: "రాహువు", Ketu: "కేతువు",
    Lagna: "లగ్నం",
  },
  ta: {
    Sun: "சூரியன்", Moon: "சந்திரன்", Mars: "செவ்வாய்", Mercury: "புதன்",
    Jupiter: "குரு", Venus: "சுக்கிரன்", Saturn: "சனி", Rahu: "ராகு", Ketu: "கேது",
    Lagna: "லக்னம்",
  },
  kn: {
    Sun: "ಸೂರ್ಯ", Moon: "ಚಂದ್ರ", Mars: "ಮಂಗಳ", Mercury: "ಬುಧ",
    Jupiter: "ಗುರು", Venus: "ಶುಕ್ರ", Saturn: "ಶನಿ", Rahu: "ರಾಹು", Ketu: "ಕೇತು",
    Lagna: "ಲಗ್ನ",
  },
  ml: {
    Sun: "സൂര്യൻ", Moon: "ചന്ദ്രൻ", Mars: "ചൊവ്വ", Mercury: "ബുധൻ",
    Jupiter: "വ്യാഴം", Venus: "ശുക്രൻ", Saturn: "ശനി", Rahu: "രാഹു", Ketu: "കേതു",
    Lagna: "ലഗ്നം",
  },
};

/** Yogini dasha lords (= Go vedic termTE / termTA / termKN). */
export const YOGINI_NAMES: Record<string, Record<string, string>> = {
  te: {
    Mangala: "మంగళా", Pingala: "పింగళా", Dhanya: "ధాన్యా", Bhramari: "భ్రమరి",
    Bhadrika: "భద్రికా", Ulka: "ఉల్కా", Siddha: "సిద్ధా", Sankata: "సంకటా",
  },
  ta: {
    Mangala: "மங்களா", Pingala: "பிங்களா", Dhanya: "தான்யா", Bhramari: "ப்ரமரி",
    Bhadrika: "பத்ரிகா", Ulka: "உல்கா", Siddha: "சித்தா", Sankata: "சங்கடா",
  },
  kn: {
    Mangala: "ಮಂಗಳಾ", Pingala: "ಪಿಂಗಳಾ", Dhanya: "ಧಾನ್ಯಾ", Bhramari: "ಭ್ರಮರಿ",
    Bhadrika: "ಭದ್ರಿಕಾ", Ulka: "ಉಲ್ಕಾ", Siddha: "ಸಿದ್ಧಾ", Sankata: "ಸಂಕಟಾ",
  },
  ml: {
    Mangala: "മംഗള", Pingala: "പിംഗള", Dhanya: "ധാന്യ", Bhramari: "ഭ്രമരി",
    Bhadrika: "ഭദ്രിക", Ulka: "ഉൽക", Siddha: "സിദ്ധ", Sankata: "സങ്കട",
  },
};

/** Sign names, index 0 = Aries (= Go vedic.RashiTE / RashiTA / RashiKN). */
export const RASHI_NAMES: Record<string, readonly string[]> = {
  te: ["మేషం", "వృషభం", "మిథునం", "కర్కాటకం", "సింహం", "కన్య", "తుల", "వృశ్చికం", "ధనుస్సు", "మకరం", "కుంభం", "మీనం"],
  ta: ["மேஷம்", "ரிஷபம்", "மிதுனம்", "கடகம்", "சிம்மம்", "கன்னி", "துலாம்", "விருச்சிகம்", "தனுசு", "மகரம்", "கும்பம்", "மீனம்"],
  kn: ["ಮೇಷ", "ವೃಷಭ", "ಮಿಥುನ", "ಕರ್ಕಾಟಕ", "ಸಿಂಹ", "ಕನ್ಯಾ", "ತುಲಾ", "ವೃಶ್ಚಿಕ", "ಧನು", "ಮಕರ", "ಕುಂಭ", "ಮೀನ"],
  ml: ["മേടം", "ഇടവം", "മിഥുനം", "കർക്കടകം", "ചിങ്ങം", "കന്നി", "തുലാം", "വൃശ്ചികം", "ധനു", "മകരം", "കുംഭം", "മീനം"],
};

/** Weekday names, Sunday first (= Go vedic weekdayByLocale). */
const WEEKDAYS_EN = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
export const WEEKDAY_NAMES: Record<string, readonly string[]> = {
  te: ["ఆదివారం", "సోమవారం", "మంగళవారం", "బుధవారం", "గురువారం", "శుక్రవారం", "శనివారం"],
  ta: ["ஞாயிற்றுக்கிழமை", "திங்கட்கிழமை", "செவ்வாய்க்கிழமை", "புதன்கிழமை", "வியாழக்கிழமை", "வெள்ளிக்கிழமை", "சனிக்கிழமை"],
  kn: ["ಭಾನುವಾರ", "ಸೋಮವಾರ", "ಮಂಗಳವಾರ", "ಬುಧವಾರ", "ಗುರುವಾರ", "ಶುಕ್ರವಾರ", "ಶನಿವಾರ"],
  ml: ["ഞായറാഴ്ച", "തിങ്കളാഴ്ച", "ചൊവ്വാഴ്ച", "ബുധനാഴ്ച", "വ്യാഴാഴ്ച", "വെള്ളിയാഴ്ച", "ശനിയാഴ്ച"],
};

/** Every localized planet name (any locale) → its English key. */
const PLANET_TO_EN: Record<string, string> = (() => {
  const out: Record<string, string> = {};
  for (const table of Object.values(PLANET_NAMES)) {
    for (const [en, native] of Object.entries(table)) out[native] = en;
  }
  return out;
})();

/** Every localized sign name (te/ta/kn/ml) → 0-based sign index. */
export const SOUTH_SIGN_INDEX: Record<string, number> = (() => {
  const out: Record<string, number> = {};
  for (const names of Object.values(RASHI_NAMES)) names.forEach((n, i) => (out[n] = i));
  return out;
})();

/** Map a Telugu/Tamil/Kannada/Malayalam planet name back to its English key ("" if unknown). */
export function southPlanetToEn(name: string | undefined): string {
  return (name && PLANET_TO_EN[name]) || "";
}

/**
 * Localize an English planet / Yogini lord key for a te/ta/kn/ml locale. Unknown
 * keys and other locales return the input unchanged.
 */
export function localizeLord(locale: string | undefined, english: string | undefined): string {
  const en = english ?? "";
  if (!locale) return en;
  return PLANET_NAMES[locale]?.[en] ?? YOGINI_NAMES[locale]?.[en] ?? en;
}

/** Localize an English weekday name for a te/ta/kn/ml locale; others pass through. */
export function localizeWeekday(locale: string | undefined, english: string | undefined): string {
  const en = english ?? "";
  const table = locale ? WEEKDAY_NAMES[locale] : undefined;
  if (!table) return en;
  const i = WEEKDAYS_EN.indexOf(en);
  return i >= 0 ? (table[i] ?? en) : en;
}

/**
 * The lord label a template shows: the API's Devanagari field for hi/mr, the
 * engine's native name for te/ta/kn/ml, else the English key.
 */
export function lordLabel(locale: string | undefined, english: string | undefined, hindi?: string): string {
  if (isDevanagariLocale(locale) && hindi) return hindi;
  if (isSouthLocale(locale)) return localizeLord(locale, english);
  return english ?? "";
}

/** "Table of Contents" heading for the Brihad TOC page, per locale. */
export const TOC_HEADING: Record<string, string> = {
  en: "Table of Contents",
  hi: "विषय-सूची",
  mr: "विषय-सूची",
  te: "విషయ సూచిక",
  ta: "பொருளடக்கம்",
  kn: "ವಿಷಯ ಸೂಚಿ",
  ml: "ഉള്ളടക്കം",
};

/**
 * A Brihad Part heading ("Part 1: …", "भाग 1: …", "భాగం 1: …", "பகுதி 1: …",
 * "ಭಾಗ 1: …", "ഭാഗം 1: …"). \b is ASCII-only and never matches after an Indic letter, so
 * the prefix must be followed by whitespace or a digit instead.
 */
export const PART_PREFIX_RE = /^(part|भाग|భాగం|பகுதி|ಭಾಗ|ഭാഗം)[\s\d]/i;
