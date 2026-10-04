/**
 * Inline SVG planet glyphs for the "Graha Sthiti" planet-cards grid.
 *
 * Self-contained (no external image assets) so the PDF renders anywhere.
 * Each glyph is a small, recognizable stylized disc/icon in the planet's
 * conventional colour — Sun (orange rayed disc), Moon (crescent), Mars (red),
 * Mercury (grey), Jupiter (banded amber), Venus (soft yellow), Saturn (ringed),
 * Rahu / Ketu (node serpent-head/tail icons).
 */

const G = (inner: string): string =>
  `<svg viewBox="0 0 48 48" width="34" height="34" xmlns="http://www.w3.org/2000/svg">${inner}</svg>`;

export const PLANET_GLYPHS: Record<string, string> = {
  Sun: G(`
    <g stroke="#e8821b" stroke-width="2" stroke-linecap="round">
      ${Array.from({ length: 12 }, (_, i) => {
        const a = (i * 30 * Math.PI) / 180;
        const x1 = 24 + Math.cos(a) * 17, y1 = 24 + Math.sin(a) * 17;
        const x2 = 24 + Math.cos(a) * 22, y2 = 24 + Math.sin(a) * 22;
        return `<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}"/>`;
      }).join("")}
    </g>
    <circle cx="24" cy="24" r="13" fill="#f6a623"/>
    <circle cx="24" cy="24" r="13" fill="none" stroke="#e8821b" stroke-width="1.5"/>`),
  Moon: G(`
    <circle cx="24" cy="24" r="15" fill="#d7dbe0"/>
    <circle cx="29" cy="24" r="13" fill="#ffffff"/>
    <circle cx="19" cy="20" r="2" fill="#c2c8d0"/><circle cx="17" cy="27" r="1.4" fill="#c2c8d0"/>`),
  Mars: G(`
    <circle cx="24" cy="24" r="15" fill="#c0392b"/>
    <ellipse cx="20" cy="20" rx="6" ry="3" fill="#a93226" transform="rotate(-20 20 20)"/>
    <ellipse cx="28" cy="29" rx="5" ry="2.5" fill="#e06352"/>`),
  Mercury: G(`
    <circle cx="24" cy="24" r="15" fill="#9aa3ab"/>
    <circle cx="19" cy="20" r="3" fill="#828b94"/><circle cx="30" cy="28" r="2" fill="#828b94"/>`),
  Jupiter: G(`
    <circle cx="24" cy="24" r="15" fill="#d9a441"/>
    <path d="M9 19 H39 M9 24 H39 M11 29 H37" stroke="#b8860b" stroke-width="2.4" fill="none"/>
    <ellipse cx="28" cy="27" rx="3.5" ry="2" fill="#a8521b"/>`),
  Venus: G(`
    <circle cx="24" cy="24" r="15" fill="#e9d27a"/>
    <ellipse cx="22" cy="22" rx="7" ry="4" fill="#f0dd9a" transform="rotate(-15 22 22)"/>`),
  Saturn: G(`
    <ellipse cx="24" cy="24" rx="22" ry="7" fill="none" stroke="#b0884a" stroke-width="2.4" transform="rotate(-18 24 24)"/>
    <circle cx="24" cy="24" r="12" fill="#cdb06b"/>`),
  Rahu: G(`
    <circle cx="24" cy="24" r="16" fill="#6d4c8c"/>
    <path d="M16 30 q-2 -12 8 -12 q10 0 8 12" fill="none" stroke="#fff" stroke-width="2.6" stroke-linecap="round"/>
    <circle cx="24" cy="30" r="2.4" fill="#fff"/>`),
  Ketu: G(`
    <circle cx="24" cy="24" r="16" fill="#0f8a7e"/>
    <path d="M16 18 q-2 12 8 12 q10 0 8 -12" fill="none" stroke="#fff" stroke-width="2.6" stroke-linecap="round"/>
    <circle cx="24" cy="18" r="2.4" fill="#fff"/>`),
  // Outer planets (shown only if present in data)
  Uranus: G(`<circle cx="24" cy="24" r="15" fill="#6fd0d6"/><ellipse cx="24" cy="24" rx="20" ry="5" fill="none" stroke="#3fa9b0" stroke-width="2" transform="rotate(70 24 24)"/>`),
  Neptune: G(`<circle cx="24" cy="24" r="15" fill="#3f6fd6"/><path d="M12 22 q12 6 24 0" stroke="#2a52b0" stroke-width="2.2" fill="none"/>`),
  Pluto: G(`<circle cx="24" cy="24" r="13" fill="#9b7b6b"/>`),
};

/** Devanagari planet name → English key, for HI/MR data. */
const HI_TO_EN: Record<string, string> = {
  "सूर्य": "Sun", "चंद्र": "Moon", "चन्द्र": "Moon", "मंगल": "Mars", "बुध": "Mercury",
  "गुरु": "Jupiter", "बृहस्पति": "Jupiter", "शुक्र": "Venus", "शनि": "Saturn",
  "राहु": "Rahu", "केतु": "Ketu", "अरुण": "Uranus", "वरुण": "Neptune", "यम": "Pluto",
};

/** Return the glyph SVG for a planet name (EN or Devanagari), or "". */
export function planetGlyph(name: string | undefined): string {
  if (!name) return "";
  const key = PLANET_GLYPHS[name] ? name : HI_TO_EN[name] ?? name;
  return PLANET_GLYPHS[key] ?? "";
}
