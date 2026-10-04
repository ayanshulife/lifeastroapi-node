/**
 * Brihad Kundli — renderers for the deep classical sections + corpus-backed
 * narrative chapters (the content that takes the report to 290+ pages).
 *
 * These consume the snake_case JSON keys emitted by the Go C-series structs
 * (internal/pdf/brihad_csections.go) and the narrative chapters
 * (BrihadNarrativeChapter). Kept separate from kundliBrihad.ts so the main
 * template stays readable; the main render fn imports renderBrihadDeepSections
 * and splices its output into the document body.
 */

import { esc, escBody, resolveBranding, type Branding, type RawBranding } from "../shared.js";
import {
  northIndianChartSvg,
  PLANET_LABELS_EN,
  PLANET_LABELS_HI,
  PLANET_COLORS,
  type ChartPlanet,
} from "./northIndianChart.js";
import { planetGlyph } from "./planetGlyphs.js";

/**
 * "Graha Sthiti" planet-cards grid — each graha as a card with its glyph
 * image, name, sign and nakshatra. Mirrors the benchmark's image-rich planet
 * page. `planets` is data.Planets (PascalCase name + placement.*).
 */
export function renderGrahaSthiti(
  planets: { name?: string; name_en?: string; placement?: { sign?: string; nakshatra?: string }; retro?: boolean }[],
  title: string,
): string {
  if (!Array.isArray(planets) || planets.length === 0) return "";
  const cards = planets
    .map((p) => {
      const glyph = planetGlyph(p.name_en ?? p.name);
      if (!glyph) return "";
      const pl = p.placement ?? {};
      const retro = p.retro ? ' <span style="color:#c0392b;">(R)</span>' : "";
      return `<div class="graha-card">
  <div class="graha-glyph">${glyph}</div>
  <div class="graha-info">
    <div class="graha-name">${esc(p.name)}${retro}</div>
    <div class="graha-pos">${esc(pl.sign)}</div>
    <div class="graha-nak">${esc(pl.nakshatra)}</div>
  </div>
</div>`;
    })
    .filter(Boolean)
    .join("\n");
  if (!cards) return "";
  return `<section class="section graha-sthiti-section">
<h2>${esc(title)}</h2>
<div class="graha-grid">${cards}</div>
</section>`;
}

// ── North-Indian chart glue ─────────────────────────────────────────────────

// Sign-name → 0-based index. Includes EN + Hindi/Marathi names so charts
// resolve regardless of the report locale (HI JSON emits "धनु" not
// "Sagittarius"). Devanagari sign names are shared across hi/mr.
const SIGN_INDEX: Record<string, number> = {
  Aries: 0, Taurus: 1, Gemini: 2, Cancer: 3, Leo: 4, Virgo: 5,
  Libra: 6, Scorpio: 7, Sagittarius: 8, Capricorn: 9, Aquarius: 10, Pisces: 11,
  // Hindi / Marathi
  "मेष": 0, "वृषभ": 1, "मिथुन": 2, "कर्क": 3, "सिंह": 4, "कन्या": 5,
  "तुला": 6, "वृश्चिक": 7, "धनु": 8, "मकर": 9, "कुम्भ": 10, "कुंभ": 10, "मीन": 11,
};

// Hindi/Marathi planet name → canonical English key, so charts resolve even
// when the JSON localised the divisional planet names (e.g. "सूर्य").
const PLANET_NAME_TO_EN: Record<string, string> = {
  "सूर्य": "Sun", "चंद्र": "Moon", "चन्द्र": "Moon", "मंगल": "Mars", "बुध": "Mercury",
  "गुरु": "Jupiter", "बृहस्पति": "Jupiter", "शुक्र": "Venus", "शनि": "Saturn",
  "राहु": "Rahu", "केतु": "Ketu",
};

/** Build ChartPlanet[] from {name, house} rows, labelled for the locale. */
function chartPlanets(rows: { name?: string; house?: number; retro?: boolean }[], locale: string): ChartPlanet[] {
  const labels = locale === "hi" || locale === "mr" ? PLANET_LABELS_HI : PLANET_LABELS_EN;
  const out: ChartPlanet[] = [];
  for (const r of rows) {
    const raw = r.name ?? "";
    // Normalise to the English key whether the JSON gave EN or Devanagari.
    const key = PLANET_LABELS_EN[raw] ? raw : PLANET_NAME_TO_EN[raw] ?? raw;
    const lbl = labels[key];
    if (!lbl || !r.house) continue;
    out.push({ label: lbl, house: r.house, retro: r.retro, color: PLANET_COLORS[key] });
  }
  return out;
}

/**
 * Render a North-Indian diamond chart from a lagna sign NAME + planet rows.
 * Returns "" if the lagna sign is unknown.
 */
export function renderNorthChart(
  lagnaSign: string | undefined,
  rows: { name?: string; house?: number; retro?: boolean }[],
  title: string,
  locale: string,
  accent: string,
  size = 210,
): string {
  const idx = SIGN_INDEX[lagnaSign ?? ""];
  if (idx === undefined) return "";
  return northIndianChartSvg({
    lagnaSignIndex: idx,
    planets: chartPlanets(rows, locale),
    title,
    size,
    accent,
  });
}

// ── Running header / footer (Puppeteer margin-box templates) ────────────────
// Rendered in the page margin (OUTSIDE the content box) so they can NEVER
// overlap body content — the fix for the old position:fixed footer collision.
// Chromium ignores external CSS here, so everything is inline-styled, and font
// sizes must be set explicitly (Chromium defaults header/footer to ~10px).

/** Page margins that reserve room for the running header + footer. */
export const BRIHAD_PDF_MARGIN = { top: "26mm", bottom: "16mm", left: "0mm", right: "0mm" };

// ── Table of contents (विषय-सूची) — 2-pass page resolution ──────────────────

/**
 * Tag each top-level `<section class="section...">` with a `data-toc-title`
 * read from its first `<h2>`, so measureTocEntries can locate it. Returns the
 * mutated HTML + the ordered list of titles found.
 */
export function tagBrihadSectionsForToc(html: string): { html: string; titles: string[] } {
  const titles: string[] = [];
  const unescape = (s: string): string =>
    s
      .replace(/<[^>]+>/g, "")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .trim();
  // Invisible page-locator marker (white, ~1px): tocPagesFromPdf() scans page
  // text for ⟦T<idx>⟧ to resolve the exact page each TOC entry lands on.
  const marker = (idx: number) => `<span style="color:#fff;font-size:1px;">⟦T${idx}⟧</span>`;

  // Match each top-level section, OPTIONALLY preceded (inside it) by a Part
  // banner div. The Part banner (level-1) and the section heading (level-2)
  // both become TOC entries; the marker for the FIRST goes at the very top of
  // the section so both resolve to that section's opening page.
  const tagged = html.replace(
    /<section class="section([^"]*)">\s*(?:<div class="part-banner"><h2 class="part-h2">([\s\S]*?)<\/h2><\/div>\s*)?<h2>([\s\S]*?)<\/h2>/g,
    (_m, cls: string, partInner: string | undefined, inner: string) => {
      let out = `<section class="section${cls}"`;
      let firstMarker = "";
      let dataAttr = "";

      if (partInner !== undefined) {
        // Part banner → a level-1 TOC entry.
        const partTitle = unescape(partInner);
        const pIdx = titles.length;
        titles.push(partTitle);
        firstMarker += marker(pIdx);
        dataAttr = ` data-toc-title="${partTitle.replace(/"/g, "&quot;")}"`;
      }

      // The section heading → a level-2 TOC entry.
      const title = unescape(inner);
      const sIdx = titles.length;
      titles.push(title);
      firstMarker += marker(sIdx);
      if (!dataAttr) dataAttr = ` data-toc-title="${title.replace(/"/g, "&quot;")}"`;

      out += `${dataAttr}>${firstMarker}`;
      if (partInner !== undefined) {
        out += `<div class="part-banner"><h2 class="part-h2">${partInner}</h2></div>`;
      }
      out += `<h2>${inner}</h2>`;
      return out;
    },
  );
  return { html: tagged, titles };
}

/** Regex to find a section marker token (⟦T<idx>⟧) in extracted PDF text. */
export const TOC_MARKER_RE = /⟦T(\d+)⟧/g;

const TOC_PALETTE = [
  "#c25e10", "#9e2b25", "#b8860b", "#8a3324", "#9c6f1e",
  "#b5471f", "#a8451a", "#8a5a00", "#c0631e",
];

/**
 * Build the विषय-सूची / Table-of-Contents section HTML from measured entries.
 * Page numbers are color-coded (rotating palette) like the benchmark. The TOC
 * is itself a `.section` (starts on its own page right after the cover).
 */
export function buildBrihadToc(entries: { title: string; page: number }[], heading: string): string {
  if (!entries.length) return "";
  const rows = entries
    .map((e, i) => {
      const col = TOC_PALETTE[i % TOC_PALETTE.length];
      // Part dividers ("Part N: …" / "भाग N: …") are level-1 rows: bold,
      // not indented. Everything else is a level-2 section, indented under it.
      // (\b is ASCII-only — won't match after Devanagari — so match by the
      // following whitespace/digit instead.)
      const isPart = /^(part|भाग)[\s\d]/i.test(e.title.trim());
      const cls = isPart ? "toc-row toc-part" : "toc-row toc-sub";
      return `<div class="${cls}">
  <span class="toc-title">${esc(e.title)}</span>
  <span class="toc-dots"></span>
  <span class="toc-page" style="color:${col};">${e.page}</span>
</div>`;
    })
    .join("\n");
  return `<section class="section toc-section">
<div class="toc-banner">${esc(heading)}</div>
${rows}
</section>`;
}

/** Running header: minimal page number (left) + company wordmark (right). */
export function brihadHeaderTemplate(branding?: Branding | RawBranding): string {
  const b = resolveBranding(branding as RawBranding);
  const company = esc(b.companyName) || "LifeAstro";
  // Clean, ornamental page number — a gold ✦ + purple number (no heavy box),
  // matching the header/footer star motif. Right: gold ✦ + purple wordmark.
  return `<div style="width:100%;font-family:Arial,sans-serif;-webkit-print-color-adjust:exact;padding:8mm 14mm 0;">
  <div style="display:flex;align-items:center;justify-content:space-between;border-bottom:0.35mm solid #e3d9c0;padding-bottom:2mm;">
    <div style="color:#9e2b25;font-size:12px;font-weight:bold;letter-spacing:.5px;">
      <span style="color:#c25e10;">✦</span>&nbsp;<span class="pageNumber"></span>
    </div>
    <div style="color:#9e2b25;font-weight:bold;font-size:13px;letter-spacing:.4px;">
      <span style="color:#c25e10;">✦</span> ${company}
    </div>
  </div>
</div>`;
}

/** Running footer: colorful dotted squares flanking the website / footer text. */
export function brihadFooterTemplate(branding?: Branding | RawBranding): string {
  const b = resolveBranding(branding as RawBranding);
  const txt = esc(b.footerText) || "www.lifeastroapi.com";
  // LifeAstro footer motif: a gold ✦ diamond flourish on each side of the
  // url (purple text) — not the benchmark's colored-square trio.
  const star = `<span style="color:#c25e10;font-size:10px;">✦</span><span style="color:#9e2b25;font-size:7px;">✦</span>`;
  return `<div style="width:100%;font-family:Arial,sans-serif;-webkit-print-color-adjust:exact;
              text-align:center;font-size:9px;color:#9e2b25;padding-bottom:5mm;">
  ${star}<span style="margin:0 5mm;letter-spacing:.3px;">${txt}</span>${star}
</div>`;
}


// ── New-section data shapes (JSON keys exactly as Go emits) ─────────────────

export interface BrihadNarrativeSection {
  Heading?: string;
  Body?: string;
  Bullets?: string[] | null;
  Citations?: string[] | null;
}
export interface BrihadNarrativeChapter {
  key?: string;
  title?: string;
  sections?: BrihadNarrativeSection[];
}

export interface BrihadAvakahada {
  paya?: string; varna?: string; vashya?: string; yoni?: string; gana?: string;
  nadi?: string; tatva?: string; nakshatra_lord?: string; rashi_lord?: string; lagna_lord?: string;
}
export interface BrihadGhata {
  weekday?: string; tithi_text?: string; month?: string; nakshatra?: string;
  yoga?: string; karana?: string; prahar?: number; ghata_rashi?: string;
}
export interface BrihadChalit {
  houses?: { house?: number; begin_sign?: string; begin_dms?: string; madhya_sign?: string; madhya_dms?: string }[];
  planets?: { name?: string; rashi_house?: number; chalit_house?: number; shifted?: boolean }[];
}
export interface BrihadKP {
  cusps?: { house?: number; sign?: string; dms?: string; star_lord?: string; sub_lord?: string; sub_sub_lord?: string }[];
  planet_significators?: { key?: string; values?: number[] }[];
  house_significators?: { house?: number; planets?: string[] }[];
  ruling_planets?: Record<string, string>;
}
export interface BrihadJaimini {
  charakarakas?: { karaka?: string; planet?: string }[];
  karakamsa_sign?: string; swamsa_sign?: string;
  arudha_padas?: { label?: string; name?: string; sign?: string; house?: number }[];
}
export interface BrihadIshtaDevata { deity?: string; twelfth_sign?: string; determining_graha?: string; body?: string }
export interface BrihadMaitriRow { planet?: string; relations?: Record<string, string> }
export interface BrihadMaitri {
  order?: string[]; naisargik?: BrihadMaitriRow[]; tatkalik?: BrihadMaitriRow[]; panchadha?: BrihadMaitriRow[];
}
export interface BrihadAvastha { planet?: string; baladi?: string; jagradadi?: string; deeptadi?: string }
export interface BrihadLalKitab {
  planets?: { name?: string; house?: number; sign?: string }[];
  rins?: { name?: string; present?: boolean; body?: string }[];
  teva?: { name?: string; present?: boolean }[];
}
export interface BrihadShadbalaRow { planet?: string; total_rupas?: number; rank?: number }
export interface BrihadBhavaBalaRow {
  house?: number; bhavadhipati?: number; bhava_dig_bala?: number; bhava_drsti?: number; total?: number;
}
export interface BrihadAshtakavarga {
  sav?: number[]; sav_total?: number;
  prastar?: { planet?: string; contributors?: string[]; grid?: number[][]; per_sign?: number[]; total?: number }[];
}
export interface BrihadVarshaphalYear {
  year?: number; muntha_sign?: string; muntha_house?: number; varsha_lord?: string;
  sahams?: { name?: string; sign?: string; dms?: string; lord?: string; verified?: boolean }[];
  panchavargeeya?: { planet?: string; vishwa?: number }[];
  summary?: string;
}
export interface BrihadRajyogaPower {
  percent?: number; yoga_count?: number; planets?: string[];
  swarnim_kaal?: { lord?: string; start?: string; end?: string }[];
}
export interface BrihadMuddaArea { label?: string; text?: string }
export interface BrihadMuddaPeriod {
  lord?: string; date_from?: string; date_to?: string; summary?: string;
  areas?: BrihadMuddaArea[];
  do_label?: string; do?: string; avoid_label?: string; avoid?: string;
  remedy_label?: string; remedy?: string;
}
export interface BrihadMuddaTimeline {
  year?: number; heading?: string; periods?: BrihadMuddaPeriod[];
}

/** Container of the new fields, mixed into KundliBrihadData. */
export interface BrihadPanchang {
  tithi?: string; vara?: string; nakshatra?: string; yoga?: string; karana?: string;
}
export interface BrihadGemstone { kind?: string; planet?: string; stone?: string; reason?: string }
export interface BrihadGems { stones?: BrihadGemstone[] }

export interface BrihadDeepData {
  schema_version?: number;
  avakahada?: BrihadAvakahada | null;
  panchang?: BrihadPanchang | null;
  gems?: BrihadGems | null;
  ghata_chakra?: BrihadGhata | null;
  chalit?: BrihadChalit | null;
  kp?: BrihadKP | null;
  jaimini?: BrihadJaimini | null;
  ishta_devata?: BrihadIshtaDevata | null;
  maitri?: BrihadMaitri | null;
  avasthas?: BrihadAvastha[];
  lal_kitab?: BrihadLalKitab | null;
  shadbala?: BrihadShadbalaRow[];
  bhava_bala?: BrihadBhavaBalaRow[];
  ashtakavarga?: BrihadAshtakavarga | null;
  varshaphal?: BrihadVarshaphalYear[];
  mudda_timeline?: BrihadMuddaTimeline | null;
  rajyoga_power?: BrihadRajyogaPower | null;
  narrative_chapters?: BrihadNarrativeChapter[];
}

// ── Small helpers ───────────────────────────────────────────────────────────

type L = (k: string) => string;
const yesNo = (label: L, v?: boolean) => esc(label(v ? "lk_present" : "lk_absent"));

function table(headers: string[], rows: string[]): string {
  return `<table>
<thead><tr>${headers.map((h) => `<th>${esc(h)}</th>`).join("")}</tr></thead>
<tbody>
${rows.join("\n")}
</tbody>
</table>`;
}

/** Render one narrative chapter (heading + body + bullets per section). */
export function renderChapter(ch: BrihadNarrativeChapter, locale = "en"): string {
  const secs = Array.isArray(ch.sections) ? ch.sections : [];
  if (secs.length === 0) return "";
  const blocks = secs
    .map((s) => {
      const heading = s.Heading ? `<h3>${esc(s.Heading)}</h3>` : "";
      const body = s.Body ? `<p>${escBody(s.Body, locale)}</p>` : "";
      const bullets =
        Array.isArray(s.Bullets) && s.Bullets.length
          ? `<ul>${s.Bullets.map((x) => `<li>${escBody(x, locale)}</li>`).join("")}</ul>`
          : "";
      return `${heading}${body}${bullets}`;
    })
    .join("\n");
  return `<section class="section narrative-chapter">
<h2>${esc(ch.title || ch.key || "")}</h2>
${blocks}
</section>`;
}

// ── Section renderers ───────────────────────────────────────────────────────

function renderAvakahada(label: L, a?: BrihadAvakahada | null): string {
  if (!a) return "";
  const rows: [string, string | undefined][] = [
    ["avk_paya", a.paya], ["avk_varna", a.varna], ["avk_vashya", a.vashya],
    ["avk_yoni", a.yoni], ["avk_gana", a.gana], ["avk_nadi", a.nadi],
    ["avk_tatva", a.tatva], ["avk_nak_lord", a.nakshatra_lord],
    ["avk_rashi_lord", a.rashi_lord], ["avk_lagna_lord", a.lagna_lord],
  ];
  const body = rows
    .filter(([, v]) => v)
    .map(([k, v]) => `<tr><td><strong>${esc(label(k))}</strong></td><td>${esc(v)}</td></tr>`)
    .join("\n");
  if (!body) return "";
  return `<section class="section">
<h2>${esc(label("section_avakahada"))}</h2>
<table><tbody>${body}</tbody></table>
</section>`;
}

function renderPanchang(label: L, p?: BrihadPanchang | null): string {
  if (!p) return "";
  const rows: [string, string | undefined][] = [
    ["panchang_tithi", p.tithi], ["panchang_vara", p.vara],
    ["panchang_nakshatra", p.nakshatra], ["panchang_yoga", p.yoga],
    ["panchang_karana", p.karana],
  ];
  const body = rows
    .filter(([, v]) => v)
    .map(([k, v]) => `<tr><td><strong>${esc(label(k))}</strong></td><td>${esc(v)}</td></tr>`)
    .join("\n");
  if (!body) return "";
  return `<section class="section">
<h2>${esc(label("section_panchang"))}</h2>
<p>${esc(label("panchang_intro"))}</p>
<table><tbody>${body}</tbody></table>
</section>`;
}

function renderGems(label: L, g?: BrihadGems | null): string {
  const stones = g?.stones ?? [];
  if (!stones.length) return "";
  const rows = stones
    .map(
      (s) => `<tr><td><strong>${esc(s.kind)}</strong></td><td>${esc(s.stone)}</td><td>${esc(s.planet)}</td><td>${esc(s.reason)}</td></tr>`,
    )
    .join("\n");
  return `<section class="section">
<h2>${esc(label("section_gems"))}</h2>
<p>${esc(label("gems_intro"))}</p>
<table><thead><tr>
<th>${esc(label("gems_kind"))}</th><th>${esc(label("gems_stone"))}</th>
<th>${esc(label("gems_planet"))}</th><th>${esc(label("gems_reason"))}</th>
</tr></thead><tbody>${rows}</tbody></table>
<p class="gems-note">${esc(label("gems_note"))}</p>
</section>`;
}

function renderGhata(label: L, g?: BrihadGhata | null): string {
  if (!g) return "";
  const rows: [string, string | number | undefined][] = [
    ["ghata_weekday", g.weekday], ["ghata_tithi", g.tithi_text], ["ghata_month", g.month],
    ["ghata_nakshatra", g.nakshatra], ["ghata_yoga", g.yoga], ["ghata_karana", g.karana],
    ["ghata_prahar", g.prahar], ["ghata_rashi", g.ghata_rashi],
  ];
  const body = rows
    .filter(([, v]) => v !== undefined && v !== "")
    .map(([k, v]) => `<tr><td><strong>${esc(label(k))}</strong></td><td>${esc(v)}</td></tr>`)
    .join("\n");
  if (!body) return "";
  return `<section class="section">
<h2>${esc(label("section_ghata"))}</h2>
<p>${esc(label("ghata_intro"))}</p>
<table><tbody>${body}</tbody></table>
</section>`;
}

function renderChalit(label: L, c?: BrihadChalit | null): string {
  if (!c || !Array.isArray(c.houses) || c.houses.length === 0) return "";
  const hrows = c.houses
    .map((h) => `<tr><td>${esc(h.house)}</td><td>${esc(h.begin_sign)} ${esc(h.begin_dms)}</td><td>${esc(h.madhya_sign)} ${esc(h.madhya_dms)}</td></tr>`)
    .join("\n");
  const prows = (c.planets ?? [])
    .map((p) => `<tr><td>${esc(p.name)}</td><td>${esc(p.rashi_house)}</td><td>${esc(p.chalit_house)}</td><td>${p.shifted ? "✓" : ""}</td></tr>`)
    .join("\n");
  return `<section class="section">
<h2>${esc(label("section_chalit"))}</h2>
<p>${esc(label("chalit_intro"))}</p>
${table([label("chalit_house"), label("chalit_begin"), label("chalit_madhya")], [hrows])}
<h3>${esc(label("chalit_planets"))}</h3>
${table([label("planet"), label("chalit_rashi_house"), label("chalit_bhava_house"), label("chalit_shifted")], [prows])}
</section>`;
}

function renderKP(label: L, k?: BrihadKP | null): string {
  if (!k || !Array.isArray(k.cusps) || k.cusps.length === 0) return "";
  const cuspRows = k.cusps
    .map((c) => `<tr><td>${esc(c.house)}</td><td>${esc(c.sign)} ${esc(c.dms)}</td><td>${esc(c.star_lord)}</td><td>${esc(c.sub_lord)}</td><td>${esc(c.sub_sub_lord)}</td></tr>`)
    .join("\n");
  const sigRows = (k.planet_significators ?? [])
    .map((s) => `<tr><td>${esc(s.key)}</td><td>${(s.values ?? []).join(", ")}</td></tr>`)
    .join("\n");
  const rp = k.ruling_planets ?? {};
  const rpRows = Object.keys(rp)
    .map((key) => `<tr><td><strong>${esc(label("kp_rp_" + key) || key)}</strong></td><td>${esc(rp[key])}</td></tr>`)
    .join("\n");
  return `<section class="section">
<h2>${esc(label("section_kp"))}</h2>
<p>${esc(label("kp_intro"))}</p>
${table([label("house"), label("sign"), label("kp_star_lord"), label("kp_sub_lord"), label("kp_subsub_lord")], [cuspRows])}
<h3>${esc(label("kp_significators"))}</h3>
${table([label("planet"), label("kp_signifies_houses")], [sigRows])}
${rpRows ? `<h3>${esc(label("kp_ruling_planets"))}</h3>${table([label("kp_rp_role"), label("planet")], [rpRows])}` : ""}
</section>`;
}

function renderJaimini(label: L, j?: BrihadJaimini | null): string {
  if (!j) return "";
  const ckRows = (j.charakarakas ?? [])
    .map((c) => `<tr><td>${esc(c.karaka)}</td><td>${esc(c.planet)}</td></tr>`)
    .join("\n");
  const arRows = (j.arudha_padas ?? [])
    .map((a) => `<tr><td>${esc(a.label)} (${esc(a.name)})</td><td>${esc(a.sign)}</td><td>${esc(a.house)}</td></tr>`)
    .join("\n");
  if (!ckRows && !arRows) return "";
  return `<section class="section">
<h2>${esc(label("section_jaimini"))}</h2>
${ckRows ? `<h3>${esc(label("jaimini_charakarakas"))}</h3>${table([label("jaimini_karaka"), label("planet")], [ckRows])}` : ""}
<p><strong>${esc(label("jaimini_karakamsa"))}:</strong> ${esc(j.karakamsa_sign)} &nbsp; <strong>${esc(label("jaimini_swamsa"))}:</strong> ${esc(j.swamsa_sign)}</p>
${arRows ? `<h3>${esc(label("jaimini_arudha"))}</h3>${table([label("jaimini_pada"), label("sign"), label("house")], [arRows])}` : ""}
</section>`;
}

function renderIshta(label: L, i: BrihadIshtaDevata | null | undefined, locale = "en"): string {
  if (!i || !i.deity) return "";
  return `<section class="section">
<h2>${esc(label("section_ishta"))}</h2>
<p>${esc(label("ishta_intro"))}</p>
<p><strong>${esc(label("ishta_deity"))}:</strong> ${esc(i.deity)}<br>
<strong>${esc(label("ishta_12th_sign"))}:</strong> ${esc(i.twelfth_sign)} &nbsp;
<strong>${esc(label("ishta_graha"))}:</strong> ${esc(i.determining_graha)}</p>
${i.body ? `<p>${escBody(i.body, locale)}</p>` : ""}
</section>`;
}

function renderMaitri(label: L, m?: BrihadMaitri | null): string {
  if (!m || !Array.isArray(m.order) || m.order.length === 0) return "";
  const order = m.order;
  const tbl = (rows?: BrihadMaitriRow[]) => {
    if (!Array.isArray(rows) || rows.length === 0) return "";
    const head = `<tr><th></th>${order.map((o) => `<th>${esc(o)}</th>`).join("")}</tr>`;
    const body = rows
      .map((r) => `<tr><td><strong>${esc(r.planet)}</strong></td>${order.map((o) => `<td>${esc((r.relations ?? {})[o])}</td>`).join("")}</tr>`)
      .join("\n");
    return `<table><thead>${head}</thead><tbody>${body}</tbody></table>`;
  };
  return `<section class="section">
<h2>${esc(label("section_maitri"))}</h2>
<p>${esc(label("maitri_intro"))}</p>
<h3>${esc(label("maitri_naisargik"))}</h3>${tbl(m.naisargik)}
<h3>${esc(label("maitri_tatkalik"))}</h3>${tbl(m.tatkalik)}
<h3>${esc(label("maitri_panchadha"))}</h3>${tbl(m.panchadha)}
</section>`;
}

function renderAvasthas(label: L, a?: BrihadAvastha[]): string {
  if (!Array.isArray(a) || a.length === 0) return "";
  const rows = a
    .map((x) => `<tr><td>${esc(x.planet)}</td><td>${esc(x.baladi)}</td><td>${esc(x.jagradadi)}</td><td>${esc(x.deeptadi)}</td></tr>`)
    .join("\n");
  return `<section class="section">
<h2>${esc(label("section_avastha"))}</h2>
<p>${esc(label("avastha_intro"))}</p>
${table([label("planet"), label("avastha_baladi"), label("avastha_jagradadi"), label("avastha_deeptadi")], [rows])}
</section>`;
}

function renderLalKitab(label: L, lk?: BrihadLalKitab | null): string {
  if (!lk) return "";
  const planetRows = (lk.planets ?? [])
    .map((p) => `<tr><td>${esc(p.name)}</td><td>${esc(p.house)}</td><td>${esc(p.sign)}</td></tr>`)
    .join("\n");
  const rinRows = (lk.rins ?? [])
    .map((r) => `<tr><td>${esc(r.name)}</td><td>${yesNo(label, r.present)}</td></tr>`)
    .join("\n");
  if (!planetRows && !rinRows) return "";
  return `<section class="section">
<h2>${esc(label("section_lalkitab"))}</h2>
<p>${esc(label("lalkitab_intro"))}</p>
${planetRows ? `<h3>${esc(label("lalkitab_planets"))}</h3>${table([label("planet"), label("house"), label("sign")], [planetRows])}` : ""}
${rinRows ? `<h3>${esc(label("lalkitab_rins"))}</h3>${table([label("lalkitab_rin"), label("lalkitab_status")], [rinRows])}` : ""}
</section>`;
}

function renderShadbala(label: L, s?: BrihadShadbalaRow[]): string {
  if (!Array.isArray(s) || s.length === 0) return "";
  const rows = s
    .map((r) => `<tr><td>${esc(r.planet)}</td><td>${esc((r.total_rupas ?? 0).toFixed(2))}</td><td>${esc(r.rank)}</td></tr>`)
    .join("\n");
  return `<section class="section">
<h2>${esc(label("section_shadbala"))}</h2>
<p>${esc(label("shadbala_intro"))}</p>
${table([label("planet"), label("shadbala_rupas"), label("shadbala_rank")], [rows])}
</section>`;
}

function renderBhavaBala(label: L, b?: BrihadBhavaBalaRow[]): string {
  if (!Array.isArray(b) || b.length === 0) return "";
  const rows = b
    .map(
      (r) =>
        `<tr><td>${esc(r.house)}</td><td>${esc((r.bhavadhipati ?? 0).toFixed(2))}</td><td>${esc(
          (r.bhava_dig_bala ?? 0).toFixed(2),
        )}</td><td>${esc((r.bhava_drsti ?? 0).toFixed(2))}</td><td>${esc((r.total ?? 0).toFixed(2))}</td></tr>`,
    )
    .join("\n");
  return `<section class="section">
<h2>${esc(label("section_bhavabala"))}</h2>
<p>${esc(label("bhavabala_intro"))}</p>
${table(
    [label("house"), label("bb_lord"), label("bb_dig"), label("bb_drsti"), label("bb_total")],
    [rows],
  )}
</section>`;
}

function renderAshtakavarga(label: L, a?: BrihadAshtakavarga | null): string {
  if (!a || !Array.isArray(a.sav) || a.sav.length === 0) return "";
  const savCells = a.sav.map((n) => `<td>${esc(n)}</td>`).join("");
  const prastarRows = (a.prastar ?? [])
    .map((p) => `<tr><td>${esc(p.planet)}</td><td>${esc(p.total)}</td></tr>`)
    .join("\n");
  return `<section class="section">
<h2>${esc(label("section_ashtakavarga"))}</h2>
<p>${esc(label("ashtakavarga_intro"))}</p>
<table><thead><tr><th>${esc(label("ashtakavarga_sav"))}</th>${a.sav.map((_, i) => `<th>${i + 1}</th>`).join("")}</tr></thead>
<tbody><tr><td><strong>${esc(label("ashtakavarga_bindus"))}</strong></td>${savCells}</tr>
<tr><td colspan="${a.sav.length + 1}">${esc(label("ashtakavarga_total"))}: <strong>${esc(a.sav_total)}</strong></td></tr></tbody></table>
${prastarRows ? `<h3>${esc(label("ashtakavarga_prastar"))}</h3>${table([label("planet"), label("ashtakavarga_planet_total")], [prastarRows])}` : ""}
</section>`;
}

function renderVarshaphal(label: L, years: BrihadVarshaphalYear[] | undefined, locale = "en"): string {
  if (!Array.isArray(years) || years.length === 0) return "";
  const blocks = years
    .map((y) => {
      const sahamRows = (y.sahams ?? [])
        .map((s) => `<tr><td>${esc(s.name)}</td><td>${esc(s.sign)} ${esc(s.dms)}</td><td>${esc(s.lord)}</td></tr>`)
        .join("\n");
      const pvRows = (y.panchavargeeya ?? [])
        .map((p) => `<tr><td>${esc(p.planet)}</td><td>${esc((p.vishwa ?? 0).toFixed(2))}</td></tr>`)
        .join("\n");
      return `<h3>${esc(label("varshaphal_year"))} ${esc(y.year)}</h3>
<p><strong>${esc(label("varshaphal_muntha"))}:</strong> ${esc(y.muntha_sign)} (${esc(label("house"))} ${esc(y.muntha_house)}) &nbsp;
<strong>${esc(label("varshaphal_lord"))}:</strong> ${esc(y.varsha_lord)}</p>
${y.summary ? `<p>${escBody(y.summary, locale)}</p>` : ""}
${sahamRows ? `<h4>${esc(label("varshaphal_sahams"))}</h4>${table([label("varshaphal_saham"), label("sign"), label("lord")], [sahamRows])}` : ""}
${pvRows ? `<h4>${esc(label("varshaphal_panchavargeeya"))}</h4>${table([label("planet"), label("varshaphal_vishwa")], [pvRows])}` : ""}`;
    })
    .join("\n<hr>\n");
  return `<section class="section">
<h2>${esc(label("section_varshaphal"))}</h2>
<p>${esc(label("varshaphal_intro"))}</p>
${blocks}
</section>`;
}

/**
 * Month-wise Mudda-Dasha timeline — the dated, actionable annual horoscope for
 * the running year. Each period is a card with a date range, a one-line
 * summary, life-area lines, and a do / avoid / remedy box (benchmark-style).
 */
function renderMuddaTimeline(label: L, t: BrihadMuddaTimeline | null | undefined, locale = "en"): string {
  if (!t || !Array.isArray(t.periods) || t.periods.length === 0) return "";
  const cards = t.periods
    .map((p) => {
      const areas = (p.areas ?? [])
        .filter((a) => a.text)
        .map(
          (a) =>
            `<p class="mudda-area"><strong>${esc(a.label)}:</strong> ${escBody(a.text, locale)}</p>`,
        )
        .join("\n");
      const guidance = `<div class="mudda-guidance">
${p.do ? `<p><strong>${esc(p.do_label)}:</strong> ${escBody(p.do, locale)}</p>` : ""}
${p.avoid ? `<p><strong>${esc(p.avoid_label)}:</strong> ${escBody(p.avoid, locale)}</p>` : ""}
${p.remedy ? `<p><strong>${esc(p.remedy_label)}:</strong> ${escBody(p.remedy, locale)}</p>` : ""}
</div>`;
      return `<div class="mudda-period">
<h3 class="mudda-head">${esc(p.date_from)} ${esc(label("varshaphal_to") || "–")} ${esc(p.date_to)} &nbsp;·&nbsp; ${esc(p.lord)}</h3>
${p.summary ? `<p class="mudda-summary">${escBody(p.summary, locale)}</p>` : ""}
${areas}
${guidance}
</div>`;
    })
    .join("\n");
  const yr = t.year ? ` ${esc(t.year)}` : "";
  return `<section class="section mudda-section">
<h2>${esc(t.heading || label("section_mudda"))}${yr}</h2>
${cards}
</section>`;
}

function renderRajyoga(label: L, r?: BrihadRajyogaPower | null): string {
  if (!r) return "";
  const skRows = (r.swarnim_kaal ?? [])
    .map((p) => `<tr><td>${esc(p.lord)}</td><td>${esc(p.start)}</td><td>${esc(p.end)}</td></tr>`)
    .join("\n");
  return `<section class="section">
<h2>${esc(label("section_rajyoga"))}</h2>
<div class="rajyoga-power">
<div class="rajyoga-pct">${esc(r.percent)}%</div>
<div class="rajyoga-label">${esc(label("rajyoga_strength"))}</div>
</div>
<p>${esc(label("rajyoga_planets"))}: ${(r.planets ?? []).join(", ")}</p>
${skRows ? `<h3>${esc(label("rajyoga_swarnim"))}</h3>${table([label("planet"), label("rajyoga_from"), label("rajyoga_to")], [skRows])}` : ""}
</section>`;
}

/**
 * Render all deep classical sections + the corpus-backed narrative chapters,
 * in report order. Returns an array of HTML <section> strings to splice into
 * the document body.
 */
export function renderBrihadDeepSections(label: L, d: BrihadDeepData, locale = "en"): string[] {
  const out: string[] = [];
  out.push(renderAvakahada(label, d.avakahada));
  out.push(renderGhata(label, d.ghata_chakra));
  out.push(renderChalit(label, d.chalit));
  out.push(renderShadbala(label, d.shadbala));
  out.push(renderBhavaBala(label, d.bhava_bala));
  out.push(renderAshtakavarga(label, d.ashtakavarga));
  out.push(renderMaitri(label, d.maitri));
  out.push(renderAvasthas(label, d.avasthas));
  out.push(renderKP(label, d.kp));
  out.push(renderJaimini(label, d.jaimini));
  out.push(renderIshta(label, d.ishta_devata, locale));
  out.push(renderLalKitab(label, d.lal_kitab));
  out.push(renderRajyoga(label, d.rajyoga_power));
  out.push(renderVarshaphal(label, d.varshaphal, locale));
  out.push(renderMuddaTimeline(label, d.mudda_timeline, locale));
  // Corpus-backed narrative chapters (the bulk of the pages).
  for (const ch of d.narrative_chapters ?? []) {
    // vistrit_bhavishya is rendered at the FRONT of the document (the opening
    // life reading), so skip it here to avoid a duplicate.
    if (ch.key === "vistrit_bhavishya") continue;
    out.push(renderChapter(ch, locale));
  }
  return out.filter((s) => s.length > 0);
}

/**
 * The Brihat deep sections rendered individually and addressable by key, so the
 * Part 0–7 layout walk (kundliBrihad.ts) can place each one into the correct
 * Part instead of a fixed flat list. Each value is the section HTML or "".
 */
export function brihadDeepBlocks(
  label: L,
  d: BrihadDeepData,
  locale = "en",
): Record<
  | "avakahada" | "panchang" | "gems" | "ghata" | "chalit" | "shadbala"
  | "bhavabala" | "ashtakavarga" | "maitri" | "avasthas" | "kp" | "jaimini"
  | "ishta" | "lalkitab" | "rajyoga" | "varshaphal" | "mudda",
  string
> {
  return {
    avakahada: renderAvakahada(label, d.avakahada),
    panchang: renderPanchang(label, d.panchang),
    gems: renderGems(label, d.gems),
    ghata: renderGhata(label, d.ghata_chakra),
    chalit: renderChalit(label, d.chalit),
    shadbala: renderShadbala(label, d.shadbala),
    bhavabala: renderBhavaBala(label, d.bhava_bala),
    ashtakavarga: renderAshtakavarga(label, d.ashtakavarga),
    maitri: renderMaitri(label, d.maitri),
    avasthas: renderAvasthas(label, d.avasthas),
    kp: renderKP(label, d.kp),
    jaimini: renderJaimini(label, d.jaimini),
    ishta: renderIshta(label, d.ishta_devata, locale),
    lalkitab: renderLalKitab(label, d.lal_kitab),
    rajyoga: renderRajyoga(label, d.rajyoga_power),
    varshaphal: renderVarshaphal(label, d.varshaphal, locale),
    mudda: renderMuddaTimeline(label, d.mudda_timeline, locale),
  };
}
