/**
 * `lifeastroapi/pdf-html`: the HTML half of `lifeastroapi/pdf`, with nothing
 * that needs Node or a browser driver.
 *
 * `render*Html(data, branding?)` turns the JSON from `client.reports.*` into a
 * complete, branded HTML document. The functions are pure string builders, so
 * this entry bundles for React Native (Metro), Expo, browsers and edge
 * runtimes, where `lifeastroapi/pdf` (Puppeteer, PDF bookmarks) cannot load.
 *
 * Print the HTML with the platform's own web engine to get a PDF on the
 * device, for example `expo-print`:
 *
 * @example
 * ```ts
 * import * as Print from "expo-print";
 * import { renderKundliLiteHtml, A4_PRINT_OPTIONS } from "lifeastroapi/pdf-html";
 *
 * const html = renderKundliLiteHtml(report, { companyName: "Acme Astro" });
 * const { uri } = await Print.printToFileAsync({ html, ...A4_PRINT_OPTIONS });
 * ```
 */

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

// ── Page geometry for device print APIs ─────────────────────────────────────
/**
 * A4 page size and the reports' page margins in PDF points (1/72 inch), in the
 * shape `expo-print`'s `printToFileAsync` takes. The templates set the same
 * geometry with a CSS `@page` rule, which Chromium follows; the iOS print
 * engine ignores `@page`, so pass this next to the HTML:
 *
 * ```ts
 * const { uri } = await Print.printToFileAsync({ html, ...A4_PRINT_OPTIONS });
 * ```
 */
export const A4_PRINT_OPTIONS = {
  width: 595,
  height: 842,
  margins: { top: 51, right: 43, bottom: 62, left: 43 },
} as const;
