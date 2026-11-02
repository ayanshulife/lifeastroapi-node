# Changelog

## 0.5.0 — 2026-11-02

- New `narrative.prashna({ lat, lon, tz, date, time, topic?, questionHouse?, lang? })`: Prashna (horary) narrative for the moment and place of the question (20 credits). `topic` is `career`, `financial`, `health`, `litigation`, `marriage`, `missing_person`, `property` or `travel`; `questionHouse` (1–12) picks the topic when `topic` is not given. Returns the Prashna lagna and Moon sections plus the topic reading for the Prashna lagna.
- `narrative.transitPhal()` and `narrative.dashaPhal()` now take `{ birth, date, time, tz }` (the same shape as `transit.tarabala`). Before, the birth date was also sent as the transit/dasha date, so both read the sky at birth. Both send the birth place as `lat`/`lon`, so `transitPhal` now includes the readings from the natal lagna as well as from the natal Moon, Sade Sati, the Sun's transit house and transits over natal grahas. `dashaPhal` responses now include sookshma, prana and dasha-sandhi sections.
- Same fix, same `{ birth, date, time, tz }` input, for `narrative.transitDouble()`, `narrative.sadeSatiStatus()`, `narrative.sadeSatiPhase()`, `narrative.sadeSatiHistory()`, `ashtakavarga.kaksha()`, `ashtakavarga.transitScore()` and `transit.smallPanoti()`. They used to send the birth date as the transit date, so they answered for the day of birth (Sade Sati history stopped at birth). This changes their input type; pass the natal chart as `birth` and the day to check as `date`.
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
