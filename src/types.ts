/**
 * Shared request/response types for the LifeAstroAPI SDK.
 *
 * Response payloads (`data`) are intentionally typed as `unknown` at the SDK
 * boundary: the API surfaces ~270 distinct response shapes and they evolve
 * independently of this client. Pass a type parameter to any call to narrow
 * it yourself, e.g. `client.chart.planets<MyPlanetsShape>(birth)`.
 */

/** Diagnostic metadata of a `{ data, meta }` envelope, when one is present. */
export interface ResponseMeta {
  request_id?: string;
  computed_at?: string;
  cache?: "hit" | "miss" | (string & {});
  tier?: string;
  [key: string]: unknown;
}

/**
 * An optional `{ data, meta }` wrapper. The API returns the payload directly
 * (bare JSON); the SDK unwraps this envelope only if a response carries one.
 */
export interface ResponseEnvelope<T = unknown> {
  data: T;
  meta?: ResponseMeta;
}

/** Sidereal ayanamsha systems supported by the API. */
export type Ayanamsa =
  | "lahiri"
  | "krishnamurti"
  | "raman"
  | "fagan"
  | "yukteshwar"
  | "true_chitrapaksha";

/** House systems supported by the API. */
export type HouseSystem =
  | "whole-sign"
  | "equal"
  | "placidus"
  | "koch"
  | "porphyry"
  | "campanus"
  | "regiomontanus";

/**
 * Response language, passed as `lang` on Vedic methods (panchang, calendar,
 * festivals, eclipses, planet moments, transit, milan, muhurta, chart, prashna,
 * numerology, dasha, varshaphal, ashtakavarga, Lal Kitab, horoscope, reports,
 * narrative, remedies).
 *
 * - Complete: `en`, `hi`, `mr`, `te`, `ta`, `kn`, `ml`, `gu`, `bn`. Names, terms
 *   and prose all come back in the language.
 * - Partial: `pa`. Names and terms come back in the language; longer prose is
 *   still English.
 *
 * Ids, dates, numbers and explicit `*_en` / `*_hi` fields stay as they are in
 * every language. Western, Tarot, geo and meta methods answer in English
 * (Western narrative also in `hi` and `mr`).
 */
export type Locale = "en" | "hi" | "mr" | "te" | "ta" | "kn" | "ml" | "gu" | "bn" | "pa";

/**
 * A birth (or event) moment with a fixed location. `date`/`time`/`tz` describe
 * the civil moment; `lat`/`lon` the observer.
 */
export interface BirthInput {
  /** ISO date, `YYYY-MM-DD`. */
  date: string;
  /** 24-hour time, `HH:MM`. */
  time: string;
  /** IANA name (`Asia/Kolkata`) or fixed offset (`+05:30`). */
  tz: string;
  /** Latitude in decimal degrees, north positive. */
  lat: number;
  /** Longitude in decimal degrees, east positive. */
  lon: number;
}

/**
 * A moment + location for panchang-style queries. `date` is optional: the API
 * itself requires one, so the SDK sends today's date in `tz` when you omit it.
 */
export interface MomentInput {
  /** Latitude in decimal degrees, north positive. */
  lat: number;
  /** Longitude in decimal degrees, east positive. */
  lon: number;
  /** IANA name (`Asia/Kolkata`) or fixed offset (`+05:30`). */
  tz: string;
  /** ISO date, `YYYY-MM-DD`. Defaults to today in `tz`. */
  date?: string;
  /** 24-hour time, `HH:MM`. */
  time?: string;
}

/**
 * A moment with no location (planet positions, ayanamsa values). Everything is
 * optional: the SDK sends today's date and `UTC` when omitted.
 */
export interface InstantInput {
  /** ISO date, `YYYY-MM-DD`. Defaults to today in `tz`. */
  date?: string;
  /** 24-hour time, `HH:MM`. The API uses 12:00 when omitted. */
  time?: string;
  /** IANA name (`Asia/Kolkata`) or fixed offset (`+05:30`). Defaults to `UTC`. */
  tz?: string;
}

/** Calculation settings accepted by most Vedic moment endpoints. */
export interface VedicMomentSettings {
  ayanamsa?: Ayanamsa;
}

/** Calculation settings accepted by most Vedic birth-chart endpoints. */
export interface VedicBirthSettings {
  ayanamsa?: Ayanamsa;
  houseSystem?: HouseSystem;
}

/** Two birth charts for Vedic matchmaking (`boy` = groom, `girl` = bride). */
export interface BoyGirlInput {
  boy: BirthInput;
  girl: BirthInput;
}

/** Two birth charts for Western synastry / composite work. */
export interface TwoPersonInput {
  personA: BirthInput;
  personB: BirthInput;
}

/** Horoscope-by-sign input. `rashi` is case-insensitive (English or Hindi). */
export interface RashiInput {
  rashi: string;
  date?: string;
  lang?: Locale;
}

/** Numerology input. Provide `name` and/or `dob` depending on the number. */
export interface NumerologyInput {
  /** Full name as written on official documents. */
  name?: string;
  /** Date of birth, `YYYY-MM-DD`. */
  dob?: string;
  lang?: Locale;
}

/** A `[startDate, endDate]` window (`YYYY-MM-DD`). */
export interface DateRangeInput {
  startDate: string;
  endDate: string;
}

/** A Western natal chart input (tropical). */
export interface WesternNatalInput extends BirthInput {
  houseSystem?: HouseSystem;
}

/** A Western transit moment (no location needed). */
export interface WesternMomentInput {
  date: string;
  time: string;
  tz: string;
}

/** A muhurta search: a location plus a `[startDate, endDate]` window. */
export interface MuhurtaInput {
  lat: number;
  lon: number;
  tz: string;
  startDate: string;
  endDate: string;
}

/**
 * A natal chart plus a separate transit moment — used by transits-to-natal
 * style endpoints. `birth` is the natal data; `date`/`time`/`tz` describe the
 * moment whose transits are evaluated against it.
 */
export interface NatalTransitInput {
  birth: BirthInput;
  /** Transit date, `YYYY-MM-DD`. */
  date: string;
  /** Transit time, `HH:MM`. */
  time: string;
  /** Transit timezone (IANA or fixed offset). */
  tz: string;
}

/**
 * Natal chart for the window endpoints. Only date, time and tz are needed for
 * the natal Moon; lat/lon add the lagna-based fields where an endpoint has them.
 */
export interface NatalWindowBirth {
  /** ISO date, `YYYY-MM-DD`. */
  date: string;
  /** 24-hour time, `HH:MM`. */
  time: string;
  /** IANA name (`Asia/Kolkata`) or fixed offset (`+05:30`). */
  tz: string;
  lat?: number;
  lon?: number;
}

/**
 * Natal chart (sent as `birth.*`) plus a date range: `from` (`YYYY-MM-DD`,
 * local midnight in `tz`, default now) and `tz`, the zone of every `*_local`
 * value in the response (default the birth tz).
 */
export interface NatalWindowInput {
  birth: NatalWindowBirth;
  from?: string;
  tz?: string;
}

/** Like {@link NatalWindowInput}, but the natal chart is optional. */
export interface OptionalNatalWindowInput {
  birth?: NatalWindowBirth;
  from?: string;
  tz?: string;
}

/** Low-level query value. */
export type QueryValue = string | number | boolean | null | undefined;
export type QueryParams = Record<string, QueryValue>;
