/**
 * Hindu calendar for any city, with the LifeAstroAPI Node SDK.
 *
 *   LIFEASTRO_API_KEY=dv_live_... npm start -- --city Toronto
 *   LIFEASTRO_API_KEY=dv_live_... npm run html -- --city "New Delhi" --locale hi
 *   LIFEASTRO_API_KEY=dv_live_... npm start -- --city Chennai --amanta
 *
 * Prints today's panchang, this month's festivals (with the window that
 * decided each date) and the next Ekadashis with their parana window.
 * --html also writes calendar.html, a month grid you can open in a browser.
 *
 * One run costs about 80 credits; the free tier gives 1,500 a month.
 */
import { writeFileSync } from 'node:fs';
import { LifeAstro, LifeAstroError } from 'lifeastroapi';

// ── Response shapes (only the fields this example reads) ────────────────────
interface Place { name: string; label: string; latitude: number; longitude: number; timezone: string }
interface Window { label: string; start: string; end?: string }
interface Festival {
  date: string; name: string; name_en: string; name_hi: string; importance: 'major' | 'regional' | 'minor';
  vrat_type?: string; windows?: Window[]; note?: string;
}
interface Element { name: string; end_local?: string }
interface Panchang {
  sunrise_local: string; sunset_local: string; moonrise_local?: string;
  tithi: Element & { paksha: string }; nakshatra: Element; yoga: Element;
  hindu_month: { name_amanta: string; name_purnimanta: string; is_adhika: boolean };
  vara: { weekday: string };
  muhurta: { rahu_kaal: { start_local: string; end_local: string } };
}

// ── Arguments ───────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const arg = (name: string, fallback = '') => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : fallback;
};
const city = arg('city', 'New Delhi');
const locale = arg('locale', 'en');
const wantHtml = args.includes('--html');
// Month naming: purnimanta (North India, default) or amanta (South, West, East India).
const monthSystem = args.includes('--amanta') ? 'amanta' : 'purnimanta';

if (!process.env.LIFEASTRO_API_KEY) {
  console.error('Set LIFEASTRO_API_KEY first. Get a free key at https://lifeastroapi.com/signup/');
  process.exit(1);
}

// LIFEASTRO_API_URL is optional (for example a local API server); the SDK
// defaults to https://api.lifeastroapi.com.
const astro = new LifeAstro({
  apiKey: process.env.LIFEASTRO_API_KEY,
  ...(process.env.LIFEASTRO_API_URL ? { baseUrl: process.env.LIFEASTRO_API_URL } : {}),
});

const hhmm = (local?: string) => (local ? local.slice(11, 16) : '—');
const dayMonth = (date: string) =>
  new Date(`${date}T12:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', weekday: 'short', timeZone: 'UTC' });
const deciding = (f: Festival) => {
  const w = f.windows?.find((x) => x.label !== 'tithi');
  if (!w) return '';
  const label = w.label === 'parana' ? 'parana next day' : w.label.replace(/_/g, ' ');
  return w.end ? `${label} ${w.start}–${w.end}` : `${label} ${w.start}`;
};
// `name` is in the requested locale (Hindi when no regional name exists yet).
const display = (f: Festival) => (locale === 'en' || f.name === f.name_en ? f.name_en : `${f.name} (${f.name_en})`);

async function main() {
  // 1. City → latitude, longitude and IANA timezone (free endpoint).
  const found = await astro.geo.search<{ results: Place[] }>({ q: city, limit: 1 });
  const place = found.results[0];
  if (!place) throw new Error(`No place found for "${city}"`);
  const loc = { lat: place.latitude, lon: place.longitude, tz: place.timezone };

  // Today's date as the city sees it.
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: loc.tz }).format(new Date());
  const [year, month] = today.split('-').map(Number);

  // 2. Three calls in parallel: today's panchang, the month's festivals, the year's Ekadashis.
  const [p, monthRes, ekadashiRes] = await Promise.all([
    astro.panchang.advanced<Panchang>({ ...loc, date: today, time: '06:00' }),
    astro.festivals.month<{ festivals: Festival[] }>({ ...loc, year, month, locale, monthSystem }),
    astro.festivals.vrat<{ dates: Festival[] }>({ ...loc, year, type: 'ekadashi', locale, monthSystem }),
  ]);

  console.log(`\n${place.label}  ·  ${loc.tz}  ·  ${dayMonth(today)} ${year}\n`);
  console.log('Today');
  const hinduMonth = monthSystem === 'amanta' ? p.hindu_month.name_amanta : p.hindu_month.name_purnimanta;
  console.log(`  ${p.vara.weekday}, ${p.hindu_month.is_adhika ? 'Adhik ' : ''}${hinduMonth} ${p.tithi.paksha} paksha (${monthSystem})`);
  console.log(`  Sunrise ${hhmm(p.sunrise_local)}   Sunset ${hhmm(p.sunset_local)}   Moonrise ${hhmm(p.moonrise_local)}`);
  console.log(`  Tithi      ${p.tithi.name} until ${hhmm(p.tithi.end_local)}`);
  console.log(`  Nakshatra  ${p.nakshatra.name} until ${hhmm(p.nakshatra.end_local)}`);
  console.log(`  Yoga       ${p.yoga.name} until ${hhmm(p.yoga.end_local)}`);
  console.log(`  Rahu Kaal  ${hhmm(p.muhurta.rahu_kaal.start_local)}–${hhmm(p.muhurta.rahu_kaal.end_local)}`);

  // Major festivals of the month, one line per (date, name).
  const seen = new Set<string>();
  const major = monthRes.festivals.filter((f) => {
    const key = `${f.date}|${f.name_en}`;
    if (f.importance !== 'major' || f.vrat_type === 'parana' || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  console.log(`\nFestivals this month (${major.length})`);
  for (const f of major) console.log(`  ${dayMonth(f.date).padEnd(14)} ${display(f)}${deciding(f) ? `   [${deciding(f)}]` : ''}`);

  // Next three Ekadashis from today, with the parana window for the next morning.
  const upcoming = ekadashiRes.dates.filter((f) => f.date >= today && f.vrat_type === 'ekadashi').slice(0, 3);
  console.log('\nNext Ekadashis');
  for (const f of upcoming) {
    // Each Ekadashi carries its parana (fast-breaking) window, which is on the next day.
    const w = f.windows?.find((x) => x.label === 'parana');
    const nextDay = new Date(Date.parse(`${f.date}T12:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
    console.log(`  ${dayMonth(f.date).padEnd(14)} ${display(f)}${w ? `   parana ${dayMonth(nextDay)} ${w.start}–${w.end}` : ''}`);
  }

  if (wantHtml) {
    writeFileSync('calendar.html', renderHtml(place, year, month, today, p, monthRes.festivals));
    console.log('\nWrote calendar.html');
  }
  console.log('');
}

// ── A month grid as a single HTML file ──────────────────────────────────────
function renderHtml(place: Place, year: number, month: number, today: string, p: Panchang, festivals: Festival[]) {
  const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
  const first = new Date(Date.UTC(year, month - 1, 1));
  const days = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const byDate = new Map<string, Festival[]>();
  for (const f of festivals) {
    if (f.importance === 'minor' || f.vrat_type === 'parana') continue;
    const list = byDate.get(f.date) ?? [];
    if (!list.some((x) => x.name_en === f.name_en)) list.push(f);
    byDate.set(f.date, list);
  }
  const cells: string[] = Array.from({ length: first.getUTCDay() }, () => '<td></td>');
  for (let d = 1; d <= days; d++) {
    const date = `${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    const items = (byDate.get(date) ?? []).map((f) => `<li class="${f.importance}">${esc(display(f))}</li>`).join('');
    cells.push(`<td class="${date === today ? 'today' : ''}"><b>${d}</b><ul>${items}</ul></td>`);
  }
  while (cells.length % 7) cells.push('<td></td>');
  const rows = Array.from({ length: cells.length / 7 }, (_, i) => `<tr>${cells.slice(i * 7, i * 7 + 7).join('')}</tr>`).join('');
  const title = `${first.toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' })} — ${place.label}`;
  return `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
<style>
  body{font-family:system-ui,sans-serif;margin:24px;color:#1f2937;background:#fff}
  h1{font-size:22px;margin:0 0 4px} p{color:#6b7280;margin:0 0 16px}
  table{border-collapse:collapse;width:100%;table-layout:fixed}
  th{font-size:12px;color:#6b7280;padding:6px} td{border:1px solid #e5e7eb;vertical-align:top;height:96px;padding:6px;font-size:12px}
  td.today{background:#fff7ed;border-color:#f59e0b} ul{margin:4px 0 0;padding-left:14px}
  li.major{font-weight:600} li.regional{color:#6b7280}
</style>
<h1>${esc(title)}</h1>
<p>Today: ${esc(p.tithi.paksha)} ${esc(p.tithi.name)} until ${hhmm(p.tithi.end_local)} · ${esc(p.nakshatra.name)} · sunrise ${hhmm(p.sunrise_local)} · Rahu Kaal ${hhmm(p.muhurta.rahu_kaal.start_local)}–${hhmm(p.muhurta.rahu_kaal.end_local)}</p>
<table><tr>${['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d) => `<th>${d}</th>`).join('')}</tr>${rows}</table>
<p style="margin-top:12px">Data: <a href="https://lifeastroapi.com">LifeAstroAPI</a>. Dates are computed for ${esc(place.timezone)}.</p>`;
}

main().catch((e: unknown) => {
  if (e instanceof LifeAstroError) {
    // Typed SDK errors carry the API's machine-readable code.
    const hint: Record<string, string> = {
      insufficient_credits: 'Your credits are used up. Top up or wait for the monthly free credits.',
      unauthorized: 'The API key is missing or invalid.',
    };
    console.error(`LifeAstroAPI error ${e.status} ${e.code}: ${e.message}${hint[e.code] ? `\n${hint[e.code]}` : ''}`);
  } else {
    console.error(e instanceof Error ? e.message : e);
  }
  process.exit(1);
});
