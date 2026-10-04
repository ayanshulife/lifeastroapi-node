/**
 * Optional HTML → PDF rendering via Puppeteer (headless Chromium).
 *
 * Puppeteer is an OPTIONAL peer dependency — the core `lifeastroapi` package
 * and all `render*Html` functions work with zero dependencies. Install
 * `puppeteer` (or pass your own via `{ puppeteer }` / a live `{ browser }`)
 * only if you want this module to produce PDF bytes for you.
 *
 * Chromium is the right engine here: it ships Noto fonts so Devanagari /
 * Tamil / Telugu / Bengali / Gujarati / Kannada render correctly, and it
 * handles the templates' CSS (gradients, tables, watermark, @page) faithfully.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

/** Minimal structural type for a Puppeteer page. */
interface PageLike {
  setContent(html: string, opts?: any): Promise<void>;
  pdf(opts?: any): Promise<Uint8Array | Buffer>;
  evaluate(fn: any, ...args: any[]): Promise<any>;
  close(): Promise<void>;
}
/** Minimal structural type for a Puppeteer browser. */
export interface PuppeteerBrowserLike {
  newPage(): Promise<PageLike>;
  close(): Promise<void>;
}
/** Minimal structural type for the puppeteer module. */
export interface PuppeteerModuleLike {
  launch(opts?: any): Promise<PuppeteerBrowserLike>;
}

export interface HtmlToPdfOptions {
  /** Paper size. Default "A4". */
  format?: "A4" | "A3" | "A5" | "Letter" | "Legal" | "Tabloid";
  /** Landscape orientation. Default false. */
  landscape?: boolean;
  /** Print CSS background colors/images. Default true (templates are branded). */
  printBackground?: boolean;
  /** Honour the template's own @page CSS size. Default true. */
  preferCSSPageSize?: boolean;
  /** Page margins, e.g. `{ top: "10mm" }`. */
  margin?: { top?: string; bottom?: string; left?: string; right?: string };
  /**
   * Render a running header/footer in the page margin (outside the content
   * box, so it can never overlap body content). When true, supply
   * `headerTemplate` / `footerTemplate` and a `margin` large enough to hold
   * them. Chromium replaces `<span class="pageNumber|totalPages|title|date|url">`
   * inside the templates. NOTE: Chromium ignores external CSS in these
   * templates — use inline styles only.
   */
  displayHeaderFooter?: boolean;
  /** HTML for the running header (inline styles only). */
  headerTemplate?: string;
  /** HTML for the running footer (inline styles only). */
  footerTemplate?: string;
  /** Render scale (0.1–2). */
  scale?: number;
  /** Max time to wait for the page to settle, ms. Default 30000. */
  timeoutMs?: number;
  /**
   * Reuse an already-launched browser (recommended for servers — launching
   * Chromium per call is slow). When provided, it is NOT closed for you.
   */
  browser?: PuppeteerBrowserLike;
  /** Inject the puppeteer module (e.g. `puppeteer-core` + `@sparticuz/chromium` on serverless). */
  puppeteer?: PuppeteerModuleLike;
  /** Options forwarded to `puppeteer.launch()` when this module launches the browser. */
  launchOptions?: Record<string, unknown>;
}

async function loadPuppeteer(injected?: PuppeteerModuleLike): Promise<PuppeteerModuleLike> {
  if (injected) return injected;
  try {
    // Non-literal specifier so bundlers/tsc don't hard-require the optional dep.
    const name = "puppeteer";
    const mod: any = await import(/* @vite-ignore */ name);
    return (mod.default ?? mod) as PuppeteerModuleLike;
  } catch (cause) {
    throw new Error(
      "lifeastroapi/pdf: PDF rendering requires Puppeteer. Install it with `npm install puppeteer`, " +
        "or pass your own via `htmlToPdf(html, { puppeteer })` or a live `{ browser }`.",
      { cause },
    );
  }
}

/**
 * Convert a complete HTML document (from any `render*Html` function) into PDF
 * bytes using headless Chromium.
 *
 * @example
 * ```ts
 * import { renderKundliDetailedHtml, htmlToPdf } from "lifeastroapi/pdf";
 * const html = renderKundliDetailedHtml(report, { logoUrl, companyName });
 * const pdf = await htmlToPdf(html);          // Uint8Array
 * fs.writeFileSync("kundli.pdf", pdf);
 * ```
 */
/**
 * Render `html`, then report the 1-based PDF page each element carrying a
 * `data-toc-title` attribute falls on. Used to build a table of contents.
 *
 * pageContentPx is the printable content height of one page in CSS px (page
 * height minus top+bottom margins). Pagination here is APPROXIMATE — it walks
 * elements that declare `page-break-before: always` (our `.section`) to detect
 * real page starts, which matches Chromium's paged output closely.
 */
export async function measureTocEntries(
  html: string,
  pageContentPx: number,
  opts: HtmlToPdfOptions = {},
): Promise<{ title: string; page: number }[]> {
  const ownBrowser = !opts.browser;
  const browser = opts.browser ?? (await (await loadPuppeteer(opts.puppeteer)).launch(opts.launchOptions));
  let page: PageLike | undefined;
  try {
    page = await browser.newPage();
    await page.setContent(html, { waitUntil: "networkidle0", timeout: opts.timeoutMs ?? 30_000 });
    return (await page.evaluate((ph: number) => {
      // Each .section/.cover starts on a fresh page (page-break-before:always).
      // A section of rendered height H occupies ceil(H/ph) pages, so the NEXT
      // breaker begins at pageNo + that span. This cumulative ceil() walk is
      // robust to very tall sections (e.g. the 100pp varshaphal) — the older
      // floor()-of-one-section approach drifted by whole pages.
      const out: { title: string; page: number }[] = [];
      const breakers = Array.from(document.querySelectorAll<HTMLElement>(".section, .cover"));
      let pageNo = 1;
      breakers.forEach((el, i) => {
        if (i > 0) {
          const prev = breakers[i - 1];
          const prevH = prev ? prev.getBoundingClientRect().height : 0;
          const span = Math.max(1, Math.ceil(prevH / ph));
          pageNo += span;
        }
        const titleEl =
          el.querySelector<HTMLElement>("[data-toc-title]") ??
          (el.matches("[data-toc-title]") ? el : null);
        const title = titleEl?.getAttribute("data-toc-title");
        if (title) out.push({ title, page: pageNo });
      });
      return out;
    }, pageContentPx)) as { title: string; page: number }[];
  } finally {
    if (page) await page.close().catch(() => {});
    if (ownBrowser) await browser.close().catch(() => {});
  }
}

/**
 * Scan a rendered PDF for section markers (⟦T<idx>⟧) and return, for each
 * marker index, the 1-based page it first appears on. Exact (reads the real
 * paginated PDF), unlike the screen-DOM estimate.
 *
 * Uses pdfjs-dist via dynamic import — an OPTIONAL dep. Returns {} if pdfjs
 * isn't installed (caller then falls back to the estimate).
 */
export async function tocPagesFromPdf(pdfBytes: Uint8Array): Promise<Record<number, number>> {
  let pdfjs: any;
  try {
    const name = "pdfjs-dist/legacy/build/pdf.mjs";
    pdfjs = await import(/* @vite-ignore */ name);
  } catch {
    return {};
  }
  const out: Record<number, number> = {};
  // pdfjs needs a fresh copy of the bytes (it transfers/zeroes the buffer).
  const data = pdfBytes.slice();
  const doc = await pdfjs.getDocument({ data, useSystemFonts: true }).promise;
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const content = await page.getTextContent();
    const text = content.items.map((it: any) => (it.str ?? "")).join("");
    const re = /⟦T(\d+)⟧/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      const idx = Number(m[1]);
      if (out[idx] === undefined) out[idx] = p; // first page wins
    }
  }
  await doc.destroy?.();
  return out;
}

export async function htmlToPdf(html: string, opts: HtmlToPdfOptions = {}): Promise<Uint8Array> {
  const ownBrowser = !opts.browser;
  const browser = opts.browser ?? (await (await loadPuppeteer(opts.puppeteer)).launch(opts.launchOptions));
  let page: PageLike | undefined;
  try {
    page = await browser.newPage();
    await page.setContent(html, {
      waitUntil: "networkidle0",
      timeout: opts.timeoutMs ?? 30_000,
    });
    const useHF = opts.displayHeaderFooter ?? false;
    const pdf = await page.pdf({
      format: opts.format ?? "A4",
      landscape: opts.landscape ?? false,
      printBackground: opts.printBackground ?? true,
      // A running header/footer lives in the page margin, so the template's
      // own @page size must NOT win or the margin boxes collapse — disable
      // preferCSSPageSize when header/footer is on.
      preferCSSPageSize: useHF ? false : (opts.preferCSSPageSize ?? true),
      ...(opts.margin ? { margin: opts.margin } : {}),
      ...(useHF
        ? {
            displayHeaderFooter: true,
            headerTemplate: opts.headerTemplate ?? "<span></span>",
            footerTemplate: opts.footerTemplate ?? "<span></span>",
          }
        : {}),
      ...(opts.scale ? { scale: opts.scale } : {}),
    });
    return pdf instanceof Uint8Array ? pdf : new Uint8Array(pdf);
  } finally {
    if (page) await page.close().catch(() => {});
    if (ownBrowser) await browser.close().catch(() => {});
  }
}
