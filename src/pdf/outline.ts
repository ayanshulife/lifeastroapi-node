/**
 * Zero-dependency PDF outline (bookmark) injector.
 *
 * Chromium's `page.pdf()` / `--print-to-pdf` does NOT emit a document outline
 * from HTML headings, so the navigable "bookmark sidebar" that professional
 * reports (e.g. AstroSage's Brihat Horoscope, 710 bookmarks) rely on is missing.
 *
 * This module appends an `/Outlines` tree to an already-rendered PDF via an
 * **incremental update** (ISO 32000-1 §7.5.6): we never rewrite the original
 * bytes — we add new objects, a new cross-reference section, and a new trailer
 * at the end of the file, then point the document Catalog at the new outline.
 * That keeps it dependency-free (no pdf-lib / pdfjs) and robust: the original
 * content, fonts and pages are untouched.
 *
 * Limitations (acceptable for our reports):
 *  - Assumes the input is a standard cross-reference *table* PDF (what Chromium
 *    emits), not a cross-reference *stream*. We parse the existing Catalog and
 *    its `/Pages` to map page numbers → page object refs.
 *  - Destinations use `[pageRef /Fit]` (whole-page fit) — the right behaviour
 *    for section bookmarks.
 */

/** One bookmark. `level` is 1-based (1 = top); children follow their parent. */
export interface OutlineItem {
  /** Bookmark label (shown in the reader's sidebar). */
  title: string;
  /** 1-based PDF page the bookmark jumps to. */
  page: number;
  /** 1-based nesting depth (1 = top-level part, 2 = section, …). */
  level: number;
}

const DEC = new TextDecoder("latin1");

/**
 * Encode a string as raw bytes, one byte per char code (latin1 / binary).
 *
 * We CANNOT use TextEncoder here: pdfText() builds UTF-16BE bookmark labels as
 * a binary string whose char codes are individual bytes (0x00–0xFF, including
 * 0xFE/0xFF). TextEncoder would UTF-8-re-encode those high bytes (0xFE → 0xC3
 * 0xBE), corrupting the literal. latin1Bytes preserves them verbatim.
 */
function latin1Bytes(s: string): Uint8Array {
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i) & 0xff;
  return out;
}

/** Concatenate byte chunks. */
function concat(chunks: Uint8Array[]): Uint8Array {
  let n = 0;
  for (const c of chunks) n += c.length;
  const out = new Uint8Array(n);
  let o = 0;
  for (const c of chunks) {
    out.set(c, o);
    o += c.length;
  }
  return out;
}

/** Escape a string for a PDF literal `( … )` and wrap it as UTF-16BE so
 * Devanagari / Tamil / etc. bookmark labels render correctly in readers. */
function pdfText(s: string): string {
  // UTF-16BE with BOM, then escape the bytes that are special in a literal.
  const bytes: number[] = [0xfe, 0xff];
  for (const ch of s) {
    const cp = ch.codePointAt(0)!;
    if (cp > 0xffff) {
      const v = cp - 0x10000;
      const hi = 0xd800 + (v >> 10);
      const lo = 0xdc00 + (v & 0x3ff);
      bytes.push(hi >> 8, hi & 0xff, lo >> 8, lo & 0xff);
    } else {
      bytes.push(cp >> 8, cp & 0xff);
    }
  }
  let out = "(";
  for (const b of bytes) {
    if (b === 0x28 || b === 0x29 || b === 0x5c) out += "\\" + String.fromCharCode(b);
    else out += String.fromCharCode(b);
  }
  return out + ")";
}

/**
 * Find the highest object number currently used, the Catalog (Root) object
 * number, and the page object numbers in order. Works on the standard
 * Chromium-emitted xref-table PDF.
 */
function parsePdf(pdf: Uint8Array): {
  text: string;
  maxObj: number;
  rootObj: number;
  pageObjs: number[];
  prevStartXref: number;
} {
  const text = DEC.decode(pdf);

  // Highest object number = scan all "N 0 obj" definitions.
  let maxObj = 0;
  const objRe = /(\d+)\s+0\s+obj\b/g;
  let m: RegExpExecArray | null;
  while ((m = objRe.exec(text)) !== null) {
    const n = Number(m[1]);
    if (n > maxObj) maxObj = n;
  }

  // Root (Catalog) ref from the trailer.
  const rootM = /\/Root\s+(\d+)\s+0\s+R/.exec(text);
  if (!rootM) throw new Error("pdf outline: /Root not found in trailer");
  const rootObj = Number(rootM[1]);

  // Page object numbers, in document order. We collect every object whose body
  // contains "/Type /Page" (not "/Pages"), in the order they appear — Chromium
  // writes them sequentially, which matches page order.
  const pageObjs: number[] = [];
  const defRe = /(\d+)\s+0\s+obj([\s\S]*?)endobj/g;
  const found: { obj: number; at: number }[] = [];
  while ((m = defRe.exec(text)) !== null) {
    const body = m[2] ?? "";
    if (/\/Type\s*\/Page\b/.test(body) && !/\/Type\s*\/Pages\b/.test(body)) {
      found.push({ obj: Number(m[1]), at: m.index });
    }
  }
  found.sort((a, b) => a.at - b.at);
  for (const f of found) pageObjs.push(f.obj);

  // startxref of the existing xref (for the /Prev chain).
  const sx = /startxref\s+(\d+)\s+%%EOF\s*$/.exec(text.trimEnd()) ?? /startxref\s+(\d+)/g.exec(text);
  // Use the LAST startxref in the file.
  let prevStartXref = 0;
  const sxRe = /startxref\s+(\d+)/g;
  let sm: RegExpExecArray | null;
  while ((sm = sxRe.exec(text)) !== null) prevStartXref = Number(sm[1]);
  void sx;

  if (pageObjs.length === 0) throw new Error("pdf outline: no /Type /Page objects found");
  return { text, maxObj, rootObj, pageObjs, prevStartXref };
}

/**
 * Append a bookmark outline to a rendered PDF and return the new bytes.
 *
 * @param pdf    the rendered PDF (from htmlToPdf)
 * @param items  ordered bookmarks; `page` is 1-based, `level` is 1-based depth
 */
export function addPdfOutline(pdf: Uint8Array, items: OutlineItem[]): Uint8Array {
  if (items.length === 0) return pdf;

  const { maxObj, rootObj, pageObjs, prevStartXref } = parsePdf(pdf);

  // Clamp pages into range and drop items with no resolvable page.
  const valid = items
    .map((it) => ({ ...it, page: Math.min(Math.max(1, Math.round(it.page)), pageObjs.length) }))
    .filter((it) => it.title.trim().length > 0);
  if (valid.length === 0) return pdf;

  // Object numbering: outline-root = maxObj+1, then one object per item.
  const outlineRootObj = maxObj + 1;
  const itemObj = (i: number) => outlineRootObj + 1 + i;

  // Build the parent/sibling tree from the level sequence.
  // For each item, find its parent (nearest previous item with level-1) and
  // its first/last child, prev/next siblings.
  const n = valid.length;
  const parent: number[] = new Array(n).fill(-1); // index into valid, or -1 (root)
  const children: number[][] = Array.from({ length: n }, () => []);
  const rootChildren: number[] = [];
  const stack: number[] = []; // indices, by increasing level
  for (let i = 0; i < n; i++) {
    const lvl = Math.max(1, valid[i]!.level);
    while (stack.length && valid[stack[stack.length - 1]!]!.level >= lvl) stack.pop();
    if (stack.length === 0) {
      parent[i] = -1;
      rootChildren.push(i);
    } else {
      const p = stack[stack.length - 1]!;
      parent[i] = p;
      children[p]!.push(i);
    }
    stack.push(i);
  }

  const ref = (obj: number) => `${obj} 0 R`;
  const childrenOf = (i: number): number[] => children[i] ?? [];
  const countOpenDescendants = (i: number): number => {
    // Negative count = collapsed; we keep all open (positive) for usability.
    let c = childrenOf(i).length;
    for (const ch of childrenOf(i)) c += countOpenDescendants(ch);
    return c;
  };

  // Serialize each outline-item object.
  const objBodies: { obj: number; body: string }[] = [];

  // Outline root dictionary.
  {
    const first = rootChildren.length ? ref(itemObj(rootChildren[0]!)) : "";
    const last = rootChildren.length ? ref(itemObj(rootChildren[rootChildren.length - 1]!)) : "";
    let total = rootChildren.length;
    for (const r of rootChildren) total += countOpenDescendants(r);
    const body =
      `<< /Type /Outlines` +
      (first ? ` /First ${first}` : "") +
      (last ? ` /Last ${last}` : "") +
      ` /Count ${total} >>`;
    objBodies.push({ obj: outlineRootObj, body });
  }

  // Each item.
  for (let i = 0; i < n; i++) {
    const it = valid[i]!;
    const par = parent[i]!;
    const sibs = par === -1 ? rootChildren : childrenOf(par);
    const kids = childrenOf(i);
    const pos = sibs.indexOf(i);
    const parentRef = par === -1 ? ref(outlineRootObj) : ref(itemObj(par));
    const prevRef = pos > 0 ? ref(itemObj(sibs[pos - 1]!)) : "";
    const nextRef = pos < sibs.length - 1 ? ref(itemObj(sibs[pos + 1]!)) : "";
    const firstChild = kids.length ? ref(itemObj(kids[0]!)) : "";
    const lastChild = kids.length ? ref(itemObj(kids[kids.length - 1]!)) : "";
    const kidCount = kids.length ? kids.length + kids.reduce((s, c) => s + countOpenDescendants(c), 0) : 0;
    const pageRef = ref(pageObjs[it.page - 1]!);

    const body =
      `<< /Title ${pdfText(it.title)}` +
      ` /Parent ${parentRef}` +
      (prevRef ? ` /Prev ${prevRef}` : "") +
      (nextRef ? ` /Next ${nextRef}` : "") +
      (firstChild ? ` /First ${firstChild}` : "") +
      (lastChild ? ` /Last ${lastChild}` : "") +
      (kidCount ? ` /Count ${kidCount}` : "") +
      ` /Dest [${pageRef} /Fit] >>`;
    objBodies.push({ obj: itemObj(i), body });
  }

  // A patched Catalog that adds /Outlines + /PageMode /UseOutlines (so the
  // sidebar opens by default). We re-emit the Root object with the original
  // keys preserved plus our two additions.
  const rootBodyMatch = new RegExp(`\\b${rootObj}\\s+0\\s+obj([\\s\\S]*?)endobj`).exec(DEC.decode(pdf));
  if (!rootBodyMatch || rootBodyMatch[1] === undefined) throw new Error("pdf outline: could not read /Root object body");
  let rootInner = rootBodyMatch[1].trim();
  // Strip an existing /Outlines or /PageMode if present, then inject ours.
  rootInner = rootInner.replace(/\/Outlines\s+\d+\s+0\s+R/g, "").replace(/\/PageMode\s*\/\w+/g, "");
  // rootInner looks like "<< … >>" — insert before the closing ">>".
  const close = rootInner.lastIndexOf(">>");
  const patchedRoot =
    rootInner.slice(0, close) +
    ` /Outlines ${ref(outlineRootObj)} /PageMode /UseOutlines ` +
    rootInner.slice(close);
  objBodies.push({ obj: rootObj, body: patchedRoot });

  // ── Incremental update: append new object defs, a new xref, new trailer ──
  // Ensure the original ends with a newline boundary we can append after.
  const base = pdf;
  const chunks: Uint8Array[] = [base];
  // Track byte offset of each appended object for the xref.
  let offset = base.length;
  // PDF spec: incremental section should start on a new line.
  const nl = latin1Bytes("\n");
  chunks.push(nl);
  offset += nl.length;

  const xrefEntries: { obj: number; offset: number }[] = [];
  // Sort objBodies by object number for a tidy xref subsection grouping.
  objBodies.sort((a, b) => a.obj - b.obj);
  for (const ob of objBodies) {
    const def = latin1Bytes(`${ob.obj} 0 obj\n${ob.body}\nendobj\n`);
    xrefEntries.push({ obj: ob.obj, offset });
    chunks.push(def);
    offset += def.length;
  }

  // Build the xref table. Group consecutive object numbers into subsections.
  xrefEntries.sort((a, b) => a.obj - b.obj);
  const xrefStart = offset;
  let xref = "xref\n";
  let i = 0;
  while (i < xrefEntries.length) {
    let j = i;
    while (j + 1 < xrefEntries.length && xrefEntries[j + 1]!.obj === xrefEntries[j]!.obj + 1) j++;
    const startObj = xrefEntries[i]!.obj;
    const count = j - i + 1;
    xref += `${startObj} ${count}\n`;
    for (let k = i; k <= j; k++) {
      const off = String(xrefEntries[k]!.offset).padStart(10, "0");
      xref += `${off} 00000 n \n`;
    }
    i = j + 1;
  }
  const maxNewObj = xrefEntries[xrefEntries.length - 1]!.obj;
  const trailer =
    `trailer\n<< /Size ${maxNewObj + 1} /Root ${ref(rootObj)} /Prev ${prevStartXref} >>\n` +
    `startxref\n${xrefStart}\n%%EOF\n`;
  chunks.push(latin1Bytes(xref + trailer));

  return concat(chunks);
}
