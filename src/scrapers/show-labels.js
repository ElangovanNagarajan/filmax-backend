// Normalizers for the three show labels the app displays.
//
// The rule (from how the app reads them):
//   language — the audio language the film runs in: "English", "Tamil", ...
//   format   — the screen format only: "2D", "3D", "IMAX 3D", "4DX", ...
//   subtitle — the subtitle language code if the site advertises one: "ENG"
//
// These three MUST stay independent. Earlier the scrapers glued the subtitle
// (and sometimes the language) into `format`, and also emitted it separately,
// so the app rendered "English · 2D ENG · ENG". Every label now goes through
// here so the same value can never appear in two fields.

const LANGUAGE_NAMES = {
  eng: 'English', english: 'English',
  tam: 'Tamil', tamil: 'Tamil',
  tel: 'Telugu', telugu: 'Telugu',
  hin: 'Hindi', hindi: 'Hindi',
  mal: 'Malayalam', malayalam: 'Malayalam',
  kan: 'Kannada', kannada: 'Kannada',
  ben: 'Bengali', bengali: 'Bengali',
  mar: 'Marathi', marathi: 'Marathi',
  guj: 'Gujarati', gujarati: 'Gujarati',
  pun: 'Punjabi', punjabi: 'Punjabi',
  ori: 'Odia', odia: 'Odia',
  urd: 'Urdu', urdu: 'Urdu',
  jap: 'Japanese', japanese: 'Japanese',
  kor: 'Korean', korean: 'Korean',
  fre: 'French', french: 'French',
  spa: 'Spanish', spanish: 'Spanish',
  ger: 'German', german: 'German',
};

// Screen formats, longest first so "IMAX 3D" wins over a bare "3D".
const FORMAT_PATTERNS = [
  /IMAX\s*3\s*D/i, /IMAX\s*2\s*D/i, /IMAX/i,
  /SCREEN\s*X/i, /4\s*DX/i, /MX\s*4\s*D/i, /D\s*BOX/i, /ICE/i, /DOLBY\s*CINEMA/i, /ATMOS/i,
  /\b3\s*D\b/i, /\b2\s*D\b/i,
];

/** "ENG", "english", "Tamil" -> "English" / "Tamil". Unknown values pass through title-cased. */
export function normalizeLanguage(raw) {
  const t = String(raw || '').trim();
  if (!t) return '';
  const key = t.toLowerCase().replace(/[^a-z]/g, '');
  if (LANGUAGE_NAMES[key]) return LANGUAGE_NAMES[key];
  // Multi-language strings like "Tamil, Telugu" — keep the first.
  const first = t.split(/[,/|]+/)[0].trim();
  const fk = first.toLowerCase().replace(/[^a-z]/g, '');
  if (LANGUAGE_NAMES[fk]) return LANGUAGE_NAMES[fk];
  return first.charAt(0).toUpperCase() + first.slice(1).toLowerCase();
}

/** Pull just the screen format out of a string that may also hold other junk. */
export function normalizeFormat(raw) {
  const t = String(raw || '').trim();
  if (!t) return '';
  for (const re of FORMAT_PATTERNS) {
    const m = t.match(re);
    if (m) return m[0].toUpperCase().replace(/\s+/g, ' ').replace(/(\d)\s+D/, '$1D');
  }
  return '';
}

/** Anything in `raw` that looks like a bare subtitle code, e.g. "2D ENG" -> "ENG". */
export function extractSubtitleFrom(raw) {
  const t = String(raw || '').trim();
  if (!t) return '';
  // Strip the format first so "2D" can't be mistaken for a code.
  const fmt = normalizeFormat(t);
  const rest = fmt ? t.replace(new RegExp(fmt.replace(/\s/g, '\\s*'), 'i'), ' ') : t;
  const m = rest.match(/\b([A-Za-z]{3})\b/);
  if (!m) return '';
  return LANGUAGE_NAMES[m[1].toLowerCase()] ? m[1].toUpperCase() : '';
}

/**
 * Subtitle code for display. Returns '' when the site said nothing, or when the
 * subtitle just restates the audio language (an English film subtitled ENG adds
 * nothing) — the user asked for that slot to be blank in those cases.
 */
export function normalizeSubtitle(raw, language) {
  const t = String(raw || '').trim();
  if (!t) return '';
  const code = t.toLowerCase().replace(/[^a-z]/g, '');
  const full = LANGUAGE_NAMES[code];
  if (!full) return '';
  if (language && full === normalizeLanguage(language)) return '';
  return code.slice(0, 3).toUpperCase();
}
