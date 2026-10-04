/**
 * `lifeastroapi/pdf` — turn LifeAstroAPI report JSON into branded, print-ready
 * PDFs (or HTML).
 *
 * Two layers:
 *  1. `render*Html(data, branding?)` — pure, zero-dependency functions that
 *     turn the JSON from `client.reports.*` into a self-contained, branded
 *     HTML document. Run anywhere (Node, edge, browser).
 *  2. `htmlToPdf(html, opts?)` + the `*Pdf(...)` convenience wrappers —
 *     produce PDF bytes via the optional `puppeteer` peer dependency.
 *
 * @example
 * ```ts
 * import { LifeAstro } from "lifeastroapi";
 * import { kundliDetailedPdf } from "lifeastroapi/pdf";
 *
 * const client = new LifeAstro({ apiKey: process.env.LIFEASTRO_API_KEY });
 * const report = await client.reports.kundliDetailed({
 *   date: "1990-01-15", time: "10:30", tz: "Asia/Kolkata", lat: 19.07, lon: 72.87,
 * });
 * const pdf = await kundliDetailedPdf(report, {
 *   branding: { companyName: "Acme Astro", logoUrl: "https://…/logo.png", primaryColor: "#6b21a8" },
 * });
 * ```
 */
import { renderKundliLiteHtml } from "./templates/kundliLite.js";
import { renderKundliDetailedHtml } from "./templates/kundliDetailed.js";
import { renderKundliBrihadHtml } from "./templates/kundliBrihad.js";
import { renderMatchMakingHtml } from "./templates/matchMaking.js";
import { renderDashaAnalysisHtml } from "./templates/dashaAnalysis.js";
import { renderNumerologyHtml } from "./templates/numerology.js";
import { renderSadeSatiHtml } from "./templates/sadeSati.js";
import { renderVarshaphalHtml } from "./templates/varshaphal.js";
import { renderHoroscopeHtml } from "./templates/horoscope.js";
import { renderMangalDoshaHtml } from "./templates/mangalDosha.js";
import { htmlToPdf, measureTocEntries, tocPagesFromPdf, type HtmlToPdfOptions } from "./render.js";
import { addPdfOutline, type OutlineItem } from "./outline.js";
import type { Branding } from "./shared.js";
import {
  brihadHeaderTemplate,
  brihadFooterTemplate,
  buildBrihadToc,
  tagBrihadSectionsForToc,
  BRIHAD_PDF_MARGIN,
} from "./templates/kundliBrihadSections.js";

// ── Branding + HTML helpers ────────────────────────────────────────────────
export type { Branding, RawBranding, ResolvedBranding } from "./shared.js";
export { resolveBranding, esc, escBody, humanize, cleanNarrative } from "./shared.js";

// ── HTML renderers (zero-dependency) ────────────────────────────────────────
export { renderKundliLiteHtml, type KundliLiteData } from "./templates/kundliLite.js";
export { renderKundliDetailedHtml, type KundliDetailedData } from "./templates/kundliDetailed.js";
export { renderKundliBrihadHtml, type KundliBrihadData } from "./templates/kundliBrihad.js";
export { renderMatchMakingHtml, type MatchMakingData } from "./templates/matchMaking.js";
export { renderDashaAnalysisHtml, type DashaAnalysisData } from "./templates/dashaAnalysis.js";
export { renderNumerologyHtml, type NumerologyData } from "./templates/numerology.js";
export { renderSadeSatiHtml, type SadeSatiData } from "./templates/sadeSati.js";
export { renderMangalDoshaHtml, type MangalDoshaData } from "./templates/mangalDosha.js";
export { renderVarshaphalHtml, type VarshaphalData } from "./templates/varshaphal.js";
export { renderHoroscopeHtml, type HoroscopeData } from "./templates/horoscope.js";

// ── PDF rendering (optional puppeteer) ──────────────────────────────────────
export { htmlToPdf } from "./render.js";
export type { HtmlToPdfOptions, PuppeteerBrowserLike, PuppeteerModuleLike } from "./render.js";
export { addPdfOutline, type OutlineItem } from "./outline.js";

/** Options for the one-call `*Pdf` convenience wrappers. */
export type ReportPdfOptions = HtmlToPdfOptions & {
  /** Branding overrides (logo, colors, company name, footer, watermark). */
  branding?: Branding;
};

/** Build a PDF from a single `render*Html` function + report data. */
function toPdf<D>(
  render: (data: D, branding?: Branding) => string,
  data: D,
  opts?: ReportPdfOptions,
): Promise<Uint8Array> {
  return htmlToPdf(render(data, opts?.branding), opts);
}

/** Detailed Kundli → PDF. */
export const kundliDetailedPdf = (data: Parameters<typeof renderKundliDetailedHtml>[0], opts?: ReportPdfOptions) =>
  toPdf(renderKundliDetailedHtml, data, opts);
/** Lite Kundli → PDF. */
export const kundliLitePdf = (data: Parameters<typeof renderKundliLiteHtml>[0], opts?: ReportPdfOptions) =>
  toPdf(renderKundliLiteHtml, data, opts);
/** Brihad (comprehensive) Kundli → PDF. Uses a running header (amber page
 *  tab + company) and footer (dotted url) rendered in the page margin so the
 *  chrome never overlaps body content, and a generated विषय-सूची / table of
 *  contents with accurate, color-coded page numbers (resolved via a 2-pass
 *  render). */
export const kundliBrihadPdf = async (
  data: Parameters<typeof renderKundliBrihadHtml>[0],
  opts?: ReportPdfOptions,
): Promise<Uint8Array> => {
  const branding = opts?.branding ?? ((data as { Branding?: Branding }).Branding);
  const margin = opts?.margin ?? BRIHAD_PDF_MARGIN;
  const pdfOpts: HtmlToPdfOptions = {
    ...opts,
    displayHeaderFooter: true,
    headerTemplate: brihadHeaderTemplate(branding),
    footerTemplate: brihadFooterTemplate(branding),
    margin,
  };

  const baseHtml = renderKundliBrihadHtml(data, opts?.branding);
  const { html: tagged, titles } = tagBrihadSectionsForToc(baseHtml);

  // No sections found (shouldn't happen) → render without a TOC.
  if (titles.length === 0) return htmlToPdf(baseHtml, pdfOpts);

  const tocHeading = pickTocHeading(data);

  // Pass 1: insert a placeholder TOC (right row count, so pagination already
  // accounts for the TOC's own height) and render. The body carries invisible
  // ⟦T<idx>⟧ markers at each section start.
  const placeholder = buildBrihadToc(
    titles.map((t, i) => ({ title: t, page: i + 1 })),
    tocHeading,
  );
  const withPlaceholder = insertTocAfterCover(tagged, placeholder);

  let pass1: Uint8Array;
  try {
    pass1 = await htmlToPdf(withPlaceholder, pdfOpts);
  } catch {
    // Rendering failed at pass 1 → nothing more to do.
    throw new Error("kundliBrihadPdf: pass-1 render failed");
  }

  // Resolve exact section pages from the rendered PDF (reads real pagination).
  let entries: { title: string; page: number }[] = [];
  try {
    const pageOf = await tocPagesFromPdf(pass1);
    if (Object.keys(pageOf).length > 0) {
      entries = titles
        .map((t, i) => ({ title: t, page: pageOf[i] }))
        .filter((e): e is { title: string; page: number } => typeof e.page === "number");
    }
  } catch {
    entries = [];
  }

  // Fall back to the screen-DOM estimate if the PDF parse is unavailable
  // (pdfjs-dist not installed).
  if (entries.length === 0) {
    try {
      entries = await measureTocEntries(withPlaceholder, 965, pdfOpts);
    } catch {
      return pass1; // ship pass-1 with the placeholder TOC
    }
  }
  if (entries.length === 0) return pass1;

  // Pass 2: rebuild the TOC with exact page numbers and render final.
  const finalToc = buildBrihadToc(entries, tocHeading);
  const finalHtml = insertTocAfterCover(tagged, finalToc);
  const finalPdf = await htmlToPdf(finalHtml, pdfOpts);

  // Append a navigable PDF outline (bookmark sidebar) from the same resolved
  // entries. Chromium can't emit this itself; addPdfOutline injects an
  // /Outlines tree via an incremental update (zero-dependency). The printed
  // TOC and the bookmarks now share one source of truth. Best-effort: if the
  // injection fails for any reason, ship the PDF without bookmarks rather than
  // breaking PDF generation.
  try {
    const outlineItems: OutlineItem[] = entries.map((e) => ({
      title: e.title,
      page: e.page,
      level: brihadOutlineLevel(e.title),
    }));
    return addPdfOutline(finalPdf, outlineItems);
  } catch {
    return finalPdf;
  }
};

/**
 * Bookmark nesting level for a Brihad section title. Top-level "Parts" (titles
 * the renderer marks with a part prefix) become level 1; everything else nests
 * under the most recent part at level 2. Until the Part-grouped layout lands,
 * all sections resolve to level 1 — still a flat, fully navigable sidebar.
 */
function brihadOutlineLevel(title: string): number {
  // A Part heading is emitted as "Part N: …" / "भाग N: …" by the renderer.
  // NOTE: \b is ASCII-only and never matches after a Devanagari letter, so we
  // match "Part"/"भाग" followed by whitespace or a digit instead.
  return /^(part|भाग)[\s\d]/i.test(title.trim()) ? 1 : 2;
}

/** Locale-aware TOC heading. */
function pickTocHeading(data: unknown): string {
  const loc = (data as { Locale?: string }).Locale ?? "en";
  if (loc === "hi" || loc === "mr") return "विषय-सूची";
  return "Table of Contents";
}

/** Insert a TOC section immediately after the cover section. */
function insertTocAfterCover(html: string, toc: string): string {
  const coverEnd = html.indexOf("</section>");
  if (coverEnd === -1) return toc + html;
  const at = coverEnd + "</section>".length;
  return html.slice(0, at) + "\n" + toc + "\n" + html.slice(at);
}
/** Match-making (Kundli Milan) → PDF. */
export const matchMakingPdf = (data: Parameters<typeof renderMatchMakingHtml>[0], opts?: ReportPdfOptions) =>
  toPdf(renderMatchMakingHtml, data, opts);
/** Dasha analysis → PDF. */
export const dashaAnalysisPdf = (data: Parameters<typeof renderDashaAnalysisHtml>[0], opts?: ReportPdfOptions) =>
  toPdf(renderDashaAnalysisHtml, data, opts);
/** Numerology → PDF. */
export const numerologyPdf = (data: Parameters<typeof renderNumerologyHtml>[0], opts?: ReportPdfOptions) =>
  toPdf(renderNumerologyHtml, data, opts);
/** Sade Sati → PDF. */
export const sadeSatiPdf = (data: Parameters<typeof renderSadeSatiHtml>[0], opts?: ReportPdfOptions) =>
  toPdf(renderSadeSatiHtml, data, opts);
/** Varshaphal (annual) → PDF. */
export const varshaphalPdf = (data: Parameters<typeof renderVarshaphalHtml>[0], opts?: ReportPdfOptions) =>
  toPdf(renderVarshaphalHtml, data, opts);
/** Horoscope (daily/weekly/monthly) → PDF. */
export const horoscopePdf = (data: Parameters<typeof renderHoroscopeHtml>[0], opts?: ReportPdfOptions) =>
  toPdf(renderHoroscopeHtml, data, opts);
/** Mangal Dosha (Manglik) → PDF. */
export const mangalDoshaPdf = (data: Parameters<typeof renderMangalDoshaHtml>[0], opts?: ReportPdfOptions) =>
  toPdf(renderMangalDoshaHtml, data, opts);
