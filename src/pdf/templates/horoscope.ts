/**
 * Horoscope report (daily / weekly / monthly) → branded HTML.
 *
 * Ported to consume the exact shape `client.reports.horoscope{Daily,Weekly,Monthly}()`
 * returns — the raw `horoscope.Entry` (snake_case), same wire shape as
 * `/v1/horoscope/*`. Note: the Entry carries NO branding, so branding here
 * comes entirely from the caller-supplied `branding` argument.
 */
import {
  esc,
  escList,
  resolveBranding,
  coverBrandingHtml,
  layoutDocument,
  makeLabeler,
  type Branding,
} from "../shared.js";

export interface HoroscopeSlowMover {
  planet?: string;
  current_sign?: string;
  heading?: string;
  body?: string;
  citations?: string[];
}

export interface HoroscopePanchang {
  tithi?: string;
  paksha?: string;
  nakshatra?: string;
  yoga?: string;
  karana?: string;
  vaar?: string;
  rahu_kaal?: string;
  auspicious_window?: string;
  sunrise?: string;
  sunset?: string;
}

export interface HoroscopeLucky {
  color?: string;
  number?: number;
  direction?: string;
  time?: string;
}

/** Matches the `horoscope.Entry` JSON returned by the reports/horoscope endpoints. */
export interface HoroscopeData {
  rashi?: string;
  rashi_label?: string;
  period?: "daily" | "weekly" | "monthly" | string;
  period_key?: string;
  language?: string;
  headline?: string;
  slow_movers?: HoroscopeSlowMover[];
  panchang?: HoroscopePanchang | null;
  lucky?: HoroscopeLucky | null;
  meta?: { generated_at?: string; source?: string };
}

export const LABELS: Record<string, Record<string, string>> = {
  en: {
    title_daily: "Daily Horoscope",
    title_weekly: "Weekly Horoscope",
    title_monthly: "Monthly Horoscope",
    period: "Period",
    section_transits: "Transit Influences",
    section_panchang: "Today's Panchang",
    section_lucky: "Lucky Factors",
    tithi: "Tithi",
    nakshatra: "Nakshatra",
    yoga: "Yoga",
    karana: "Karana",
    vaar: "Weekday",
    rahu_kaal: "Rahu Kaal",
    auspicious_window: "Auspicious Window",
    sunrise: "Sunrise",
    sunset: "Sunset",
    lucky_color: "Color",
    lucky_number: "Number",
    lucky_direction: "Direction",
    lucky_time: "Time",
    sources: "Sources",
  },
  hi: {
    title_daily: "दैनिक राशिफल",
    title_weekly: "साप्ताहिक राशिफल",
    title_monthly: "मासिक राशिफल",
    period: "अवधि",
    section_transits: "गोचर प्रभाव",
    section_panchang: "आज का पंचांग",
    section_lucky: "शुभ तत्व",
    tithi: "तिथि",
    nakshatra: "नक्षत्र",
    yoga: "योग",
    karana: "करण",
    vaar: "वार",
    rahu_kaal: "राहु काल",
    auspicious_window: "शुभ समय",
    sunrise: "सूर्योदय",
    sunset: "सूर्यास्त",
    lucky_color: "रंग",
    lucky_number: "अंक",
    lucky_direction: "दिशा",
    lucky_time: "समय",
    sources: "स्रोत",
  },
  mr: {
    title_daily: "दैनिक राशीभविष्य",
    title_weekly: "साप्ताहिक राशीभविष्य",
    title_monthly: "मासिक राशीभविष्य",
    period: "कालावधी",
    section_transits: "गोचर प्रभाव",
    section_panchang: "आजचे पंचांग",
    section_lucky: "शुभ घटक",
    tithi: "तिथी",
    nakshatra: "नक्षत्र",
    yoga: "योग",
    karana: "करण",
    vaar: "वार",
    rahu_kaal: "राहू काळ",
    auspicious_window: "शुभ वेळ",
    sunrise: "सूर्योदय",
    sunset: "सूर्यास्त",
    lucky_color: "रंग",
    lucky_number: "अंक",
    lucky_direction: "दिशा",
    lucky_time: "वेळ",
    sources: "स्रोत",
  },
};

function row(label: string, value: unknown): string {
  const v = esc(value);
  return v === "" ? "" : `<tr><th>${esc(label)}</th><td>${v}</td></tr>`;
}

function card(label: string, value: unknown): string {
  const v = esc(value);
  return v === "" ? "" : `<div class="card"><div class="label">${esc(label)}</div><div class="value">${v}</div></div>`;
}

/** Render a horoscope report (daily/weekly/monthly) to a branded HTML document. */
export function renderHoroscopeHtml(data: HoroscopeData, branding?: Branding): string {
  // The Entry has no embedded branding — only the caller can brand it.
  const b = resolveBranding(undefined, branding);
  const t = makeLabeler(LABELS, data.language);

  const period = typeof data.period === "string" ? data.period : "daily";
  const title = t(`title_${period}`) || t("title_daily");
  const subject = esc(data.rashi_label || data.rashi);

  const cover = `
<section class="cover">
  ${coverBrandingHtml(b)}
  <h1>${esc(title)}</h1>
  ${subject ? `<div class="subject">${subject}</div>` : ""}
  ${data.period_key ? `<div class="meta">${esc(t("period"))}: ${esc(data.period_key)}</div>` : ""}
</section>`;

  const headline = data.headline ? `<p><strong>${esc(data.headline)}</strong></p>` : "";

  // Transit (slow-mover) narratives — heading + body already localized.
  let transits = "";
  if (Array.isArray(data.slow_movers) && data.slow_movers.length) {
    const blocks = data.slow_movers
      .map((sm) => {
        const fallbackHead = [sm.planet, sm.current_sign].filter(Boolean).map((x) => esc(x)).join(" — ");
        const heading = esc(sm.heading) || fallbackHead;
        const cites =
          Array.isArray(sm.citations) && sm.citations.length
            ? `<div class="citations">${esc(t("sources"))}: ${escList(sm.citations)}</div>`
            : "";
        return `<div class="narrative-section"><h3>${heading}</h3><div class="body">${esc(sm.body)}</div>${cites}</div>`;
      })
      .join("\n");
    transits = `<h2>${esc(t("section_transits"))}</h2>\n${blocks}`;
  }

  // Panchang (daily).
  let panchang = "";
  const p = data.panchang;
  if (p) {
    const rows = [
      row(t("tithi"), [p.tithi, p.paksha].filter(Boolean).join(" / ")),
      row(t("nakshatra"), p.nakshatra),
      row(t("yoga"), p.yoga),
      row(t("karana"), p.karana),
      row(t("vaar"), p.vaar),
      row(t("rahu_kaal"), p.rahu_kaal),
      row(t("auspicious_window"), p.auspicious_window),
      row(t("sunrise"), p.sunrise),
      row(t("sunset"), p.sunset),
    ].join("");
    if (rows) panchang = `<h2>${esc(t("section_panchang"))}</h2><table>${rows}</table>`;
  }

  // Lucky factors (daily).
  let lucky = "";
  const l = data.lucky;
  if (l) {
    const cards = [
      card(t("lucky_color"), l.color),
      card(t("lucky_number"), typeof l.number === "number" ? l.number : ""),
      card(t("lucky_direction"), l.direction),
      card(t("lucky_time"), l.time),
    ].join("");
    if (cards) lucky = `<h2>${esc(t("section_lucky"))}</h2><div class="cards">${cards}</div>`;
  }

  const bodyHtml = `${cover}\n${headline}\n${transits}\n${panchang}\n${lucky}`;

  return layoutDocument({
    lang: data.language || "en",
    title: `${title}${subject ? ` — ${data.rashi_label || data.rashi}` : ""}`,
    branding: b,
    bodyHtml,
  });
}
