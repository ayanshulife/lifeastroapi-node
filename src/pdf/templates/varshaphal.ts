/**
 * Varshaphal (annual / solar-return) report → HTML.
 *
 * Ported from the server-side Go template `internal/pdf/varshaphal.go` so the
 * SDK-rendered PDF is visually faithful to the API's own report. Consumes the
 * JSON returned by `client.reports.varshaphal(...)` verbatim (PascalCase
 * top-level keys; snake_case inside placement/muntha/varsha-lord — see
 * interfaces below) and returns a self-contained HTML document ready for
 * `htmlToPdf`.
 *
 * The Go template's i18n helpers (signLabel/nakLabel/planetLabel/
 * munthaSignLabel/varshaLordLabel) just echo the already-locale-resolved field
 * straight back, so here we read the field directly — no client-side
 * translation is performed.
 *
 * The one exception is the Year Outlook prose: the Go template derives it
 * client-side (`varshaOutlook`) from the muntha house + target year rather than
 * from a JSON field, so the same band-based logic is ported below.
 */

import {
  esc,
  resolveBranding,
  coverBrandingHtml,
  makeLabeler,
  layoutDocument,
  type Branding,
} from "../shared.js";

/** A sign + degree pair (snake_case keys, as in the API JSON). */
export interface VarshaphalPlacement {
  sign?: string;
  dms_within?: string;
  nakshatra?: string;
  pada?: number;
  nak_lord?: string;
}

/** One planet row in the solar-return positions table. */
export interface VarshaphalPlanet {
  name?: string;
  placement?: VarshaphalPlacement;
  house_num?: number;
  retro?: boolean;
}

/** The birth subject metadata printed on the cover (PascalCase, no json tags). */
export interface VarshaphalSubject {
  Name?: string;
  BirthDate?: string;
  BirthTime?: string;
  BirthPlace?: string;
}

/** Muntha — the progressed ascendant for the year (json-tagged → snake/lower). */
export interface VarshaphalMuntha {
  sign?: string;
  house?: number;
}

/** Varsha lord — the planet ruling the year's first hora (json-tagged). */
export interface VarshaphalLord {
  name?: string;
  hora?: number;
}

/** Branding embedded in the report JSON (PascalCase). */
export interface VarshaphalBranding {
  CompanyName?: string;
  LogoURL?: string;
  PrimaryColor?: string;
  SecondaryColor?: string;
  FooterText?: string;
  WatermarkText?: string;
}

/** Full Varshaphal payload (exactly as returned by the API). */
export interface VarshaphalData {
  Locale?: string;
  Branding?: VarshaphalBranding;
  Subject?: VarshaphalSubject;
  TargetYear?: number;
  /** Solar-return moment, ISO-8601, handler-formatted (e.g. "2026-06-14T21:53:59Z"). */
  SolarReturnISO?: string;
  Ascendant?: VarshaphalPlacement;
  Planets?: VarshaphalPlanet[];
  Muntha?: VarshaphalMuntha;
  VarshaLord?: VarshaphalLord;
  GeneratedAt?: string;
}

/**
 * i18n strings ported verbatim from the Go `varshaphalLabels` map. A missing
 * key (partially translated locale) degrades to "" via `makeLabeler`, matching
 * the Go template's graceful-degradation behavior.
 */
export const LABELS: Record<string, Record<string, string>> = {
  en: {
    title_varsha: "Varshaphal — Annual Forecast",
    born: "Born",
    at: "at",
    generated: "Generated on",
    section_solar_return: "Solar Return Moment",
    section_planets_sr: "Planetary Positions at Solar Return",
    section_outlook: "Year Outlook",
    solar_return_at: "Solar Return at",
    ascendant: "Ascendant",
    nakshatra: "Nakshatra",
    pada: "Pada",
    muntha: "Muntha",
    varsha_lord: "Varsha Lord",
    house: "House",
    from_natal_lagna: "from natal lagna",
    hora_number: "Hora",
    planet: "Planet",
    sign: "Sign",
    degree: "Degree",
  },
  hi: {
    title_varsha: "वर्षफल — वार्षिक भविष्यफल",
    born: "जन्म",
    at: "समय",
    generated: "तैयार",
    section_solar_return: "सूर्य प्रत्यागमन क्षण",
    section_planets_sr: "सूर्य प्रत्यागमन के समय ग्रह स्थिति",
    section_outlook: "वार्षिक दृष्टिकोण",
    solar_return_at: "सूर्य प्रत्यागमन समय",
    ascendant: "लग्न",
    nakshatra: "नक्षत्र",
    pada: "पाद",
    muntha: "मुन्था",
    varsha_lord: "वर्ष स्वामी",
    house: "भाव",
    from_natal_lagna: "जन्म लग्न से",
    hora_number: "होरा",
    planet: "ग्रह",
    sign: "राशि",
    degree: "अंश",
  },
  mr: {
    title_varsha: "वर्षफल — वार्षिक भविष्यफल",
    born: "जन्म",
    at: "वेळ",
    generated: "तयार",
    section_solar_return: "सूर्य प्रत्यागमन क्षण",
    section_planets_sr: "सूर्य प्रत्यागमन वेळेस ग्रह स्थिती",
    section_outlook: "वार्षिक दृष्टीकोन",
    solar_return_at: "सूर्य प्रत्यागमन वेळ",
    ascendant: "लग्न",
    nakshatra: "नक्षत्र",
    pada: "चरण",
    muntha: "मुन्था",
    varsha_lord: "वर्ष अधिपती",
    house: "स्थान",
    from_natal_lagna: "जन्म लग्नापासून",
    hora_number: "होरा",
    planet: "ग्रह",
    sign: "राशी",
    degree: "अंश",
  },
  te: {
    title_varsha: "వర్షఫలం: వార్షిక ఫలితాలు",
    born: "జననం",
    at: "సమయం",
    generated: "రూపొందించిన తేదీ",
    section_solar_return: "సౌర పునరాగమన క్షణం",
    section_planets_sr: "సౌర పునరాగమన సమయంలో గ్రహ స్థితి",
    section_outlook: "సంవత్సర దృక్పథం",
    solar_return_at: "సౌర పునరాగమన సమయం",
    ascendant: "లగ్నం",
    nakshatra: "నక్షత్రం",
    pada: "పాదం",
    muntha: "ముంథా",
    varsha_lord: "వర్షాధిపతి",
    house: "భావం",
    from_natal_lagna: "జన్మ లగ్నం నుండి",
    hora_number: "హోర",
    planet: "గ్రహం",
    sign: "రాశి",
    degree: "భాగలు",
  },
  ta: {
    title_varsha: "வருஷ பலன்: ஆண்டுப் பலன்கள்",
    born: "பிறப்பு",
    at: "நேரம்",
    generated: "தயாரித்த நாள்",
    section_solar_return: "சூரிய மீள்வருகைத் தருணம்",
    section_planets_sr: "சூரிய மீள்வருகையின்போது கிரக நிலை",
    section_outlook: "ஆண்டுப் பார்வை",
    solar_return_at: "சூரிய மீள்வருகை நேரம்",
    ascendant: "லக்னம்",
    nakshatra: "நட்சத்திரம்",
    pada: "பாதம்",
    muntha: "முந்தா",
    varsha_lord: "வருஷ அதிபதி",
    house: "வீடு",
    from_natal_lagna: "ஜனன லக்னத்திலிருந்து",
    hora_number: "ஹோரை",
    planet: "கிரகம்",
    sign: "ராசி",
    degree: "பாகை",
  },
  kn: {
    title_varsha: "ವರ್ಷಫಲ: ವಾರ್ಷಿಕ ಫಲ",
    born: "ಜನನ",
    at: "ಸಮಯ",
    generated: "ತಯಾರಿಸಿದ ದಿನಾಂಕ",
    section_solar_return: "ಸೌರ ಪುನರಾಗಮನ ಕ್ಷಣ",
    section_planets_sr: "ಸೌರ ಪುನರಾಗಮನದ ಸಮಯದ ಗ್ರಹ ಸ್ಥಿತಿ",
    section_outlook: "ವರ್ಷದ ದೃಷ್ಟಿಕೋನ",
    solar_return_at: "ಸೌರ ಪುನರಾಗಮನ ಸಮಯ",
    ascendant: "ಲಗ್ನ",
    nakshatra: "ನಕ್ಷತ್ರ",
    pada: "ಪಾದ",
    muntha: "ಮುಂಥಾ",
    varsha_lord: "ವರ್ಷಾಧಿಪತಿ",
    house: "ಭಾವ",
    from_natal_lagna: "ಜನ್ಮ ಲಗ್ನದಿಂದ",
    hora_number: "ಹೋರಾ",
    planet: "ಗ್ರಹ",
    sign: "ರಾಶಿ",
    degree: "ಅಂಶ",
  },
};

/** Report-specific CSS: the prominent year badge on the cover, plus the
 *  indicator-card grid for the muntha + varsha-lord cards. (h2/h3/table/.cover/
 *  .cards/.card/footer/watermark all come from BASE_CSS in shared.ts.) */
const EXTRA_CSS = `
.cover .year-badge {
  display: inline-block;
  padding: 3mm 8mm;
  margin: 4mm 0 8mm;
  background: var(--brand-primary);
  color: #fff;
  font-size: 22pt;
  font-weight: 700;
  border-radius: 2mm;
}
.indicator-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 5mm; margin: 4mm 0; }
.indicator-card { padding: 5mm; background: #fafafa; border-left: 3px solid var(--brand-primary); }
.indicator-card .label {
  font-size: 9pt; color: var(--brand-secondary);
  text-transform: uppercase; letter-spacing: 0.5pt; margin-bottom: 1mm;
}
.indicator-card .value { font-size: 14pt; font-weight: 600; color: var(--brand-primary); }
.indicator-card .detail { margin-top: 2mm; font-size: 10pt; color: #444; }
`;

/**
 * Format an ISO-8601 timestamp into the `YYYY-MM-DD HH:MM UTC` shape the Go
 * template produces via `GeneratedAt.Format("2006-01-02 15:04 MST")`. Falls
 * back to the raw string if it isn't parseable.
 */
function formatGenerated(iso?: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} ${p(
    d.getUTCHours(),
  )}:${p(d.getUTCMinutes())} UTC`;
}

/**
 * Classify the muntha house into a quality band, mirroring Go's `munthaBand`.
 * Houses 1/5/9 are kendra/trikona (favorable); 6/8/12 are dusthana
 * (challenging); the rest are mixed. Standard Varshaphal interpretation.
 */
function munthaBand(house: number): "favorable" | "challenging" | "mixed" {
  switch (house) {
    case 1:
    case 5:
    case 9:
      return "favorable";
    case 6:
    case 8:
    case 12:
      return "challenging";
    default:
      return "mixed";
  }
}

/**
 * The Year Outlook prose, ported verbatim from Go's `outlookText`: three
 * locales × three bands = nine strings, with the muntha house and target year
 * interpolated. The Go template computes this client-side (not from a JSON
 * field), so we reproduce the same band-based logic here.
 */
function outlookText(
  locale: string,
  year: number,
  band: "favorable" | "challenging" | "mixed",
  house: number,
): string {
  if (locale === "hi") {
    if (band === "favorable") {
      return `मुन्था का ${house} वें भाव में होना ${year} वर्ष को सामान्यतः अनुकूल बनाता है — लक्ष्य प्राप्ति, स्थायित्व, या आध्यात्मिक प्रगति की संभावनाएं बढ़ती हैं।`;
    }
    if (band === "challenging") {
      return `मुन्था का ${house} वें भाव में होना ${year} वर्ष को चुनौतीपूर्ण बना सकता है। स्वास्थ्य, खर्च, या ऋण-सम्बन्धी मामलों में सावधानी रखिए।`;
    }
    return `मुन्था ${house} वें भाव में स्थित है — ${year} वर्ष में मिश्रित परिणाम संभव। प्रमुख निर्णयों के लिए ज्योतिषी से परामर्श लीजिए।`;
  }
  if (locale === "mr") {
    if (band === "favorable") {
      return `मुन्था ${house} व्या स्थानात असल्याने ${year} वर्ष सामान्यतः अनुकूल राहील — उद्दिष्टपूर्ती, स्थैर्य किंवा आध्यात्मिक प्रगतीच्या शक्यता वाढतात.`;
    }
    if (band === "challenging") {
      return `मुन्था ${house} व्या स्थानात असल्याने ${year} वर्ष आव्हानात्मक राहू शकते. आरोग्य, खर्च किंवा कर्ज-संबंधी बाबींमध्ये सावधगिरी बाळगा.`;
    }
    return `मुन्था ${house} व्या स्थानात आहे — ${year} वर्षात मिश्र परिणाम संभाव्य. महत्त्वाच्या निर्णयांसाठी ज्योतिषाचा सल्ला घ्या.`;
  }
  // te / ta / kn are written from the Hindi; the "consult an astrologer" line
  // of the mixed band becomes "study your chart first" (te/ta style guides
  // ban the referral phrase).
  if (locale === "te") {
    if (band === "favorable") {
      return `ముంథా ${house}వ భావంలో ఉండటం వల్ల ${year} సంవత్సరం సాధారణంగా అనుకూలంగా ఉంటుంది; లక్ష్య సాధన, స్థిరత్వం లేదా ఆధ్యాత్మిక పురోగతికి అవకాశాలు పెరుగుతాయి.`;
    }
    if (band === "challenging") {
      return `ముంథా ${house}వ భావంలో ఉండటం వల్ల ${year} సంవత్సరం సవాలుగా ఉండవచ్చు. ఆరోగ్యం, ఖర్చులు లేదా అప్పులకు సంబంధించిన విషయాలలో జాగ్రత్తగా ఉండండి.`;
    }
    return `ముంథా ${house}వ భావంలో ఉంది; ${year} సంవత్సరంలో మిశ్రమ ఫలితాలు రావచ్చు. ముఖ్యమైన నిర్ణయాలకు ముందు మీ జాతకాన్ని లోతుగా పరిశీలించుకోండి.`;
  }
  if (locale === "ta") {
    if (band === "favorable") {
      return `முந்தா ${house}-ஆம் வீட்டில் இருப்பதால் ${year} ஆம் ஆண்டு பொதுவாகச் சாதகமாக இருக்கும்; இலக்கை அடைதல், நிலைத்தன்மை அல்லது ஆன்மிக முன்னேற்றத்துக்கான வாய்ப்புகள் கூடும்.`;
    }
    if (band === "challenging") {
      return `முந்தா ${house}-ஆம் வீட்டில் இருப்பதால் ${year} ஆம் ஆண்டு சவாலாக இருக்கலாம். உடல்நலம், செலவு, கடன் தொடர்பான விஷயங்களில் கவனமாக இருங்கள்.`;
    }
    return `முந்தா ${house}-ஆம் வீட்டில் உள்ளது; ${year} ஆம் ஆண்டில் கலவையான பலன்கள் வரலாம். முக்கிய முடிவுகளுக்கு முன் உங்கள் ஜாதகத்தை ஆழமாகப் பார்த்துக்கொள்ளுங்கள்.`;
  }
  if (locale === "kn") {
    if (band === "favorable") {
      return `ಮುಂಥಾ ${house}ನೇ ಭಾವದಲ್ಲಿರುವುದರಿಂದ ${year} ವರ್ಷ ಸಾಮಾನ್ಯವಾಗಿ ಅನುಕೂಲಕರವಾಗಿರುತ್ತದೆ; ಗುರಿ ಸಾಧನೆ, ಸ್ಥಿರತೆ ಅಥವಾ ಆಧ್ಯಾತ್ಮಿಕ ಪ್ರಗತಿಯ ಸಾಧ್ಯತೆಗಳು ಹೆಚ್ಚುತ್ತವೆ.`;
    }
    if (band === "challenging") {
      return `ಮುಂಥಾ ${house}ನೇ ಭಾವದಲ್ಲಿರುವುದರಿಂದ ${year} ವರ್ಷ ಸವಾಲಿನದಾಗಿರಬಹುದು. ಆರೋಗ್ಯ, ಖರ್ಚು ಅಥವಾ ಸಾಲಕ್ಕೆ ಸಂಬಂಧಿಸಿದ ವಿಷಯಗಳಲ್ಲಿ ಎಚ್ಚರಿಕೆಯಿಂದಿರಿ.`;
    }
    return `ಮುಂಥಾ ${house}ನೇ ಭಾವದಲ್ಲಿದೆ; ${year} ವರ್ಷದಲ್ಲಿ ಮಿಶ್ರ ಫಲಿತಾಂಶಗಳು ಸಾಧ್ಯ. ಮುಖ್ಯ ನಿರ್ಧಾರಗಳ ಮೊದಲು ನಿಮ್ಮ ಜಾತಕವನ್ನು ಆಳವಾಗಿ ಪರಿಶೀಲಿಸಿಕೊಳ್ಳಿ.`;
  }
  if (band === "favorable") {
    return `Muntha in house ${house} makes ${year} broadly favorable — increased likelihood of goal attainment, stability, or spiritual progress.`;
  }
  if (band === "challenging") {
    return `Muntha in house ${house} may make ${year} challenging. Exercise care around health, expenditure, or debt-related matters.`;
  }
  return `Muntha sits in house ${house} — ${year} likely brings mixed results. Consult an astrologer before major decisions.`;
}

/**
 * Render the Varshaphal (annual / solar-return) report as a complete HTML
 * document.
 *
 * @param data     report JSON from `client.reports.varshaphal(...)`
 * @param branding optional caller branding overrides (win per-field over the
 *                 branding embedded in `data`)
 */
export function renderVarshaphalHtml(
  data: VarshaphalData,
  branding?: Branding,
): string {
  const resolved = resolveBranding(data.Branding, branding);
  const t = makeLabeler(LABELS, data.Locale);
  // Narrow the locale to one the outlook prose is authored for (en/hi/mr/te/ta/kn),
  // matching Go's pickVarshaphalLocale fallback to "en".
  const loc = data.Locale && LABELS[data.Locale] ? data.Locale : "en";

  const subject = data.Subject ?? {};
  const asc = data.Ascendant ?? {};
  const muntha = data.Muntha ?? {};
  const lord = data.VarshaLord ?? {};
  const planets = Array.isArray(data.Planets) ? data.Planets : [];
  const year = typeof data.TargetYear === "number" ? data.TargetYear : 0;

  // Cover page — title + prominent year badge + subject.
  const coverMeta = `${esc(t("born"))} ${esc(subject.BirthDate)} ${esc(t("at"))} ${esc(
    subject.BirthTime,
  )}<br>${esc(subject.BirthPlace)}`;
  const cover = `<section class="cover">
  ${coverBrandingHtml(resolved)}
  <h1>${esc(t("title_varsha"))}</h1>
  <div class="year-badge">${esc(data.TargetYear)}</div>
  <div class="subject">${esc(subject.Name)}</div>
  <div class="meta">${coverMeta}</div>
  <div class="generated">${esc(t("generated"))} ${esc(formatGenerated(data.GeneratedAt))}</div>
</section>`;

  // Solar-return moment + ascendant summary.
  const solarReturn = `<h2>${esc(t("section_solar_return"))}</h2>
<p>
  <strong>${esc(t("solar_return_at"))}:</strong> ${esc(data.SolarReturnISO)}<br>
  <strong>${esc(t("ascendant"))}:</strong>
  ${esc(asc.sign)} (${esc(asc.dms_within)}) —
  ${esc(t("nakshatra"))}: ${esc(asc.nakshatra)},
  ${esc(t("pada"))} ${esc(asc.pada)}
</p>`;

  // Year indicator cards — muntha placement + varsha lord.
  const indicators = `<div class="indicator-grid">
  <div class="indicator-card">
    <div class="label">${esc(t("muntha"))}</div>
    <div class="value">${esc(muntha.sign)}</div>
    <div class="detail">${esc(t("house"))} ${esc(muntha.house)} ${esc(t("from_natal_lagna"))}</div>
  </div>
  <div class="indicator-card">
    <div class="label">${esc(t("varsha_lord"))}</div>
    <div class="value">${esc(lord.name)}</div>
    <div class="detail">${esc(t("hora_number"))} ${esc(lord.hora)}</div>
  </div>
</div>`;

  // Planetary positions at solar return.
  const planetRows = planets
    .map((pl) => {
      const p = pl.placement ?? {};
      const retro = pl.retro ? " (R)" : "";
      return `<tr><td>${esc(pl.name)}${retro}</td><td>${esc(p.sign)}</td><td>${esc(
        p.dms_within,
      )}</td><td>${esc(pl.house_num)}</td><td>${esc(p.nakshatra)} (${esc(
        p.pada,
      )})</td></tr>`;
    })
    .join("");
  const planetsTable = `<h2>${esc(t("section_planets_sr"))}</h2>
<table>
  <thead>
    <tr>
      <th>${esc(t("planet"))}</th>
      <th>${esc(t("sign"))}</th>
      <th>${esc(t("degree"))}</th>
      <th>${esc(t("house"))}</th>
      <th>${esc(t("nakshatra"))}</th>
    </tr>
  </thead>
  <tbody>${planetRows}</tbody>
</table>`;

  // Year outlook prose — derived client-side from the muntha house (as in Go).
  const munthaHouse = typeof muntha.house === "number" ? muntha.house : 0;
  const outlook = `<h2>${esc(t("section_outlook"))}</h2>
<p>${esc(outlookText(loc, year, munthaBand(munthaHouse), munthaHouse))}</p>`;

  const bodyHtml = [cover, solarReturn, indicators, planetsTable, outlook].join(
    "\n\n",
  );

  return layoutDocument({
    lang: data.Locale,
    title: `${t("title_varsha")} ${data.TargetYear ?? ""} — ${subject.Name ?? ""}`,
    branding: resolved,
    bodyHtml,
    extraCss: EXTRA_CSS,
  });
}
