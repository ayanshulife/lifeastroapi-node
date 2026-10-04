/**
 * Query-parameter builders. Each `q*` helper maps an ergonomic SDK input
 * object to the exact wire parameter names the API expects (e.g. `birth.lat`,
 * `boy.date`, `start_date`). The generated resource methods call these.
 *
 * These mappings are the contract with the API. They are verified against a
 * real server by `npm run live` (scripts/live-sweep.mjs), not just by unit tests.
 */
import type { QueryParams } from "./types.js";

/** Set `key` on `q` only when `value` is meaningful (skips undefined/null/""). */
export function set(q: QueryParams, key: string, value: unknown): void {
  if (value === undefined || value === null || value === "") return;
  q[key] = value as QueryParams[string];
}

/** Apply a list of `[inputField, wireName]` mappings from `input` onto `q`. */
export function applyExtras(
  q: QueryParams,
  input: Record<string, any>,
  extras: ReadonlyArray<readonly [string, string]>,
): QueryParams {
  for (const [field, wire] of extras) set(q, wire, input[field]);
  return q;
}

/** Substitute `{name}` placeholders in a path template with input values. */
export function buildPath(
  template: string,
  input: Record<string, any>,
  names: readonly string[],
): string {
  let path = template;
  for (const name of names) {
    const value = input[name];
    if (value === undefined || value === null || value === "") {
      throw new TypeError(`Missing required path parameter "${name}" for ${template}`);
    }
    path = path.split(`{${name}}`).join(encodeURIComponent(String(value)));
  }
  return path;
}

type AnyInput = Record<string, any>;

/**
 * Today's date (`YYYY-MM-DD`) in `tz`. The API has no "today" default — every
 * moment endpoint rejects a request without `date` — so the SDK supplies it.
 * Falls back to the UTC date when the runtime cannot resolve `tz`.
 */
export function todayIn(tz?: string, now: Date = new Date()): string {
  if (tz) {
    try {
      // en-CA formats as YYYY-MM-DD.
      return new Intl.DateTimeFormat("en-CA", {
        timeZone: tz,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).format(now);
    } catch {
      // Unknown zone name or an offset form this runtime does not accept.
    }
  }
  return now.toISOString().slice(0, 10);
}

/** panchang-style moment: lat/lon/tz + date (default today) + optional time + ayanamsa. */
export function qMoment(i: AnyInput): QueryParams {
  const q: QueryParams = {};
  set(q, "lat", i.lat);
  set(q, "lon", i.lon);
  set(q, "tz", i.tz);
  set(q, "date", i.date ?? todayIn(i.tz));
  set(q, "time", i.time);
  set(q, "ayanamsa", i.ayanamsa);
  return q;
}

/** flat birth: lat/lon/date/time/tz + ayanamsa/house_system. */
export function qBirth(i: AnyInput): QueryParams {
  const q: QueryParams = {};
  set(q, "lat", i.lat);
  set(q, "lon", i.lon);
  set(q, "date", i.date);
  set(q, "time", i.time);
  set(q, "tz", i.tz);
  set(q, "ayanamsa", i.ayanamsa);
  set(q, "house_system", i.houseSystem);
  return q;
}

/** birth.* prefixed birth descriptor + ayanamsa. */
export function qBirthPrefixed(i: AnyInput): QueryParams {
  const q: QueryParams = {};
  set(q, "birth.lat", i.lat);
  set(q, "birth.lon", i.lon);
  set(q, "birth.date", i.date);
  set(q, "birth.time", i.time);
  set(q, "birth.tz", i.tz);
  set(q, "ayanamsa", i.ayanamsa);
  return q;
}

/** boy. / girl. prefixed matchmaking pair (boy = groom, girl = bride) + ayanamsa. */
export function qBoyGirl(i: AnyInput): QueryParams {
  const q: QueryParams = {};
  const boy = (i.boy ?? {}) as AnyInput;
  const girl = (i.girl ?? {}) as AnyInput;
  set(q, "boy.lat", boy.lat);
  set(q, "boy.lon", boy.lon);
  set(q, "boy.date", boy.date);
  set(q, "boy.time", boy.time);
  set(q, "boy.tz", boy.tz);
  set(q, "girl.lat", girl.lat);
  set(q, "girl.lon", girl.lon);
  set(q, "girl.date", girl.date);
  set(q, "girl.time", girl.time);
  set(q, "girl.tz", girl.tz);
  set(q, "ayanamsa", i.ayanamsa);
  return q;
}

/** personA. / personB. prefixed Western pair. */
export function qTwoPerson(i: AnyInput): QueryParams {
  const q: QueryParams = {};
  const a = (i.personA ?? {}) as AnyInput;
  const b = (i.personB ?? {}) as AnyInput;
  set(q, "personA.lat", a.lat);
  set(q, "personA.lon", a.lon);
  set(q, "personA.date", a.date);
  set(q, "personA.time", a.time);
  set(q, "personA.tz", a.tz);
  set(q, "personB.lat", b.lat);
  set(q, "personB.lon", b.lon);
  set(q, "personB.date", b.date);
  set(q, "personB.time", b.time);
  set(q, "personB.tz", b.tz);
  return q;
}

/** horoscope-by-sign: rashi (lowercased) + optional date/lang. */
export function qRashi(i: AnyInput): QueryParams {
  const q: QueryParams = {};
  const rashi = typeof i.rashi === "string" ? i.rashi.trim().toLowerCase() : i.rashi;
  set(q, "rashi", rashi);
  set(q, "date", i.date);
  set(q, "lang", i.lang);
  return q;
}

/** numerology: optional name/dob/lang. */
export function qNumerology(i: AnyInput): QueryParams {
  const q: QueryParams = {};
  set(q, "name", i.name);
  set(q, "dob", i.dob);
  set(q, "lang", i.lang);
  return q;
}

/** start_date/end_date window. */
export function qDateRange(i: AnyInput): QueryParams {
  const q: QueryParams = {};
  set(q, "start_date", i.startDate);
  set(q, "end_date", i.endDate);
  return q;
}

/** Western natal: flat birth + optional house_system. */
export function qWesternNatal(i: AnyInput): QueryParams {
  const q: QueryParams = {};
  set(q, "lat", i.lat);
  set(q, "lon", i.lon);
  set(q, "date", i.date);
  set(q, "time", i.time);
  set(q, "tz", i.tz);
  set(q, "house_system", i.houseSystem);
  return q;
}

/** Western transit moment: date/time/tz only. */
export function qWesternMoment(i: AnyInput): QueryParams {
  const q: QueryParams = {};
  set(q, "date", i.date);
  set(q, "time", i.time);
  set(q, "tz", i.tz);
  return q;
}

/** muhurta search: location + start_date/end_date window. */
export function qMuhurta(i: AnyInput): QueryParams {
  const q: QueryParams = {};
  set(q, "lat", i.lat);
  set(q, "lon", i.lon);
  set(q, "tz", i.tz);
  set(q, "start_date", i.startDate);
  set(q, "end_date", i.endDate);
  return q;
}

/** natal (birth.*) + a separate flat transit moment (date/time/tz). */
export function qNatalTransit(i: AnyInput): QueryParams {
  const q: QueryParams = {};
  const b = (i.birth ?? {}) as AnyInput;
  set(q, "birth.lat", b.lat);
  set(q, "birth.lon", b.lon);
  set(q, "birth.date", b.date);
  set(q, "birth.time", b.time);
  set(q, "birth.tz", b.tz);
  set(q, "date", i.date);
  set(q, "time", i.time);
  set(q, "tz", i.tz);
  set(q, "ayanamsa", i.ayanamsa);
  return q;
}

/** A location-less moment: date (default today) + optional time + tz (default UTC) + ayanamsa. */
export function qInstant(i: AnyInput = {}): QueryParams {
  const q: QueryParams = {};
  const tz = i.tz ?? "UTC";
  set(q, "tz", tz);
  set(q, "date", i.date ?? todayIn(tz));
  set(q, "time", i.time);
  set(q, "ayanamsa", i.ayanamsa);
  return q;
}

/** Empty query (shapes `none` / `custom` build from extras only). */
export function qNone(_input?: unknown): QueryParams {
  return {};
}
