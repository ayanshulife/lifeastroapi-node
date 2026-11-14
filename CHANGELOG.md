# Changelog

## 0.8.0 — 2026-11-14

- Bengali (`bn`) is now a complete language. Every Vedic method answers in Bengali with `lang: "bn"`: names, labels and the authored readings (8,469 interpretation rows and the Lal Kitab remedies, written from the Hindi source).
- PDF reports render fully in Bengali: all templates have native labels, chart sign and planet names (North Indian chart labels সূ চ ম বু বৃ শু শ রা কে), dasha and Yogini lord names, weekday names and the `Noto Sans Bengali` font.
- `Locale` docs: complete languages are now `en`, `hi`, `mr`, `te`, `ta`, `kn`, `ml`, `gu`, `bn`; `pa` returns names and terms, longer text is still English.

## 0.7.0 — 2026-11-13

- PDF reports now render fully in Gujarati (`gu`): all templates have native labels, chart sign and planet names (North Indian chart labels સૂ ચં મં બુ ગુ શુ શ રા કે), dasha and Yogini lord names, weekday names and the `Noto Sans Gujarati` font. `Locale` now includes `"gu"`.
- Gujarati text addresses the reader as આપ, uses the nakshatra spellings of printed Gujarati panchangs, and keeps remedies to steps the reader can do at home.
- Every Vedic method whose response carries names or text now takes an optional `lang` (122 more methods): `panchang.*`, `calendar.*`, `festivals.*`, `eclipses.*`, `planetMoments.*`, `transit.*`, `milan.*`, `muhurta.*`, `chart.*`, `prashna.*`, `dasha.*`, `varshaphal.*`, `ashtakavarga.*`, `lalkitab.*`, plus `narrative.horoscopeDailyTamil`, `narrative.yearlyBhavishyafal` and the five `remedies` methods that had only `locale`. Example: `client.panchang.basic({ lat, lon, tz, lang: "gu" })`. The existing `locale` input of `festivals.*`, `panchang.monthly` and `remedies.*` still works; `lang` wins when both are given. Methods that return only times, numbers or ids (for example `panchang.rahuKaal`, `chart.yogas`, `transit.windows`) and the Western, Tarot, geo and meta methods have no `lang`.
- Numerology methods (`numerology.*`, `reports.numerology`) now answer in the `lang` you pass; before, the API returned English for every language.
- Complete languages: `en`, `hi`, `mr`, `te`, `ta`, `kn`, `ml`, `gu`. `Locale` gains `"pa"` (Punjabi); `bn` and `pa` return names and terms in the language, longer prose is still English.
- New response fields, documented on the methods: muhurta `factors[].id` (stable English key such as `Tithi` or `RahuKaal`; `name` and `value` follow `lang`, so match on `id`) and `panchang.panchaka` `avoidance_text` (reader text in `lang`; `avoidance` stays the id list).
- README: new "Languages" section; PDF reports are listed for all eight complete languages.

## 0.6.0 — 2026-11-08

- PDF reports now render fully in Malayalam (`ml`): all templates have native labels, chart sign and planet names, dasha and Yogini lord names, weekday names and the `Noto Sans Malayalam` font. `Locale` now includes `"ml"`.
- Tamil weekday names are the full day forms (`ஞாயிற்றுக்கிழமை` … `சனிக்கிழமை`), so a weekday never reads as a planet name.
- Mangal dosha, Sade Sati, Varshaphal and Match-making PDFs no longer tell the reader to consult an astrologer or priest; remedies are written as steps the reader can do at home, with traditional rituals such as Kumbh Vivah only named.

## 0.5.0 — 2026-11-02

- New `narrative.prashna({ lat, lon, tz, date, time, topic?, questionHouse?, lang? })`: Prashna (horary) narrative for the moment and place of the question (20 credits). `topic` is `career`, `financial`, `health`, `litigation`, `marriage`, `missing_person`, `property` or `travel`; `questionHouse` (1–12) picks the topic when `topic` is not given. Returns the Prashna lagna and Moon sections plus the topic reading for the Prashna lagna.
- `narrative.transitPhal()` and `narrative.dashaPhal()` now take `{ birth, date, time, tz }` (the same shape as `transit.tarabala`). Before, the birth date was also sent as the transit/dasha date, so both read the sky at birth. Both send the birth place as `lat`/`lon`, so `transitPhal` now includes the readings from the natal lagna as well as from the natal Moon, Sade Sati, the Sun's transit house and transits over natal grahas. `dashaPhal` responses now include sookshma, prana and dasha-sandhi sections.
- Same fix, same `{ birth, date, time, tz }` input, for `narrative.transitDouble()`, `narrative.sadeSatiStatus()`, `narrative.sadeSatiPhase()`, `narrative.sadeSatiHistory()`, `ashtakavarga.kaksha()`, `ashtakavarga.transitScore()` and `transit.smallPanoti()`. They used to send the birth date as the transit date, so they answered for the day of birth (Sade Sati history stopped at birth). This changes their input type; pass the natal chart as `birth` and the day to check as `date`.
- New data methods (ids and numbers only, no prose; `sign_index` 0-based, `house` 1-based whole-sign, instants as `*_local` + `*_jd`, `skipped` lists what could not be computed):
  - `chart.kundliFacts({ ...birth, vargas?, include?, gender? })` — the whole chart in one call: lagna, planets (dignity, combustion, neecha bhanga, vargottama, houses ruled, shadbala, avastha, varga placements), houses (lord, SAV, bhava bala, occupants, aspects), chara karakas, avakhada; `include: "yogas"` or `"all"` adds yogas and doshas (50 credits).
  - `chart.yogas()` / `chart.doshas()` — yoga and dosha items as data with planets, houses, strength, cancellation and source; `all: true` also lists absent ids (20 credits each).
  - `chart.sensitivity({ ...birth, window?, vargas?, topocentricMoon? })` — how many minutes the lagna (D1 and vargas), Moon nakshatra and pada hold around the birth time (20 credits).
  - `transit.sadeSatiWindows({ birth, from?, years?, includePast?, tz? })` — dated Sade Sati / Dhaiya intervals and merged cycles from the natal Moon (20 credits).
  - `transit.windows({ planet, from?, years?, tz?, birth? })` — every sign stay of one planet with exact ingresses; with `birth`, the house from the natal Moon and lagna (20 credits).
  - `remedies.forGraha({ graha?, reason?, include?, category?, lang? })` — catalogue remedies for a graha by reason (`debilitated`, `combust`, `dusthana`, `weak_shadbala`, `dasha`, `dosha:<id>`) with kind, weekday and `matched_by` (10 credits).
  - `milan.overlay({ boy, girl })` — each partner's grahas in the other's houses, same-sign / same-nakshatra pairs, Moon sign relation, lagna lords across charts (20 credits).
  - `milan.summary({ boy, girl, from?, tz?, include? })` — Ashtakoota, navamsa compatibility, Mangal dosha of both, 7th-house facts of both and 10 years of Sade Sati windows in one call (60 credits).
- `milan.dashaSync()` takes new optional `timeline`, `years`, `from`, `marriageWindows`, `date`, `time` and `tz`: both partners' MD/AD periods on one aligned timeline, optionally tagged favourable / neutral / avoid for marriage. Every `milan.*` route now reads each partner's Moon with the ayanamsa of that partner's own birth moment, so a partner's numbers can move slightly from 0.4.0 responses.
- New input types `NatalWindowInput`, `OptionalNatalWindowInput` and `NatalWindowBirth`.
- API changes reflected in the method docs: `narrative.milan()` adds synastry sections; Ashtakoota Tara and Graha Maitri are scored both ways (Tara 1.5 or 3; Graha Maitri 5/4/3/1/0.5/0); `varshaphal.lord()` returns the Varshesha by the Panchadhikari rule with new `hora_lord`, `method`, `reason`, `is_day_return` and `candidates` fields; the Muntha house is counted from the Varsha lagna.

## 0.4.0 — 2026-11-02

- PDF reports now render fully in Telugu (`te`), Tamil (`ta`) and Kannada (`kn`): all 10 templates have native labels, chart sign and planet names, dasha and Yogini lord names, and font stacks that cover the three scripts.
- PDFs use the API's new `NameLocal` (yogas, doshas) and `LordLocal` (house and dasha lords) fields when present, so yoga names and lords appear in the report's language for every locale.
- Line height and letter spacing are tuned for Indic scripts so conjuncts are not split.

## 0.3.0 — 2026-10-10

- New `festivals.vrat({ year, type })`: year-wise Vrat & Upavas lists (ekadashi, pradosh, sankashti, purnima, amavasya, shraddha, janmashtami, …). Occurrences now carry `vrat_type`.

- New `calendar.solstices({ year, tz?, lat?, lon? })`: equinoxes and solstices with Uttarayana/Dakshinayana and day length.
- `eclipses.solar/lunar/all()`: new optional `lat`, `lon`, `alt`, `tz` return a `local` block per eclipse — contact times, visibility and sutak kaal.

- `festivals.month()` / `festivals.onDate()`: new optional `lat`, `lon`, `tz`, `locale`,
  `monthSystem`, `ayanamsa`. Responses now carry `name_en`, `name_hi`, `paksha`, `tithi_index`,
  `hindu_month` (+ amanta/purnimanta), `observance`, `windows` (tithi span, pradosh kaal,
  moonrise, Ekadashi parana) and `note`. Dates are location-aware and are verified against printed panchang calendars of 14 cities. The `region` parameter (never supported by the API) is removed.
- `panchang.monthly()`: `tz` is now a string accepting IANA names, fixed offsets or decimal
  hours; new `alt`, `include: "sheet"` (complete printable calendar page), `locale`,
  `monthSystem`, `ayanamsa`.

## 0.2.0

- Initial public manifest-generated client (310 endpoints) with PDF report rendering.
