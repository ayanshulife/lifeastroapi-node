/**
 * North-Indian (diamond) chart SVG generator.
 *
 * The North-Indian kundli is a fixed diamond: an outer square crossed by both
 * diagonals, with a rotated inner square joining the four edge-midpoints. This
 * makes 12 fixed house cells. House 1 (lagna) is the top-centre cell; houses
 * run anticlockwise. The SIGN NUMBER printed in each cell is fixed by the
 * lagna (house-1 sign), then +1 per house. Planets are drawn in their house.
 *
 * Pure string output — no DOM, no deps. Used by the Brihad template.
 */

import { esc } from "../shared.js";

/** One planet to place: short label + house (1..12) + optional flags. */
export interface ChartPlanet {
  label: string; // e.g. "Su", "सू", "Ra"
  house: number; // 1..12
  retro?: boolean;
  color?: string; // optional per-planet color
}

export interface NorthChartOptions {
  /** 0-based sign index of house 1 (the lagna sign). Aries=0. */
  lagnaSignIndex: number;
  planets: ChartPlanet[];
  /** Chart title shown above (e.g. "Lagna Kundali"). */
  title?: string;
  /** px size of the square. Default 200. */
  size?: number;
  /** Accent color for the diamond strokes + sign numbers. */
  accent?: string;
}

/**
 * House cell CENTRES for a 100×100 viewBox — the canonical North-Indian
 * diamond layout. House 1 = top-centre inner diamond; houses run
 * anticlockwise. The 4 inner diamonds are houses 1/4/7/10; the 8 corner
 * triangles are 2,3 / 5,6 / 8,9 / 11,12. The SAME centre is used for the
 * sign-number and the planets of a house (number printed just above the
 * planets) so they always land in the correct, single cell.
 */
const HOUSE_XY: Record<number, [number, number]> = {
  1: [50, 25],   // top inner diamond
  2: [25, 8],    // top-left, upper triangle
  3: [9, 25],    // top-left, lower triangle
  4: [25, 50],   // left inner diamond
  5: [9, 75],    // bottom-left, upper triangle
  6: [25, 92],   // bottom-left, lower triangle
  7: [50, 75],   // bottom inner diamond
  8: [75, 92],   // bottom-right, lower triangle
  9: [91, 75],   // bottom-right, upper triangle
  10: [75, 50],  // right inner diamond
  11: [91, 25],  // top-right, lower triangle
  12: [75, 8],   // top-right, upper triangle
};

/**
 * Render a North-Indian diamond chart as an inline SVG string.
 */
export function northIndianChartSvg(opts: NorthChartOptions): string {
  const size = opts.size ?? 200;
  const accent = opts.accent ?? "#e0701c";
  const signColor = "#5a5a5a";
  const lagna = ((opts.lagnaSignIndex % 12) + 12) % 12;

  // Group planet labels by house.
  const byHouse = new Map<number, ChartPlanet[]>();
  for (const p of opts.planets) {
    if (p.house < 1 || p.house > 12) continue;
    const arr = byHouse.get(p.house) ?? [];
    arr.push(p);
    byHouse.set(p.house, arr);
  }

  // Frame: outer square + two diagonals + inner diamond (edge midpoints).
  const frame = `
    <rect x="1" y="1" width="98" height="98" fill="none" stroke="${accent}" stroke-width="0.8"/>
    <line x1="1" y1="1" x2="99" y2="99" stroke="${accent}" stroke-width="0.5"/>
    <line x1="99" y1="1" x2="1" y2="99" stroke="${accent}" stroke-width="0.5"/>
    <polygon points="50,1 99,50 50,99 1,50" fill="none" stroke="${accent}" stroke-width="0.5"/>`;

  // Sign (rashi) number per house — printed small, just above the cell
  // centre so planets sit below it. For the two top corner-triangle houses
  // (centre very close to the top edge) the number would touch the frame, so
  // there it's nudged DOWN (below the centre) instead of up.
  let signs = "";
  for (let h = 1; h <= 12; h++) {
    const sign = ((lagna + h - 1) % 12) + 1;
    const pos = HOUSE_XY[h]; if (!pos) continue;
    const [cx, cy] = pos;
    // Top-edge corner cells: number just below the top border (small offset),
    // so it clears the frame yet stays above any planets in that cell.
    const ny = cy < 12 ? cy + 2.5 : cy - 6;
    signs += `<text x="${cx}" y="${ny}" font-size="4.4" fill="${signColor}" font-weight="600" text-anchor="middle" dominant-baseline="middle">${sign}</text>`;
  }

  // Planets per house (stacked, wrapping ~3 per line).
  let planetsSvg = "";
  for (const [h, arr] of byHouse) {
    const pos = HOUSE_XY[h];
    if (!pos) continue;
    const [cx, cy] = pos;
    const labels = arr.map((p) => (p.retro ? `${p.label}` : p.label));
    // layout up to 3 per row
    const perRow = 3;
    const rows: string[][] = [];
    for (let i = 0; i < labels.length; i += perRow) rows.push(labels.slice(i, i + perRow));
    const lineH = 4.6;
    // Planets sit below the sign-number. Normal cells: number is above centre
    // so planets centre near cy. Top-edge corner cells: number is near the
    // top border (cy+2.5), so planets must start further down to clear it.
    const topEdge = cy < 12;
    const anchor = topEdge ? cy + 9 : cy + 1.5;
    const startY = anchor - ((rows.length - 1) * lineH) / 2;
    rows.forEach((row, ri) => {
      const y = startY + ri * lineH;
      const text = row
        .map((lbl, ci) => {
          const p = arr[ri * perRow + ci];
          const col = p?.color ?? "#1a2a6c";
          return `<tspan fill="${col}">${esc(lbl)}</tspan>`;
        })
        .join('<tspan> </tspan>');
      planetsSvg += `<text x="${cx}" y="${y}" font-size="4.6" font-weight="bold" text-anchor="middle" dominant-baseline="middle">${text}</text>`;
    });
  }

  const titleHtml = opts.title
    ? `<div style="font-size:10pt;font-weight:700;color:${accent};margin-bottom:1.5mm;">${esc(opts.title)}</div>`
    : "";

  return `<div class="north-chart" style="display:inline-block;text-align:center;margin:2mm 3mm;">
${titleHtml}
<svg viewBox="0 0 100 100" width="${size}" height="${size}" style="font-family:Arial,sans-serif;">
${frame}
${signs}
${planetsSvg}
</svg>
</div>`;
}

/** Short planet labels (EN + Devanagari) for chart cells. */
export const PLANET_LABELS_EN: Record<string, string> = {
  Sun: "Su", Moon: "Mo", Mars: "Ma", Mercury: "Me", Jupiter: "Ju",
  Venus: "Ve", Saturn: "Sa", Rahu: "Ra", Ketu: "Ke",
  Uranus: "Ur", Neptune: "Ne", Pluto: "Pl",
};
export const PLANET_LABELS_HI: Record<string, string> = {
  Sun: "सू", Moon: "चं", Mars: "मं", Mercury: "बु", Jupiter: "गु",
  Venus: "शु", Saturn: "श", Rahu: "रा", Ketu: "के",
  Uranus: "यू", Neptune: "ने", Pluto: "प्लू",
};

/** Per-planet colors (loosely matching benchmark's colorful abbreviations). */
export const PLANET_COLORS: Record<string, string> = {
  Sun: "#e05e18", Moon: "#3a7bd5", Mars: "#c0392b", Mercury: "#27928a",
  Jupiter: "#b8860b", Venus: "#c026a0", Saturn: "#2c3e50", Rahu: "#6d4c41", Ketu: "#00897b",
};
