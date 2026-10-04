import { describe, it, expect } from "vitest";
import { addPdfOutline, type OutlineItem } from "../src/pdf/outline.js";

/**
 * Build a minimal but structurally-valid 3-page xref-table PDF that looks like
 * what Chromium emits: a Catalog (/Root), a /Pages node, and three /Type /Page
 * objects, all referenced by a classic `xref` table + `trailer`.
 */
function minimalPdf(): Uint8Array {
  const objs: string[] = [];
  // 1: Catalog, 2: Pages, 3..5: Page, 6: a content stub
  objs[1] = `<< /Type /Catalog /Pages 2 0 R >>`;
  objs[2] = `<< /Type /Pages /Kids [3 0 R 4 0 R 5 0 R] /Count 3 >>`;
  objs[3] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] >>`;
  objs[4] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] >>`;
  objs[5] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] >>`;

  let body = "%PDF-1.4\n";
  const offsets: number[] = [];
  for (let i = 1; i <= 5; i++) {
    offsets[i] = body.length;
    body += `${i} 0 obj\n${objs[i]}\nendobj\n`;
  }
  const xrefStart = body.length;
  body += "xref\n0 6\n";
  body += "0000000000 65535 f \n";
  for (let i = 1; i <= 5; i++) body += `${String(offsets[i]).padStart(10, "0")} 00000 n \n`;
  body += `trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`;

  const out = new Uint8Array(body.length);
  for (let i = 0; i < body.length; i++) out[i] = body.charCodeAt(i) & 0xff;
  return out;
}

/** Decode every /Title (...) UTF-16BE literal from the appended outline. */
function titlesIn(pdf: Uint8Array): string[] {
  let s = "";
  for (const b of pdf) s += String.fromCharCode(b);
  const titles: string[] = [];
  const re = /\/Title\s*\(([\s\S]*?)\)\s*\//g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s)) !== null) {
    let raw = m[1]!.replace(/\\\(/g, "(").replace(/\\\)/g, ")").replace(/\\\\/g, "\\");
    if (raw.charCodeAt(0) === 0xfe && raw.charCodeAt(1) === 0xff) {
      let t = "";
      for (let i = 2; i + 1 < raw.length; i += 2) {
        t += String.fromCharCode((raw.charCodeAt(i) << 8) | raw.charCodeAt(i + 1));
      }
      titles.push(t);
    } else {
      titles.push(raw);
    }
  }
  return titles;
}

describe("addPdfOutline", () => {
  it("returns the input unchanged when there are no items", () => {
    const pdf = minimalPdf();
    expect(addPdfOutline(pdf, [])).toBe(pdf);
  });

  it("appends an /Outlines tree as an incremental update (original bytes preserved)", () => {
    const pdf = minimalPdf();
    const items: OutlineItem[] = [
      { title: "Part 1", page: 1, level: 1 },
      { title: "Section 1.1", page: 2, level: 2 },
    ];
    const out = addPdfOutline(pdf, items);

    // Incremental update: original bytes are a prefix of the result.
    expect(out.length).toBeGreaterThan(pdf.length);
    for (let i = 0; i < pdf.length; i++) expect(out[i]).toBe(pdf[i]);

    const text = (() => {
      let s = "";
      for (const b of out) s += String.fromCharCode(b);
      return s;
    })();

    // New objects, a new xref, a new trailer pointing back via /Prev.
    expect(text).toContain("/Type /Outlines");
    expect(text).toContain("/Outlines 6 0 R"); // patched Catalog → outline root (obj 6)
    expect(text).toContain("/PageMode /UseOutlines");
    expect(text.match(/\/Prev\s+\d+/)).toBeTruthy();
    expect(text.trimEnd().endsWith("%%EOF")).toBe(true);
  });

  it("preserves Devanagari titles via UTF-16BE encoding", () => {
    const out = addPdfOutline(minimalPdf(), [
      { title: "भाग 1 — आधार", page: 1, level: 1 },
      { title: "ग्रह स्थिति", page: 2, level: 2 },
    ]);
    expect(titlesIn(out)).toEqual(["भाग 1 — आधार", "ग्रह स्थिति"]);
  });

  it("clamps out-of-range pages into the document and nests by level", () => {
    const out = addPdfOutline(minimalPdf(), [
      { title: "A", page: 1, level: 1 },
      { title: "B", page: 99, level: 2 }, // clamped to last page (3)
      { title: "C", page: 2, level: 1 },
    ]);
    let s = "";
    for (const b of out) s += String.fromCharCode(b);
    // Outline root (obj 6) + 3 items (7,8,9). Titles are UTF-16BE literals, so
    // assert on the object structure (each item dict carries its /Parent ref).
    expect(s).toContain("8 0 obj"); // item B exists
    expect(s).toContain("9 0 obj"); // item C exists
    // B (level 2 after A level 1) nests under A (obj 7); C (level 1) is a
    // second top-level child of the outline root (obj 6).
    const itemB = /8 0 obj([\s\S]*?)endobj/.exec(s)?.[1] ?? "";
    const itemC = /9 0 obj([\s\S]*?)endobj/.exec(s)?.[1] ?? "";
    expect(itemB).toMatch(/\/Parent 7 0 R/);
    expect(itemC).toMatch(/\/Parent 6 0 R/);
  });
});
