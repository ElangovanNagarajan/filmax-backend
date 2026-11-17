// How a typed theater name is matched against a site's cinema name. Shared by
// both scrapers so "Rohini", "rohini silver", "Rohini Silver Screens" and the
// typo "rohini sliver" all land on the same cinema on BookMyShow and district.

// Words that carry no identity — every other cinema has them.
const FILLER = new Set(['the', 'cinema', 'cinemas', 'theatre', 'theatres', 'theater', 'theaters', 'screen', 'screens', 'multiplex', 'mall', 'chennai', 'coimbatore']);

function words(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().split(' ').filter(Boolean);
}

// One-edit tolerance (insert, delete, substitute, or swap two neighbours), so
// "sliver" still finds "silver" and "pheonix" finds "phoenix".
function withinOneEdit(a, b) {
  if (a === b) return true;
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  if (a.length === b.length) {
    if (a.slice(i + 1) === b.slice(i + 1)) return true;
    return a[i] === b[i + 1] && a[i + 1] === b[i] && a.slice(i + 2) === b.slice(i + 2);
  }
  const [long, short] = a.length > b.length ? [a, b] : [b, a];
  return long.slice(i + 1) === short.slice(i);
}

function wordMatches(typed, siteWords) {
  return siteWords.some((w) =>
    w === typed
    || (typed.length >= 3 && w.startsWith(typed))                 // "sathy" -> "sathyam"
    || (typed.length >= 5 && w.length >= 5 && withinOneEdit(typed, w)) // typos
    || (typed.length >= 5 && w.length >= 5 && withinOneEdit(typed.replace(/s$/, ''), w.replace(/s$/, ''))));
}

// Every meaningful word the user typed must appear in the cinema's name.
// Filler words ("screens", "cinemas") are optional — but if the user typed
// only filler, fall back to requiring all of it.
export function theaterMatches(siteName, typed) {
  const site = words(siteName);
  let want = words(typed).filter((w) => !FILLER.has(w));
  if (!want.length) want = words(typed);
  if (!want.length) return false;
  return want.every((w) => wordMatches(w, site));
}

// Movie titles compare on letters and digits only, so "Spider-Man" ==
// "Spiderman". The user's text must be contained in the site title (typing
// "Godzilla" finds "Godzilla Minus Zero"); the reverse is allowed only for
// substantial titles, so a stray "A" on the page can't match everything.
export function slugKey(s) {
  return String(s || '').toLowerCase().replace(/^(the|a|an)\s+/, '').replace(/[^a-z0-9]/g, '');
}
export function titleMatches(siteTitle, typed) {
  const want = slugKey(typed);
  const k = slugKey(siteTitle);
  if (!want || !k) return false;
  if (k.includes(want)) return true;
  if (k.length >= 4 && want.includes(k)) return true;
  // Last resort, word by word with the same one-typo tolerance as theaters:
  // "gozilla" finds "Godzilla", while "Godzilla Minus One" still does NOT
  // match "Godzilla Minus Zero" (short words must match exactly).
  const site = words(siteTitle);
  const typedWords = words(typed).filter((w) => !['the', 'a', 'an'].includes(w));
  return typedWords.length > 0 && typedWords.every((w) => wordMatches(w, site));
}
