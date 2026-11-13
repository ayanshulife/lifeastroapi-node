/**
 * Telugu / Tamil / Kannada / Malayalam / Gujarati (own-script) PDF templates.
 *
 * Every template is rendered from a fixture whose data fields are already in
 * the target locale (as the API sends them), then the visible text is checked:
 *  (a) no English label text: once the few known non-label tokens are removed
 *      (subject names, the default footer, "UTC", "SAV", varga codes, the yoga
 *      name the API only sends in English), no Latin word is left;
 *  (b) the right script is present, and no Devanagari leaks in (the API's
 *      LordHI / NameHI fields must not be shown for te/ta/kn).
 */
import { describe, it, expect } from "vitest";
import {
  renderKundliDetailedHtml,
  renderKundliLiteHtml,
  renderKundliBrihadHtml,
  renderMatchMakingHtml,
  renderDashaAnalysisHtml,
  renderNumerologyHtml,
  renderSadeSatiHtml,
  renderVarshaphalHtml,
  renderHoroscopeHtml,
  renderMangalDoshaHtml,
  cleanNarrative,
} from "../src/pdf/index.js";
import { LABELS as DETAILED_LABELS } from "../src/pdf/templates/kundliDetailed.js";
import { LABELS as BRIHAD_LABELS } from "../src/pdf/templates/kundliBrihad.js";
import { LABELS as HOROSCOPE_LABELS } from "../src/pdf/templates/horoscope.js";
import { LABELS as MATCH_LABELS, VERDICT_LABELS } from "../src/pdf/templates/matchMaking.js";
import { LABELS as VARSHA_LABELS } from "../src/pdf/templates/varshaphal.js";
import { BASE_CSS } from "../src/pdf/shared.js";
import { PLANET_NAMES, RASHI_NAMES, WEEKDAY_NAMES, localizeWeekday } from "../src/pdf/locales.js";

type Loc = "te" | "ta" | "kn" | "ml" | "gu";
const LOCALES: Loc[] = ["te", "ta", "kn", "ml", "gu"];

const SCRIPT: Record<Loc, RegExp> = {
  te: /[ఀ-౿]/g,
  ta: /[஀-௿]/g,
  kn: /[ಀ-೿]/g,
  ml: /[ഀ-ൿ]/g,
  gu: /[઀-૿]/g,
};
const DEVANAGARI = /[ऀ-ॿ]/;

/** A short native word used as stand-in body text from the API. */
const WORD: Record<Loc, string> = { te: "నమూనా వాక్యం.", ta: "மாதிரி வாக்கியம்.", kn: "ಮಾದರಿ ವಾಕ್ಯ.", ml: "മാതൃകാ വാക്യം.", gu: "નમૂનાનું વાક્ય." };
/** Yoga / dosha names as the API's NameLocal field sends them. */
const YOGA: Record<Loc, string> = { te: "గజకేసరి యోగం", ta: "கஜகேசரி யோகம்", kn: "ಗಜಕೇಸರಿ ಯೋಗ", ml: "ഗജകേസരി യോഗം", gu: "ગજકેસરી યોગ" };
const NAK: Record<Loc, [string, string]> = {
  te: ["మఖ", "అశ్విని"],
  ta: ["மகம்", "அசுவினி"],
  kn: ["ಮಖ", "ಅಶ್ವಿನಿ"],
  ml: ["മകം", "അശ്വതി"],
  gu: ["મઘા", "અશ્વિની"],
};

/** Tokens that are data or branding, not template labels, and may stay Latin. */
const ALLOWED_LATIN = [
  "Generated using LifeAstroAPI", // default footer (branding, not a label)
  "Arjun Mehta",
  "Priya Sharma",
  "UTC",
  "SAV",
];

function visibleText(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<title>[\s\S]*?<\/title>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&[a-z#0-9]+;/gi, " ");
}

function latinLeft(html: string): string[] {
  let text = visibleText(html);
  for (const tok of ALLOWED_LATIN) text = text.split(tok).join(" ");
  return text.match(/[A-Za-z]{3,}/g) ?? [];
}

function sign(loc: Loc, i: number): string {
  return RASHI_NAMES[loc]![i]!;
}
function planet(loc: Loc, en: string): string {
  return PLANET_NAMES[loc]![en]!;
}

function placement(loc: Loc, signIdx: number) {
  return { sign: sign(loc, signIdx), dms_within: "06°00'21\"", nakshatra: NAK[loc][0], pada: 2, nak_lord: planet(loc, "Ketu") };
}

function planets(loc: Loc) {
  return ["Sun", "Moon", "Mars", "Saturn"].map((en, i) => ({
    name: planet(loc, en),
    name_en: en,
    placement: placement(loc, (4 + i) % 12),
    house_num: i + 1,
    retro: en === "Saturn",
  }));
}

const GENERATED = "2026-10-31T06:40:00Z";

function subjectPascal(loc: Loc) {
  return { Name: "Arjun Mehta", BirthDate: "1990-01-15", BirthTime: "10:30", BirthPlace: WORD[loc] };
}

function dashaPeriod(loc: Loc, lord: string) {
  return { Lord: lord, LordHI: "शनि", StartDate: "2020-01-01", EndDate: "2039-01-01", DurationY: 19, Body: WORD[loc] };
}

function detailedData(loc: Loc) {
  return {
    Locale: loc,
    Subject: subjectPascal(loc),
    Ascendant: placement(loc, 4),
    Planets: planets(loc),
    Panchang: { tithi: WORD[loc], nakshatra: NAK[loc][0], yoga: WORD[loc], karana: WORD[loc] },
    Narratives: [{ Heading: WORD[loc], Body: WORD[loc], Bullets: [WORD[loc]], Citations: [WORD[loc]] }],
    Houses: [{ HouseNum: 1, LordEN: "Sun", LordHI: "सूर्य", LordSign: sign(loc, 4), Body: WORD[loc] }],
    Yogas: [{ NameEN: "Gajakesari Yoga", NameHI: "गजकेसरी योग", NameLocal: YOGA[loc], Effect: WORD[loc], Source: WORD[loc] }],
    CurrentDasha: dashaPeriod(loc, "Saturn"),
    UpcomingDashas: [dashaPeriod(loc, "Mercury")],
    Doshas: { Mangal: { NameEN: "Mangal Dosha", NameHI: "मंगल दोष", Severity: "cancelled", Body: WORD[loc], Source: WORD[loc] } },
    GeneratedAt: GENERATED,
  };
}

function brihadData(loc: Loc) {
  const w = WORD[loc];
  return {
    ...detailedData(loc),
    Remedies: [{ Title: w, Description: w, Category: "mantra" }],
    DivisionalCharts: [
      {
        varga: "D9",
        name: w,
        subtitle: w,
        lagna_sign: sign(loc, 0),
        planets: [{ name: planet(loc, "Sun"), sign: sign(loc, 3), house: 4 }],
      },
    ],
    Doshas: {
      Mangal: { NameEN: "Mangal Dosha", NameHI: "मंगल दोष", Severity: "present", Body: w },
      KaalSarp: { NameEN: "Kaal Sarp Dosha", NameHI: "काल सर्प दोष", Severity: "mild", Body: w },
    },
    Predictions: [{ Area: "career", Body: w }, { Area: "family", Body: w }],
    avakahada: { paya: w, varna: w, vashya: w, yoni: w, gana: w, nadi: w, tatva: w, nakshatra_lord: w, rashi_lord: w, lagna_lord: w },
    panchang: { tithi: w, vara: w, nakshatra: w, yoga: w, karana: w },
    gems: { stones: [{ kind: w, planet: planet(loc, "Sun"), stone: w, reason: w }] },
    ghata_chakra: { weekday: w, tithi_text: w, month: w, nakshatra: w, yoga: w, karana: w, prahar: 2, ghata_rashi: sign(loc, 1) },
    chalit: {
      houses: [{ house: 1, begin_sign: sign(loc, 4), begin_dms: "1°", madhya_sign: sign(loc, 4), madhya_dms: "16°" }],
      planets: [{ name: planet(loc, "Sun"), rashi_house: 1, chalit_house: 2, shifted: true }],
    },
    kp: {
      cusps: [{ house: 1, sign: sign(loc, 4), dms: "1°", star_lord: w, sub_lord: w, sub_sub_lord: w }],
      planet_significators: [{ key: planet(loc, "Sun"), values: [1, 5] }],
      ruling_planets: { lagna_nakshatra_lord: w, day_lord: w },
    },
    jaimini: {
      charakarakas: [{ karaka: w, planet: planet(loc, "Sun") }],
      karakamsa_sign: sign(loc, 2),
      swamsa_sign: sign(loc, 2),
      arudha_padas: [{ label: "A1", name: w, sign: sign(loc, 3), house: 4 }],
    },
    ishta_devata: { deity: w, twelfth_sign: sign(loc, 5), determining_graha: planet(loc, "Venus"), body: w },
    maitri: {
      order: [planet(loc, "Sun")],
      naisargik: [{ planet: planet(loc, "Moon"), relations: { [planet(loc, "Sun")]: w } }],
      tatkalik: [{ planet: planet(loc, "Moon"), relations: { [planet(loc, "Sun")]: w } }],
      panchadha: [{ planet: planet(loc, "Moon"), relations: { [planet(loc, "Sun")]: w } }],
    },
    avasthas: [{ planet: planet(loc, "Sun"), baladi: w, jagradadi: w, deeptadi: w }],
    lal_kitab: { planets: [{ name: planet(loc, "Sun"), house: 1, sign: sign(loc, 0) }], rins: [{ name: w, present: true }] },
    shadbala: [{ planet: planet(loc, "Sun"), total_rupas: 7.2, rank: 1 }],
    bhava_bala: [{ house: 1, bhavadhipati: 1, bhava_dig_bala: 1, bhava_drsti: 1, total: 3 }],
    ashtakavarga: { sav: [28, 30, 25], sav_total: 83, prastar: [{ planet: planet(loc, "Sun"), total: 48 }] },
    varshaphal: [
      {
        year: 2026,
        muntha_sign: sign(loc, 6),
        muntha_house: 7,
        varsha_lord: planet(loc, "Mars"),
        sahams: [{ name: w, sign: sign(loc, 1), dms: "2°", lord: planet(loc, "Venus") }],
        panchavargeeya: [{ planet: planet(loc, "Sun"), vishwa: 12.5 }],
        summary: w,
      },
    ],
    mudda_timeline: {
      year: 2026,
      periods: [{ lord: planet(loc, "Sun"), date_from: "2026-01-15", date_to: "2026-02-02", summary: w, areas: [{ label: w, text: w }], do_label: w, do: w }],
    },
    rajyoga_power: { percent: 62, yoga_count: 3, planets: [planet(loc, "Jupiter")], swarnim_kaal: [{ lord: planet(loc, "Jupiter"), start: "2030", end: "2046" }] },
    narrative_chapters: [
      { key: "vistrit_bhavishya", title: w, sections: [{ Heading: w, Body: w }] },
      { key: "lagna", title: w, sections: [{ Heading: w, Body: w, Bullets: [w] }] },
      { key: "yogas", title: w, sections: [{ Heading: w, Body: w }] },
      { key: "varshaphal", title: w, sections: [{ Heading: w, Body: w }] },
    ],
  };
}

const RENDERERS: Array<{ name: string; render: (loc: Loc) => string }> = [
  { name: "kundliDetailed", render: (loc) => renderKundliDetailedHtml(detailedData(loc)) },
  { name: "kundliBrihad", render: (loc) => renderKundliBrihadHtml(brihadData(loc) as never) },
  {
    name: "kundliLite",
    render: (loc) =>
      renderKundliLiteHtml({ Locale: loc, Subject: subjectPascal(loc), Ascendant: placement(loc, 4), Planets: planets(loc), LagnaSummary: WORD[loc], GeneratedAt: GENERATED }),
  },
  {
    name: "matchMaking",
    render: (loc) =>
      renderMatchMakingHtml({
        Locale: loc,
        Boy: { name: "Arjun Mehta", birth_date: "1990-01-15", birth_time: "10:30", birth_place: WORD[loc], nakshatra: NAK[loc][0] },
        Girl: { name: "Priya Sharma", birth_date: "1992-03-02", birth_time: "06:15", birth_place: WORD[loc], nakshatra: NAK[loc][1] },
        Ashtakoota: { Total: 26, Max: 36, Verdict: "good", Kootas: [{ name: WORD[loc], score: 3, Max: 3, Reason: WORD[loc] }] },
        MangalDoshaBoy: { Computed: true, HasDosha: true, Type: "purn", HousesOccupied: [7, -2], Cancelled: true, CancelReasons: [WORD[loc]] },
        MangalDoshaGirl: { Computed: false },
        NadiDosha: { HasDosha: true, BoyNadi: WORD[loc], GirlNadi: WORD[loc], Severity: "high" },
        FinalVerdict: WORD[loc],
        GeneratedAt: GENERATED,
      }),
  },
  {
    name: "dashaAnalysis",
    render: (loc) =>
      renderDashaAnalysisHtml({
        Locale: loc,
        Subject: subjectPascal(loc),
        ActivePath: {
          Maha: dashaPeriod(loc, "Saturn"),
          Antar: dashaPeriod(loc, "Mercury"),
          Pratyantar: dashaPeriod(loc, "Ketu"),
          Sookshma: dashaPeriod(loc, "Venus"),
          Prana: dashaPeriod(loc, "Sun"),
          MahaBody: WORD[loc],
          AntarBody: WORD[loc],
        },
        AllMahadashas: [dashaPeriod(loc, "Rahu")],
        PastReview: [dashaPeriod(loc, "Jupiter")],
        FuturePreview: [dashaPeriod(loc, "Moon")],
        YoginiDashas: [{ ...dashaPeriod(loc, "Mangala"), LordHI: "मंगला" }],
        GeneratedAt: GENERATED,
      }),
  },
  {
    name: "numerology",
    render: (loc) =>
      renderNumerologyHtml({
        Locale: loc,
        Subject: { Name: "Arjun Mehta", DOB: "1990-01-15" },
        driver: 6,
        conductor: 8,
        soul: 3,
        personality: 5,
        destiny: 11,
        // planet/day arrive in English from the API and are mapped by the SDK.
        driver_factors: { number: 6, planet: "Venus", day: "Friday", color: WORD[loc], gemstone: WORD[loc], deity: WORD[loc], direction: WORD[loc] },
        compatible_drivers: [1, 5, 6],
        GeneratedAt: GENERATED,
      }),
  },
  {
    name: "sadeSati",
    render: (loc) => {
      const win = { StartDate: "2025-03-29", EndDate: "2032-06-02", DurationYears: 7.2, SignsTraversed: [sign(loc, 10), sign(loc, 11)] };
      return renderSadeSatiHtml({
        Locale: loc,
        Subject: { name: "Arjun Mehta", birth_date: "1990-01-15", birth_time: "10:30", birth_place: WORD[loc], moon_sign: sign(loc, 11) },
        CurrentStatus: { status: "peak", saturn_sign: sign(loc, 11), moon_sign: sign(loc, 11) },
        Past: [win],
        Current: win,
        Future: [win],
        GeneratedAt: GENERATED,
      });
    },
  },
  {
    name: "varshaphal",
    render: (loc) =>
      renderVarshaphalHtml({
        Locale: loc,
        Subject: subjectPascal(loc),
        TargetYear: 2026,
        SolarReturnISO: "2026-01-15 03:12",
        Ascendant: placement(loc, 4),
        Planets: planets(loc),
        Muntha: { sign: sign(loc, 5), house: 6 },
        VarshaLord: { name: planet(loc, "Mars"), hora: 3 },
        GeneratedAt: GENERATED,
      } as never),
  },
  {
    name: "horoscope",
    render: (loc) =>
      renderHoroscopeHtml({
        rashi: "aries",
        rashi_label: sign(loc, 0),
        period: "weekly",
        period_key: "2026-W44",
        language: loc,
        headline: WORD[loc],
        slow_movers: [{ planet: planet(loc, "Jupiter"), current_sign: sign(loc, 3), heading: WORD[loc], body: WORD[loc], citations: [WORD[loc]] }],
        panchang: { tithi: WORD[loc], paksha: WORD[loc], nakshatra: NAK[loc][0], yoga: WORD[loc], karana: WORD[loc], vaar: WORD[loc], rahu_kaal: "07:30-09:00", auspicious_window: "11:45-12:30", sunrise: "06:21", sunset: "17:52" },
        lucky: { color: WORD[loc], number: 9, direction: WORD[loc], time: "06:00-08:00" },
      }),
  },
  {
    name: "mangalDosha",
    render: (loc) =>
      renderMangalDoshaHtml({
        Locale: loc,
        Subject: { name: "Arjun Mehta", birth_date: "1990-01-15", birth_time: "10:30", birth_place: WORD[loc], ascendant_sign: sign(loc, 4) },
        Status: "purn",
        HasDosha: true,
        Cancelled: true,
        CancelReasons: [WORD[loc]],
        HousesOccupied: [1, -4],
        MarsPlacement: placement(loc, 0),
        GeneratedAt: GENERATED,
      }),
  },
];

describe("PDF templates render fully in te / ta / kn / ml / gu", () => {
  for (const { name, render } of RENDERERS) {
    for (const loc of LOCALES) {
      it(`${name} [${loc}]: no English labels, ${loc} script, no Devanagari`, () => {
        const html = render(loc);
        expect(html.startsWith("<!doctype html>")).toBe(true);
        expect(html).toContain(`<html lang="${loc}">`);
        expect(latinLeft(html)).toEqual([]);
        const text = visibleText(html);
        // Plenty of the target script, none of the other two south scripts.
        expect((text.match(SCRIPT[loc]) ?? []).length).toBeGreaterThan(40);
        for (const other of LOCALES.filter((l) => l !== loc)) {
          expect(text.match(SCRIPT[other]) ?? []).toEqual([]);
        }
        expect(DEVANAGARI.test(text)).toBe(false);
      });
    }
  }
});

describe("south-locale label maps are complete", () => {
  const maps: Array<[string, Record<string, Record<string, string>>]> = [
    ["kundliDetailed", DETAILED_LABELS],
    ["kundliBrihad", BRIHAD_LABELS],
    ["horoscope", HOROSCOPE_LABELS],
    ["matchMaking", MATCH_LABELS],
    ["matchMaking verdicts", VERDICT_LABELS],
    ["varshaphal", VARSHA_LABELS],
  ];
  for (const [name, map] of maps) {
    for (const loc of LOCALES) {
      it(`${name} [${loc}] has every English key, non-empty, no em dash`, () => {
        const en = map.en!;
        const table = map[loc]!;
        expect(table).toBeDefined();
        const missing = Object.keys(en).filter((k) => !table[k]);
        expect(missing).toEqual([]);
        const dashed = Object.entries(table).filter(([, v]) => /[—–]/.test(v));
        expect(dashed).toEqual([]);
      });
    }
  }
});

describe("south-locale specifics", () => {
  it("Tamil never calls a house பாவம்", () => {
    for (const { render } of RENDERERS) expect(visibleText(render("ta"))).not.toContain("பாவம்");
  });

  it("dasha lords use the engine's native names, not the Hindi field", () => {
    const te = RENDERERS.find((r) => r.name === "dashaAnalysis")!.render("te");
    expect(te).toContain("శని"); // Saturn
    expect(te).toContain("మంగళా"); // Yogini Mangala
    const ta = RENDERERS.find((r) => r.name === "dashaAnalysis")!.render("ta");
    expect(ta).toContain("புக்தி"); // Antardasha as Tamil readers say it
  });

  it("Brihad charts resolve te/ta/kn sign names and use native chart abbreviations", () => {
    const html = RENDERERS.find((r) => r.name === "kundliBrihad")!.render("te");
    expect((html.match(/class="north-chart"/g) ?? []).length).toBeGreaterThanOrEqual(2);
    expect(html).toContain(">సూ<"); // Sun's chart label
    expect(html).toContain("భాగం 1:"); // Part banner
  });

  it("numerology maps English planet/day factors to native names", () => {
    const kn = RENDERERS.find((r) => r.name === "numerology")!.render("kn");
    expect(kn).toContain("ಶುಕ್ರ");
    expect(kn).toContain("ಶುಕ್ರವಾರ");
  });

  it("weekday names never equal a planet name (ta புதன் / ml ബുധൻ are planets)", () => {
    for (const loc of LOCALES) {
      const days = WEEKDAY_NAMES[loc]!;
      expect(days).toHaveLength(7);
      expect(new Set(days).size).toBe(7);
      const planets = new Set(Object.values(PLANET_NAMES[loc]!));
      for (const d of days) expect(planets.has(d), `${loc} weekday ${d}`).toBe(false);
    }
    expect(localizeWeekday("ta", "Wednesday")).toBe("புதன்கிழமை");
  });

  it("Malayalam: Kerala sign names, full weekday names, native chart labels and Part banner", () => {
    const num = RENDERERS.find((r) => r.name === "numerology")!.render("ml");
    expect(num).toContain("ശുക്രൻ");
    expect(num).toContain("വെള്ളിയാഴ്ച");
    const brihad = RENDERERS.find((r) => r.name === "kundliBrihad")!.render("ml");
    expect((brihad.match(/class="north-chart"/g) ?? []).length).toBeGreaterThanOrEqual(2);
    expect(brihad).toContain(">സൂ<");
    expect(brihad).toContain("ഭാഗം 1:");
    const dasha = RENDERERS.find((r) => r.name === "dashaAnalysis")!.render("ml");
    expect(dasha).toContain("ശനി");
    expect(dasha).toContain("മംഗള");
  });

  it("Gujarati: engine sign/planet names, full weekday names, native chart labels and Part banner", () => {
    const num = RENDERERS.find((r) => r.name === "numerology")!.render("gu");
    expect(num).toContain("શુક્ર");
    expect(num).toContain("શુક્રવાર");
    const brihad = RENDERERS.find((r) => r.name === "kundliBrihad")!.render("gu");
    expect((brihad.match(/class="north-chart"/g) ?? []).length).toBeGreaterThanOrEqual(2);
    expect(brihad).toContain(">સૂ<");
    expect(brihad).toContain("ભાગ 1:");
    expect(brihad).not.toContain("ज्योतिषी");
    const dasha = RENDERERS.find((r) => r.name === "dashaAnalysis")!.render("gu");
    expect(dasha).toContain("શનિ");
    expect(dasha).toContain("મંગલા");
    // Gujarati reader register is આપ; never તમે / તું.
    for (const { render } of RENDERERS) {
      const text = visibleText(render("gu"));
      // Explicit Gujarati-letter boundaries: \b is ASCII-only, and તું is inside હોતું.
      expect(text).not.toMatch(/(?<![઀-૿])(તમે|તમારું|તમારી|તમારા|તમને|તું|તારું|તારી|તને)(?![઀-૿])/);
    }
  });

  it("font stacks cover Telugu, Tamil, Kannada and Malayalam everywhere a font is set", () => {
    const html = RENDERERS.find((r) => r.name === "kundliDetailed")!.render("kn");
    const stacks = [...html.matchAll(/font-family:\s*([^;}"]+)/g)].map((m) => m[1]!);
    expect(stacks.length).toBeGreaterThan(1);
    for (const s of stacks) {
      if (/inherit/.test(s)) continue;
      expect(s).toContain("Noto Sans Telugu");
      expect(s).toContain("Noto Sans Tamil");
      expect(s).toContain("Noto Sans Kannada");
      expect(s).toContain("Noto Sans Malayalam");
      expect(s).toContain("Noto Sans Gujarati");
    }
    expect(BASE_CSS).toMatch(/:where\(html:lang\(te\), html:lang\(ta\), html:lang\(kn\), html:lang\(ml\)\) body/);
  });

  it("cleanNarrative leaves te/ta/kn prose untouched (no English 'native' rewrite)", () => {
    const s = "native ನಮೂನೆ";
    expect(cleanNarrative(s, "kn")).toBe(s);
    expect(cleanNarrative("మీరు native", "te")).toBe("మీరు native");
  });
});

describe("API NameLocal / LordLocal fields", () => {
  const base = {
    Subject: { Name: "Arjun Mehta" },
    Houses: [{ HouseNum: 1, LordEN: "Sun", LordHI: "सूर्य", LordLocal: "LOCAL_HOUSE_LORD" }],
    Yogas: [{ NameEN: "Gajakesari Yoga", NameHI: "गजकेसरी योग", NameLocal: "LOCAL_YOGA", Effect: "x" }],
    CurrentDasha: { Lord: "Saturn", LordHI: "शनि", LordLocal: "LOCAL_DASHA_LORD", StartDate: "2020", EndDate: "2039", DurationY: 19 },
    Doshas: { Mangal: { NameEN: "Mangal Dosha", NameHI: "मंगल दोष", NameLocal: "LOCAL_DOSHA", Severity: "present", Body: "x" } },
  };

  for (const loc of ["hi", "te", "ta", "kn"]) {
    it(`are preferred when present [${loc}] (Detailed + Brihad)`, () => {
      for (const html of [
        renderKundliDetailedHtml({ ...base, Locale: loc }),
        renderKundliBrihadHtml({ ...base, Locale: loc } as never),
      ]) {
        expect(html).toContain("LOCAL_HOUSE_LORD");
        expect(html).toContain("LOCAL_YOGA");
        expect(html).toContain("LOCAL_DASHA_LORD");
        expect(html).toContain("LOCAL_DOSHA");
        expect(html).not.toContain("Gajakesari Yoga");
      }
    });
  }

  it("Dasha Analysis prefers LordLocal on every period list", () => {
    const p = (lord: string) => ({ Lord: lord, LordHI: "शनि", LordLocal: `LOCAL_${lord}`, StartDate: "2020", EndDate: "2039", DurationY: 19 });
    const html = renderDashaAnalysisHtml({
      Locale: "te",
      ActivePath: { Maha: p("Saturn"), Antar: p("Mercury") },
      AllMahadashas: [p("Rahu")],
      PastReview: [p("Jupiter")],
      FuturePreview: [p("Moon")],
      YoginiDashas: [p("Mangala")],
    });
    for (const l of ["Saturn", "Mercury", "Rahu", "Jupiter", "Moon", "Mangala"]) expect(html).toContain(`LOCAL_${l}`);
  });

  it("falls back to the old logic when the fields are absent", () => {
    const old = { ...base, Locale: "te", Houses: [{ HouseNum: 1, LordEN: "Sun", LordHI: "सूर्य" }], Yogas: [{ NameEN: "Gajakesari Yoga", NameHI: "गजकेसरी योग", Effect: "x" }], CurrentDasha: { Lord: "Saturn", LordHI: "शनि", StartDate: "2020", EndDate: "2039", DurationY: 19 }, Doshas: { Mangal: { Severity: "present", Body: "x" } } };
    const html = renderKundliDetailedHtml(old);
    expect(html).toContain("సూర్యుడు");
    expect(html).toContain("శని");
    expect(html).toContain("Gajakesari Yoga"); // older API: no te name available
    expect(html).toContain("కుజ దోషం");
    expect(html).not.toMatch(/सूर्य|शनि|गजकेसरी/); // NameHI/LordHI never shown for te
  });

  it("en output is unchanged (no Local fields are sent for en)", () => {
    const en = { ...base, Locale: "en", Houses: [{ HouseNum: 1, LordEN: "Sun", LordHI: "सूर्य" }], Yogas: [{ NameEN: "Gajakesari Yoga", NameHI: "गजकेसरी योग", Effect: "x" }], CurrentDasha: { Lord: "Saturn", LordHI: "शनि", StartDate: "2020", EndDate: "2039", DurationY: 19 }, Doshas: { Mangal: { Severity: "present", Body: "x" } } };
    const html = renderKundliDetailedHtml(en);
    expect(html).toContain("Lord: Sun");
    expect(html).toContain("Gajakesari Yoga");
    expect(html).toContain(">Saturn<");
    expect(html).toContain(">Mangal Dosha<");
  });
});
