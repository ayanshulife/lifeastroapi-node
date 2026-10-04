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
  htmlToPdf,
  type Branding,
} from "../src/pdf/index.js";

const BRANDING: Branding = {
  companyName: "Acme Astro",
  logoUrl: "https://cdn.example/acme/logo.png",
  primaryColor: "#6b21a8",
  secondaryColor: "#9333ea",
  footerText: "Acme Astro · confidential",
  watermarkText: "SAMPLE",
};

const PLACEMENT = { sign: "Leo", dms_within: "06°00'21\"", nakshatra: "Magha", pada: 2, nak_lord: "Ketu" };

// Minimal-but-valid fixtures keyed exactly as the API emits them.
const kundliDetailed = {
  Locale: "en",
  Subject: { Name: "Test Native", BirthDate: "1990-01-15", BirthTime: "10:30 IST", BirthPlace: "Mumbai" },
  Ascendant: PLACEMENT,
  Planets: [{ name: "Sun", placement: PLACEMENT, house_num: 11, retro: false }],
  Panchang: { tithi: "Shukla Tritiya", nakshatra: "Magha", yoga: "Vajra", karana: "Taitila" },
  Narratives: [{ Heading: "Leo Lagna", Body: "Sun-led temperament.", Bullets: ["Leadership"], Citations: ["BPHS"] }],
};

const fixtures: Array<{ name: string; fn: (d: any, b?: Branding) => string; data: any }> = [
  { name: "kundliDetailed", fn: renderKundliDetailedHtml, data: kundliDetailed },
  { name: "kundliLite", fn: renderKundliLiteHtml, data: { Locale: "en", Subject: { Name: "T" }, Ascendant: PLACEMENT, Planets: [{ name: "Sun", placement: PLACEMENT, house_num: 1, retro: false }] } },
  { name: "kundliBrihad", fn: renderKundliBrihadHtml, data: { Locale: "en", Subject: { Name: "T" }, Ascendant: PLACEMENT, Planets: [{ name: "Sun", placement: PLACEMENT, house_num: 1, retro: false }] } },
  { name: "matchMaking", fn: renderMatchMakingHtml, data: { Locale: "en", Boy: { name: "Boy" }, Girl: { name: "Girl" }, Ashtakoota: { Total: 28, Max: 36 } } },
  { name: "dashaAnalysis", fn: renderDashaAnalysisHtml, data: { Locale: "en", Subject: { Name: "T" }, AllMahadashas: [{ Lord: "Ketu", StartDate: "1990", DurationY: 7 }] } },
  { name: "numerology", fn: renderNumerologyHtml, data: { dob: "1990-01-15", driver: 6, conductor: 8 } },
  { name: "sadeSati", fn: renderSadeSatiHtml, data: { Locale: "en", Subject: { Name: "T" } } },
  { name: "varshaphal", fn: renderVarshaphalHtml, data: { Locale: "en", Subject: { Name: "T" }, TargetYear: 2026, Ascendant: PLACEMENT, Planets: [{ name: "Sun", placement: PLACEMENT, house_num: 1, retro: false }], Muntha: { sign: "Leo", house: 1 } } },
  { name: "horoscope", fn: renderHoroscopeHtml, data: { rashi: "Aries", rashi_label: "Aries", period: "daily", period_key: "2026-06-07", language: "en", headline: "Good day", slow_movers: [{ planet: "Jupiter", current_sign: "Cancer", heading: "Jupiter transit", body: "Favorable." }], lucky: { color: "Red", number: 9, direction: "East", time: "06:00-08:00" } } },
  { name: "mangalDosha", fn: renderMangalDoshaHtml, data: { Locale: "en", Subject: { name: "Test", birth_date: "1990-01-15", birth_place: "Mumbai", ascendant_sign: "Leo" }, Status: "purn", HasDosha: true, HousesOccupied: [1, 4, 7], MarsPlacement: { sign: "Aries", dms_within: "10°00'00\"", nakshatra: "Ashwini", pada: 1, nak_lord: "Ketu" } } },
];

describe("report templates", () => {
  for (const { name, fn, data } of fixtures) {
    it(`${name} renders a complete branded HTML document`, () => {
      const html = fn(data, BRANDING);
      expect(html.startsWith("<!doctype html>")).toBe(true);
      expect(html).toContain("</html>");
      // Branding applied:
      expect(html).toContain("--brand-primary: #6b21a8");
      expect(html).toContain("Acme Astro");
      expect(html).toContain("https://cdn.example/acme/logo.png");
      expect(html).toContain("SAMPLE"); // watermark
      expect(html).toContain("Acme Astro · confidential"); // footer
    });
  }

  it("works with no branding (system defaults)", () => {
    const html = renderKundliDetailedHtml(kundliDetailed);
    expect(html).toContain("--brand-primary: #1a1a1a");
    expect(html).toContain("Generated using LifeAstroAPI");
    expect(html).not.toContain("<img"); // no logo when none supplied
  });

  it("HTML-escapes data values (no injection)", () => {
    const html = renderKundliDetailedHtml({
      ...kundliDetailed,
      Subject: { ...kundliDetailed.Subject, Name: "<script>alert(1)</script>" },
    });
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("includes report data (planet, narrative)", () => {
    const html = renderKundliDetailedHtml(kundliDetailed);
    expect(html).toContain("Sun");
    expect(html).toContain("Leo Lagna");
    expect(html).toContain("Shukla Tritiya");
  });
});

// ── Brihad Part 0–7 layout (docs/BRIHAD_PDF_STRUCTURE_PLAN.md) ──────────────
describe("kundliBrihad — Part 0-7 page organization", () => {
  // A fixture exercising one section in each Part, plus the once-each merge
  // pairs (divisional/varshaphal/yoga/dosha) that must NOT scatter.
  const brihad = {
    Locale: "en",
    Subject: { Name: "T", BirthDate: "1986-12-27", BirthTime: "08:14", BirthPlace: "Neemuch" },
    Ascendant: { sign: "Sagittarius", dms_within: "25", nakshatra: "PurvaAshadha", pada: 4 },
    Planets: [{ name: "Sun", name_en: "Sun", house_num: 1, placement: { sign: "Sagittarius", dms_within: "10", nakshatra: "Mula", pada: 1 } }],
    Houses: [{ HouseNum: 1, LordEN: "Jupiter", LordSign: "Aquarius", Body: "x" }],
    Yogas: [{ NameEN: "BudhAditya", Effect: "good" }],
    CurrentDasha: { lord_en: "Saturn", StartDate: "2020", EndDate: "2039", DurationY: 19, Body: "x" },
    Doshas: { KaalSarp: { NameEN: "KaalSarp", Severity: "present", Body: "x" } },
    Predictions: [{ Area: "career", Body: "x" }],
    DivisionalCharts: [{ varga: "D9", name: "Navamsa", subtitle: "s", lagna_sign: "Aries", planets: [] }],
    shadbala: [{ planet: "Sun", total: 300, rank: 1 }],
    varshaphal: [{ year: 2026 }],
    narrative_chapters: [
      { key: "vistrit_bhavishya", title: "Vistrit", sections: [{ heading: "VH", body: "b" }] },
      { key: "lagna", title: "LagnaCh", sections: [{ heading: "LH", body: "b" }] },
      { key: "yogas", title: "YogasCh", sections: [{ heading: "YH", body: "b" }] },
      { key: "varshaphal", title: "VarshaCh", sections: [{ heading: "WH", body: "b" }] },
    ],
    GeneratedAt: "2026-06-30T00:00:00Z",
  };

  const fullHtml = renderKundliBrihadHtml(brihad);
  // Scope to the document body so <h2> mentioned inside <style> comments can't
  // pollute the section list.
  const html = fullHtml.replace(/<style[\s\S]*?<\/style>/gi, "");
  // Decode the few entities our headings can contain so matching is robust.
  const decode = (s: string) => s.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
  // Match both ordinary section headings (<h2>…) and Part banners
  // (<h2 class="part-h2">…), preserving document order.
  const order = [...html.matchAll(/<h2(?:\s+class="[^"]*")?>([\s\S]*?)<\/h2>/g)].map((m) =>
    decode(m[1]!.replace(/<[^>]+>/g, "").trim()),
  );
  // findLastIndex isn't in the lib target — emulate it.
  const idx = (needle: string) => order.findIndex((t) => t.includes(needle));
  const partIdx = (n: number) => order.findIndex((t) => t.startsWith(`Part ${n}:`));

  it("emits the seven Part dividers in order", () => {
    const parts = order.filter((t) => /^Part \d/.test(t));
    expect(parts.length).toBe(7);
    expect(parts[0]).toContain("Foundations");
    expect(parts[6]).toContain("Varshaphal");
    // Strictly ascending Part numbers 1..7.
    expect(parts.map((p) => Number(/Part (\d)/.exec(p)![1]))).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  it("opens with Foundations and ends with Varshaphal (technical before annual)", () => {
    expect(partIdx(1)).toBeLessThan(partIdx(2));
    expect(partIdx(6)).toBeLessThan(partIdx(7));
    // Shadbala (technical) appears in Part 6, after the life reading.
    expect(idx("Shadbala")).toBeGreaterThan(partIdx(6));
    expect(idx("Shadbala")).toBeLessThan(partIdx(7));
  });

  it("places the once-each merge pairs adjacently (no 100-page scatter)", () => {
    // Varshaphal tables + narrative both live in Part 7 (the LAST part).
    expect(idx("Varshaphal (Annual Horoscope)")).toBeGreaterThan(partIdx(7));
    // Yoga short-list ("Yogas Detected") + yoga narrative both in Part 3.
    expect(idx("Yogas Detected")).toBeGreaterThan(partIdx(3));
    expect(idx("Yogas Detected")).toBeLessThan(partIdx(4));
    // Divisional tables live in Part 6 (technical), not scattered to the front.
    expect(idx("Divisional Charts")).toBeGreaterThan(partIdx(6));
    expect(idx("Divisional Charts")).toBeLessThan(partIdx(7));
  });

  it("renders Panchang in Part 1 and Gems in Part 5", () => {
    const withExtras = renderKundliBrihadHtml({
      ...brihad,
      panchang: { tithi: "Shukla Ekadashi", vara: "Saturday", nakshatra: "PurvaAshadha", yoga: "Sukarma", karana: "Bava" },
      gems: { stones: [{ kind: "Life Stone", planet: "Jupiter", stone: "Yellow Sapphire", reason: "Lagna lord" }] },
    });
    const o = [...withExtras.replace(/<style[\s\S]*?<\/style>/gi, "").matchAll(/<h2(?:\s+class="[^"]*")?>([\s\S]*?)<\/h2>/g)]
      .map((m) => m[1]!.replace(/<[^>]+>/g, "").trim());
    const i = (n: string) => o.findIndex((t) => t.includes(n));
    const pi = (n: number) => o.findIndex((t) => t.startsWith(`Part ${n}:`));
    // Panchang under Part 1, before Part 2.
    expect(i("Panchang at Birth")).toBeGreaterThan(pi(1));
    expect(i("Panchang at Birth")).toBeLessThan(pi(2));
    // Gems under Part 5, before Part 6.
    expect(i("Gem Recommendation")).toBeGreaterThan(pi(5));
    expect(i("Gem Recommendation")).toBeLessThan(pi(6));
    expect(withExtras).toContain("Yellow Sapphire");
  });
});

describe("branding sanitization (security)", () => {
  it("rejects CSS-injection in colors and falls back to default", () => {
    const html = renderKundliDetailedHtml(kundliDetailed, {
      primaryColor: "red}body{display:none}*{color:red",
      secondaryColor: "blue;} @import url(http://evil)",
    });
    expect(html).not.toContain("display:none");
    expect(html).not.toContain("@import");
    expect(html).toContain("--brand-primary: #1a1a1a"); // fell back
    expect(html).toContain("--brand-secondary: #666666");
  });

  it("accepts valid color forms (hex 3/4/6/8 / named / rgb)", () => {
    expect(renderKundliDetailedHtml(kundliDetailed, { primaryColor: "#6b21a8" })).toContain("--brand-primary: #6b21a8");
    expect(renderKundliDetailedHtml(kundliDetailed, { primaryColor: "#abcd" })).toContain("--brand-primary: #abcd");
    expect(renderKundliDetailedHtml(kundliDetailed, { primaryColor: "rebeccapurple" })).toContain("--brand-primary: rebeccapurple");
    expect(renderKundliDetailedHtml(kundliDetailed, { primaryColor: "rgb(107, 33, 168)" })).toContain("--brand-primary: rgb(107, 33, 168)");
  });

  it("rejects invalid hex lengths (5/7 digit) and falls back", () => {
    expect(renderKundliDetailedHtml(kundliDetailed, { primaryColor: "#12345" })).toContain("--brand-primary: #1a1a1a");
    expect(renderKundliDetailedHtml(kundliDetailed, { primaryColor: "#1234567" })).toContain("--brand-primary: #1a1a1a");
  });

  it("drops dangerous logo URL schemes, keeps safe ones", () => {
    // dangerous → omitted (no <img>)
    for (const bad of ["javascript:alert(1)", "file:///etc/passwd", "blob:http://x", "data:text/html,<script>"]) {
      expect(renderKundliDetailedHtml(kundliDetailed, { logoUrl: bad })).not.toContain("<img");
    }
    // safe → rendered
    expect(renderKundliDetailedHtml(kundliDetailed, { logoUrl: "https://cdn.x/logo.png" })).toContain(
      '<img src="https://cdn.x/logo.png"',
    );
    expect(renderKundliDetailedHtml(kundliDetailed, { logoUrl: "data:image/png;base64,iVBORw0" })).toContain("<img");
    expect(renderKundliDetailedHtml(kundliDetailed, { logoUrl: "//cdn.x/logo.png" })).toContain("<img");
  });

  it("neutralizes watermark CSS-string break-out (quote / backslash / </style>)", () => {
    const html = renderKundliDetailedHtml(kundliDetailed, { watermarkText: 'X"\\</style><b>' });
    // The raw breakout sequences must not appear; they're CSS-hex-escaped.
    expect(html).not.toContain('"X"\\');
    expect(html).not.toContain("</style><b>");
    expect(html).toContain("\\22 "); // escaped "
    expect(html).toContain("\\5c "); // escaped backslash
    expect(html).toContain("\\3c "); // escaped <
    // The watermark block's own declarations stay intact.
    expect(html).toContain("transform: translate(-50%, -50%) rotate(-30deg)");
  });
});

describe("htmlToPdf", () => {
  it("errors helpfully when puppeteer is unavailable", async () => {
    // puppeteer is an optional peer dep, not installed in CI.
    await expect(htmlToPdf("<!doctype html><html><body>x</body></html>")).rejects.toThrow(/Puppeteer/i);
  });

  it("uses an injected browser/puppeteer (no real Chromium)", async () => {
    let pdfCalled = false;
    const fakePage = {
      setContent: async () => {},
      pdf: async () => {
        pdfCalled = true;
        return new Uint8Array([0x25, 0x50, 0x44, 0x46]); // %PDF
      },
      close: async () => {},
    };
    const fakeBrowser = { newPage: async () => fakePage, close: async () => {} };
    const out = await htmlToPdf("<!doctype html><html></html>", { browser: fakeBrowser });
    expect(pdfCalled).toBe(true);
    expect(Array.from(out.slice(0, 4))).toEqual([0x25, 0x50, 0x44, 0x46]);
  });

  it("does not close a caller-supplied browser (caller owns it)", async () => {
    let closed = false;
    const fakeBrowser = {
      newPage: async () => ({
        setContent: async () => {},
        pdf: async () => new Uint8Array([0x25]),
        close: async () => {},
      }),
      close: async () => {
        closed = true;
      },
    };
    await htmlToPdf("<!doctype html><html></html>", { browser: fakeBrowser });
    expect(closed).toBe(false);
  });
});

describe("sparse / missing data", () => {
  const renderers: Array<[string, (d: any, b?: Branding) => string]> = [
    ["kundliLite", renderKundliLiteHtml],
    ["kundliDetailed", renderKundliDetailedHtml],
    ["kundliBrihad", renderKundliBrihadHtml],
    ["matchMaking", renderMatchMakingHtml],
    ["dashaAnalysis", renderDashaAnalysisHtml],
    ["numerology", renderNumerologyHtml],
    ["sadeSati", renderSadeSatiHtml],
    ["varshaphal", renderVarshaphalHtml],
    ["horoscope", renderHoroscopeHtml],
    ["mangalDosha", renderMangalDoshaHtml],
  ];
  for (const [name, fn] of renderers) {
    it(`${name} renders empty {} input without throwing or leaking undefined/NaN`, () => {
      let html = "";
      expect(() => {
        html = fn({});
      }).not.toThrow();
      expect(html.startsWith("<!doctype html>")).toBe(true);
      expect(html).toContain("</html>");
      expect(html).not.toMatch(/\bundefined\b/);
      expect(html).not.toMatch(/\bNaN\b/);
    });
  }
});

describe("branding precedence", () => {
  const withJsonBranding = {
    ...kundliDetailed,
    Branding: { CompanyName: "JsonCo", PrimaryColor: "#111111", LogoURL: "https://j/l.png" },
  };

  it("uses branding embedded in the report JSON when no override is passed", () => {
    const html = renderKundliDetailedHtml(withJsonBranding);
    expect(html).toContain("JsonCo");
    expect(html).toContain("--brand-primary: #111111");
  });

  it("caller override wins over JSON branding", () => {
    const html = renderKundliDetailedHtml(withJsonBranding, {
      companyName: "OverrideCo",
      primaryColor: "#222222",
    });
    expect(html).toContain("OverrideCo");
    expect(html).not.toContain("JsonCo");
    expect(html).toContain("--brand-primary: #222222");
  });
});

describe("horoscope periods & locale fallback", () => {
  const base = { rashi: "Aries", rashi_label: "Aries", language: "en", slow_movers: [] };

  it("renders the weekly title", () => {
    expect(renderHoroscopeHtml({ ...base, period: "weekly", period_key: "2026-W24" })).toContain("Weekly Horoscope");
  });

  it("renders the monthly title", () => {
    expect(renderHoroscopeHtml({ ...base, period: "monthly", period_key: "2026-06" })).toContain("Monthly Horoscope");
  });

  it("falls back to English headings for an unsupported locale without throwing", () => {
    let html = "";
    expect(() => {
      html = renderHoroscopeHtml({
        ...base,
        period: "daily",
        period_key: "2026-06-17",
        language: "ta",
        slow_movers: [{ planet: "Jupiter", current_sign: "Cancer", heading: "x", body: "y" }],
      });
    }).not.toThrow();
    expect(html).toContain("Transit Influences"); // English chrome fallback
  });
});

describe("mangalDosha template", () => {
  const marsPlacement = { sign: "Scorpio", dms_within: "14°22'10\"", nakshatra: "Anuradha", pada: 2, nak_lord: "Saturn" };
  // A full ("purn") dosha — the heaviest path.
  const base = {
    Locale: "en",
    Subject: { name: "Test Native", birth_date: "1990-01-15", birth_time: "10:30 IST", birth_place: "Mumbai", ascendant_sign: "Leo" },
    Status: "purn",
    HasDosha: true,
    HousesOccupied: [1, 4, 7, 8],
    Cancelled: false,
    CancelReasons: [],
    MarsPlacement: marsPlacement,
    GeneratedAt: "2026-06-20T10:00:00Z",
  };

  it("shows Purn badge, heading, diagnosis and full-dosha remedies", () => {
    const html = renderMangalDoshaHtml(base);
    expect(html).toContain("Full Mangal Dosha"); // purn status badge text
    expect(html).toContain("Mangal Dosha Report");
    expect(html).toContain("1, 4, 7, 8"); // occupied houses in diagnostic + diagnosis
    expect(html).toContain("full form of Mangal Dosha"); // diagnosis prose
    expect(html).toContain("Hanuman Chalisa"); // a remedy actually rendered
    expect(html).toContain("Kumbh Vivah"); // purn-only remedy (proves status→list mapping)
  });

  it("shows the No-Dosha path: green badge, absence diagnosis, none-remedies", () => {
    const html = renderMangalDoshaHtml({
      ...base,
      Status: "none",
      HasDosha: false,
      HousesOccupied: [],
      MarsPlacement: { sign: "Gemini", dms_within: "02°10'00\"", nakshatra: "Ardra", pada: 1, nak_lord: "Rahu" },
    });
    expect(html).toContain("No Mangal Dosha"); // badge
    expect(html).toContain("status-badge none"); // green badge class
    expect(html).toContain("Mars does not occupy"); // absence diagnosis
    expect(html).toContain("no Mangal Dosha-related obstacle"); // marriage prose
    expect(html).toContain("No specific Mars-related remedies"); // none-remedies
    expect(html).toContain("<dd>—</dd>"); // empty houses → fallback dash in the diagnostic
  });

  it("shows the Mild badge for partial dosha", () => {
    const html = renderMangalDoshaHtml({ ...base, Status: "mild", HousesOccupied: [2] });
    expect(html).toContain("Mild Mangal Dosha");
    expect(html).toContain("status-badge mild");
  });

  it("shows the with-cancellation badge + cancellation block when a present dosha is cancelled", () => {
    const html = renderMangalDoshaHtml({
      ...base,
      Cancelled: true,
      CancelReasons: ["Jupiter in 7th cancels Dosha", "Mars in own sign"],
    });
    expect(html).toContain("Mangal Dosha (with cancellation)"); // badge (NOT reached if HasDosha were false)
    expect(html).toContain("status-badge cancelled"); // yellow badge class
    expect(html).toContain("Classical rules indicate"); // cancellation intro
    expect(html).toContain("Jupiter in 7th cancels Dosha"); // reason 1
    expect(html).toContain("Mars in own sign"); // reason 2
    expect(html).toContain("classical cancellation rules apply"); // marriage prose for cancelled
  });

  it("omits the cancellation block when not cancelled", () => {
    const html = renderMangalDoshaHtml(base);
    expect(html).not.toContain("Cancellation</h2>");
    expect(html).not.toContain("class=\"cancellation\"");
  });

  it("formats GeneratedAt as YYYY-MM-DD HH:MM UTC (matches the Go server PDF)", () => {
    const html = renderMangalDoshaHtml(base);
    expect(html).toContain("2026-06-20 10:00 UTC");
    expect(html).not.toContain("2026-06-20T10:00:00Z"); // raw ISO must not leak
  });

  it("shows hindi labels for hi locale", () => {
    const html = renderMangalDoshaHtml({ ...base, Locale: "hi" });
    expect(html).toContain("मंगल दोष रिपोर्ट"); // hi title
    expect(html).toContain("पूर्ण मंगल दोष"); // purn badge in hi
    expect(html).toContain("हनुमान चालीसा"); // hi remedy (proves locale→remedies)
  });

  it("escapes injection in subject name and cancel reasons", () => {
    const html = renderMangalDoshaHtml({
      ...base,
      Subject: { ...base.Subject, name: "<script>x</script>" },
      Cancelled: true,
      CancelReasons: ["<img src=x onerror=alert(1)>"],
    });
    expect(html).not.toContain("<script>x</script>");
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain("<img src=x onerror=alert(1)>");
  });

  it("renders mars placement data", () => {
    const html = renderMangalDoshaHtml(base);
    expect(html).toContain("Scorpio");
    expect(html).toContain("14°22"); // dms_within
    expect(html).toContain("Anuradha");
  });
});

describe("GeneratedAt → YYYY-MM-DD HH:MM UTC (matches Go server PDF, all templates)", () => {
  const ISO = "2026-06-20T10:00:00Z";
  const PRETTY = "2026-06-20 10:00 UTC";

  // Every report template that prints GeneratedAt must format it identically —
  // pretty UTC, never the raw ISO string. (mangalDosha has its own assertion above.)
  const templates: Array<[string, (d: any, b?: Branding) => string, any]> = [
    ["kundliLite", renderKundliLiteHtml, { Locale: "en", Subject: { Name: "T" }, GeneratedAt: ISO }],
    ["kundliDetailed", renderKundliDetailedHtml, { Locale: "en", Subject: { Name: "T" }, GeneratedAt: ISO }],
    ["kundliBrihad", renderKundliBrihadHtml, { Locale: "en", Subject: { Name: "T" }, GeneratedAt: ISO }],
    ["matchMaking", renderMatchMakingHtml, { Locale: "en", Boy: { name: "B" }, Girl: { name: "G" }, GeneratedAt: ISO }],
    ["dashaAnalysis", renderDashaAnalysisHtml, { Locale: "en", Subject: { Name: "T" }, GeneratedAt: ISO }],
    ["numerology", renderNumerologyHtml, { dob: "1990-01-15", GeneratedAt: ISO }],
    ["sadeSati", renderSadeSatiHtml, { Locale: "en", Subject: { name: "T" }, GeneratedAt: ISO }],
    ["varshaphal", renderVarshaphalHtml, { Locale: "en", Subject: { Name: "T" }, TargetYear: 2026, GeneratedAt: ISO }],
  ];

  for (const [name, fn, data] of templates) {
    it(`${name} formats GeneratedAt and never leaks raw ISO`, () => {
      const html = fn(data);
      expect(html).toContain(PRETTY);
      expect(html).not.toContain(ISO);
    });
  }

  it("falls back to the raw string when GeneratedAt is unparseable", () => {
    const html = renderSadeSatiHtml({ Locale: "en", Subject: { name: "T" }, GeneratedAt: "not-a-date" });
    expect(html).toContain("not-a-date");
  });
});

describe("page footer", () => {
  const data = { Subject: { name: "A" }, HasDosha: false, GeneratedAt: "2026-01-01T00:00:00Z" };

  it("prints the footer in the page margin, not as a fixed element over the content", () => {
    const html = renderMangalDoshaHtml(data as never, { footerText: 'Acme "Astro" · confidential' });
    // A position:fixed footer is laid out against the page content box and
    // prints on top of the last lines of body text.
    expect(html).not.toMatch(/footer\s*\{[^}]*position:\s*fixed/);
    expect(html).toContain("@bottom-center");
    // The text is a CSS string: quotes must not be able to break out of it.
    expect(html).not.toContain('content: "Acme "Astro"');
    expect(html).toMatch(/@media print \{ footer \{ display: none; \} \}/);
  });

  it("is left to the Puppeteer footerTemplate for the Brihad report", () => {
    const html = renderKundliBrihadHtml({ Subject: { Name: "A" } } as never, { footerText: "Acme" });
    expect(html).not.toContain("@bottom-center");
  });
});

describe("mangal dosha houses", () => {
  it("names the reference point instead of printing a negative house", () => {
    const html = renderMangalDoshaHtml({
      Subject: { name: "A" }, HasDosha: true, Status: "mild", HousesOccupied: [7, -4],
      MarsPlacement: { sign: "Scorpio" },
    } as never);
    expect(html).toContain("7 from the lagna; 4 from the Moon");
    expect(html).not.toContain("-4");
  });
});
