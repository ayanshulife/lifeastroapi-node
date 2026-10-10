# Changelog

## 0.3.0 — 2026-10-10

- New `festivals.vrat({ year, type })`: year-wise Vrat & Upavas lists (ekadashi, pradosh, sankashti, purnima, amavasya, shraddha, janmashtami, …). Occurrences now carry `vrat_type`.

- New `calendar.solstices({ year, tz?, lat?, lon? })`: equinoxes and solstices with Uttarayana/Dakshinayana and day length.
- `eclipses.solar/lunar/all()`: new optional `lat`, `lon`, `alt`, `tz` return a `local` block per eclipse — contact times, visibility and sutak kaal.

- `festivals.month()` / `festivals.onDate()`: new optional `lat`, `lon`, `tz`, `locale`,
  `monthSystem`, `ayanamsa`. Responses now carry `name_en`, `name_hi`, `paksha`, `tithi_index`,
  `hindu_month` (+ amanta/purnimanta), `observance`, `windows` (tithi span, pradosh kaal,
  moonrise, Ekadashi parana) and `note`. Dates are location-aware and match the Drik Panchang
  2027 calendars of 14 cities. The `region` parameter (never supported by the API) is removed.
- `panchang.monthly()`: `tz` is now a string accepting IANA names, fixed offsets or decimal
  hours; new `alt`, `include: "sheet"` (complete printable calendar page), `locale`,
  `monthSystem`, `ayanamsa`.

## 0.2.0

- Initial public manifest-generated client (310 endpoints) with PDF report rendering.
