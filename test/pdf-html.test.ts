import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import * as html from "../src/pdf/html.js";
import * as pdf from "../src/pdf/index.js";

const SRC = resolve(dirname(fileURLToPath(import.meta.url)), "..", "src");

/** Every source file reachable from `entry` through static imports / re-exports. */
function importGraph(entry: string): string[] {
  const seen = new Set<string>();
  const walk = (file: string) => {
    if (seen.has(file)) return;
    seen.add(file);
    const code = readFileSync(file, "utf8");
    for (const m of code.matchAll(/(?:import|export)\s[^;]*?from\s+"(\.[^"]+)"/g)) {
      walk(resolve(dirname(file), (m[1] as string).replace(/\.js$/, ".ts")));
    }
  };
  walk(entry);
  return [...seen];
}

describe("lifeastroapi/pdf-html (React Native / browser-safe entry)", () => {
  it("exports every HTML renderer and branding helper of lifeastroapi/pdf", () => {
    const names = Object.keys(pdf).filter((k) => /^render.*Html$/.test(k));
    expect(names).toHaveLength(10);
    for (const k of [...names, "resolveBranding", "esc", "escBody", "humanize", "cleanNarrative"]) {
      expect((html as Record<string, unknown>)[k], k).toBe((pdf as Record<string, unknown>)[k]);
    }
    expect(pdf.A4_PRINT_OPTIONS).toBe(html.A4_PRINT_OPTIONS);
  });

  it("has no PDF engine: nothing that needs Puppeteer", () => {
    for (const k of Object.keys(html)) expect(k).not.toMatch(/Pdf|Outline/);
  });

  it("reaches no Node-only code (Metro cannot bundle a dynamic import or a node: module)", () => {
    const files = importGraph(resolve(SRC, "pdf", "html.ts"));
    expect(files.length).toBeGreaterThan(10);
    for (const f of files) {
      expect(f).not.toMatch(/pdf\/(render|outline|index)\.ts$/);
      const code = readFileSync(f, "utf8").replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");
      expect(code, f).not.toMatch(/\bimport\(|\brequire\(|from "node:|\bprocess\.|\bBuffer\b|puppeteer/);
    }
  });

  it("A4_PRINT_OPTIONS is A4 with the templates' @page margins, in points", async () => {
    const mm = (v: number) => Math.round((v * 72) / 25.4);
    expect(html.A4_PRINT_OPTIONS).toEqual({
      width: mm(210),
      height: mm(297),
      margins: { top: mm(18), right: mm(15), bottom: mm(22), left: mm(15) },
    });
    // The numbers above are the template's own @page rule.
    expect(readFileSync(resolve(SRC, "pdf", "shared.ts"), "utf8")).toContain("@page { size: A4; margin: 18mm 15mm 22mm 15mm; }");
  });

  it("renders a complete document", () => {
    const out = html.renderNumerologyHtml({ Locale: "en", Name: "Arjun Mehta" } as never, { companyName: "Acme Astro" });
    expect(out).toMatch(/^<!doctype html>/i);
    expect(out).toContain("Acme Astro");
  });
});
