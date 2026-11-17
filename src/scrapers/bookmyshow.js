import { withPage } from '../browser.js';
import { normalizeLanguage, normalizeFormat, normalizeSubtitle } from './show-labels.js';
import { theaterMatches, titleMatches, slugKey } from './match.js';
import { readShowsFromDom, readShowsFromText } from './bms-dom.js';
import { getEventCode, saveEventCode } from '../event-codes.js';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CACHE_FILE = path.join(__dirname, '..', '..', 'bms_cinema_cache.json');

function citySlug(city) {
  return String(city || 'chennai').toLowerCase().replace(/\s+/g, '-');
}
function cityCode(city) {
  const map = { chennai: 'chen', coimbatore: 'coim', bengaluru: 'bang', bangalore: 'bang', mumbai: 'mumbai', delhi: 'ncr', 'delhi-ncr': 'ncr', hyderabad: 'hyd', pune: 'pune', kolkata: 'kolk' };
  return map[citySlug(city)] || null;
}
function movieSlug(movie) {
  return String(movie).toLowerCase().replace(/^(the|a|an)\s+/i, '').replace(/[^a-z0-9]+/g, '-');
}
function dateToCompact(d) {
  return String(d || '').replace(/-/g, '');
}

const DEFAULT_CACHE = {
  'chennai::phoenix': { city: 'chennai', slug: 'inox-luxe-phoenix-market-city-velachery', cinemaCode: 'INPR', displayName: 'INOX Phoenix Market City' },
  'chennai::phoenix mall': { city: 'chennai', slug: 'inox-luxe-phoenix-market-city-velachery', cinemaCode: 'INPR', displayName: 'INOX Phoenix Market City' },
  'chennai::pheonix': { city: 'chennai', slug: 'inox-luxe-phoenix-market-city-velachery', cinemaCode: 'INPR', displayName: 'INOX Phoenix Market City' },
  'chennai::pheonix mall': { city: 'chennai', slug: 'inox-luxe-phoenix-market-city-velachery', cinemaCode: 'INPR', displayName: 'INOX Phoenix Market City' },
  'chennai::phenoix': { city: 'chennai', slug: 'inox-luxe-phoenix-market-city-velachery', cinemaCode: 'INPR', displayName: 'INOX Phoenix Market City' },
  'chennai::phenoix mall': { city: 'chennai', slug: 'inox-luxe-phoenix-market-city-velachery', cinemaCode: 'INPR', displayName: 'INOX Phoenix Market City' },
  'chennai::inox phoenix': { city: 'chennai', slug: 'inox-luxe-phoenix-market-city-velachery', cinemaCode: 'INPR', displayName: 'INOX Phoenix Market City' },
  'chennai::inox phoenix mall': { city: 'chennai', slug: 'inox-luxe-phoenix-market-city-velachery', cinemaCode: 'INPR', displayName: 'INOX Phoenix Market City' },
  'chennai::phoenix market city': { city: 'chennai', slug: 'inox-luxe-phoenix-market-city-velachery', cinemaCode: 'INPR', displayName: 'INOX Phoenix Market City' },
  'chennai::palazzo': { city: 'chennai', slug: 'pvr-palazzo-the-nexus-vijaya-mall', cinemaCode: 'PVPZ', displayName: 'PVR Palazzo, The Nexus Vijaya Mall' },
  'chennai::pvr palazzo': { city: 'chennai', slug: 'pvr-palazzo-the-nexus-vijaya-mall', cinemaCode: 'PVPZ', displayName: 'PVR Palazzo, The Nexus Vijaya Mall' },
  'chennai::nexus vijaya': { city: 'chennai', slug: 'pvr-palazzo-the-nexus-vijaya-mall', cinemaCode: 'PVPZ', displayName: 'PVR Palazzo, The Nexus Vijaya Mall' },
  'chennai::cinepolis': { city: 'chennai', slug: 'cinepolis-bsr-mall-omr-thoraipakkam', cinemaCode: 'CBMC', displayName: 'Cinepolis BSR Mall' },
  'chennai::cinepolis bsr': { city: 'chennai', slug: 'cinepolis-bsr-mall-omr-thoraipakkam', cinemaCode: 'CBMC', displayName: 'Cinepolis BSR Mall' },
  'chennai::cinepolis bsr mall': { city: 'chennai', slug: 'cinepolis-bsr-mall-omr-thoraipakkam', cinemaCode: 'CBMC', displayName: 'Cinepolis BSR Mall' },
  'chennai::bsr mall': { city: 'chennai', slug: 'cinepolis-bsr-mall-omr-thoraipakkam', cinemaCode: 'CBMC', displayName: 'Cinepolis BSR Mall' },
  'coimbatore::broadway': { city: 'coimbatore', slug: 'broadway-cinemas-coimbatore', cinemaCode: 'BWCB', displayName: 'Broadway Cinemas' },
  'coimbatore::broadway cinemas': { city: 'coimbatore', slug: 'broadway-cinemas-coimbatore', cinemaCode: 'BWCB', displayName: 'Broadway Cinemas' },
};

async function loadCache() {
  try {
    const raw = await fs.readFile(CACHE_FILE, 'utf8');
    return { ...DEFAULT_CACHE, ...JSON.parse(raw || '{}') };
  } catch {
    return { ...DEFAULT_CACHE };
  }
}
async function saveCache(cache) {
  try { await fs.writeFile(CACHE_FILE, JSON.stringify(cache, null, 2)); } catch {}
}

function tierFromRgb([r, g, b]) {
  if (g > 130 && g > r + 40 && g > b + 40) return 'available';
  if (r > 200 && g > 130 && g < 200 && b < 60) return 'filling';
  if (r > 200 && g < 120 && b < 120) return 'critical';
  return 'unknown';
}

// Returns { eventCode, movieUrl } when found, null when BookMyShow's movie
// list loaded and this movie isn't on it, and THROWS when the list itself
// never loaded — an empty or walled page is "couldn't look", not "not listed",
// and must not be allowed to clear a board of real shows.
async function findEventCode(page, movie, city) {
  const q = movie.toLowerCase().replace(/^(the|a|an)\s+/i, '').trim();
  const known = getEventCode(movie, city);
  if (known) return { eventCode: known, movieUrl: `https://in.bookmyshow.com/${citySlug(city)}/movies/${movieSlug(movie)}/${known}` };

  const want = slugKey(q);
  let sawAnyMovie = false;
  // The search page first, then the plain city listing as a second opinion.
  for (const url of [
    `https://in.bookmyshow.com/explore/movies-${citySlug(city)}?q=${encodeURIComponent(q)}`,
    `https://in.bookmyshow.com/explore/movies-${citySlug(city)}`,
  ]) {
    await page.goto('https://in.bookmyshow.com/', { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
    await page.waitForTimeout(1500);
    // networkidle often never settles on this page; the links are in the HTML
    // well before that, so a timeout here is not a failure.
    await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 }).catch(() => {});
    await page.waitForFunction(() => /\/ET\d{8}/.test(document.documentElement.innerHTML), null, { timeout: 10000 }).catch(() => {});
    const html = await page.content();
    // Read every movie link and match its slug with the shared matcher (so
    // "gozilla" still finds godzilla-minus-zero). An exact title wins over a
    // longer one that contains it ("Scene" over "Crime Scene").
    const seen = new Map();
    for (const m of html.matchAll(/\/movies\/(?:[a-z-]+\/)?([a-z0-9-]+)\/(ET\d{8})/gi)) {
      if (!seen.has(m[2])) seen.set(m[2], m[1].toLowerCase());
    }
    if (seen.size) sawAnyMovie = true;
    let best = null;
    for (const [code, slug] of seen) {
      if (!titleMatches(slug.replace(/-/g, ' '), movie)) continue;
      const exact = slugKey(slug) === want;
      if (!best || (exact && !best.exact)) best = { code, slug, exact };
    }
    if (best) {
      saveEventCode(movie, city, best.code).catch(() => {});
      return { eventCode: best.code, movieUrl: `https://in.bookmyshow.com/${citySlug(city)}/movies/${best.slug}/${best.code}` };
    }
  }
  if (!sawAnyMovie) throw new Error('movie list did not load');
  return null;
}

// Find each typed theater's BookMyShow cinema (slug + code) by reading the
// cinema links on the movie's own show page. The old route —
// /buytickets/movie-chen-<ET>-MT/<date> plus clicking a theater name — now
// redirects to a generic /cinemas list, so every theater came back "not
// found". Links are read straight from the page: no clicking, no guessing.
async function resolveCinemaUrls(page, movieEventCode, city, theaters, dates) {
  const cache = await loadCache();
  const result = {};
  const pending = theaters.filter((t) => {
    const hit = cache[`${citySlug(city)}::${t.toLowerCase()}`];
    if (hit) result[t] = hit;
    return !hit;
  });
  if (!pending.length) return result;

  // A theater only appears on the movie page for a date it is screening, so
  // try the watched dates first, then today. The /cinemas list (where the old
  // URL lands) is a last resort that holds every cinema in the city.
  const today = new Date().toISOString().slice(0, 10);
  const pages = [...new Set([...(dates || []), today])].slice(0, 4)
    .map((d) => `https://in.bookmyshow.com/movies/${citySlug(city)}/x/buytickets/${movieEventCode}/${dateToCompact(d)}`);
  pages.push('https://in.bookmyshow.com/cinemas');

  for (const url of pages) {
    if (!pending.some((t) => !result[t])) break;
    try {
      await page.goto(url, { waitUntil: 'networkidle', timeout: 45000 }).catch(() => {});
      await page.waitForTimeout(3000);
      const links = await page.evaluate(() => [...document.querySelectorAll('a[href*="/cinemas/"]')]
        .map((a) => ({ href: a.href, text: (a.innerText || '').trim().split('\n')[0] })));
      for (const t of pending) {
        if (result[t]) continue;
        const candidates = [];
        for (const l of links) {
          const m = l.href.match(/\/cinemas\/([a-z-]+)\/([a-z0-9-]+)\/buytickets\/([A-Z0-9]+)/);
          if (!m) continue;
          const name = `${l.text} ${m[2].replace(/-/g, ' ')}`;
          if (theaterMatches(name, t)) candidates.push({ city: m[1], slug: m[2], cinemaCode: m[3], displayName: l.text || t });
        }
        // Shortest slug = most specific match ("rohini-silver-screens-koyambedu"
        // over some longer cinema that merely mentions the same words).
        candidates.sort((a, b) => a.slug.length - b.slug.length);
        if (candidates[0]) {
          result[t] = candidates[0];
          cache[`${citySlug(city)}::${t.toLowerCase()}`] = candidates[0];
        }
      }
    } catch { /* try the next page */ }
  }
  for (const t of pending) if (!result[t]) result[t] = null;
  await saveCache(cache);
  return result;
}

async function scrapeCinemaPage(page, cinemaInfo, date, retried = false) {
  const url = `https://in.bookmyshow.com/cinemas/${cinemaInfo.city}/${cinemaInfo.slug}/buytickets/${cinemaInfo.cinemaCode}/${dateToCompact(date)}`;
  await page.goto(url, { waitUntil: 'networkidle', timeout: 45000 });
  // The date strip renders late and unevenly: a fixed 4s pause sometimes
  // caught the page before it existed, and that read as "date-not-found" for
  // a date BookMyShow was selling. Wait for the strip itself (up to 15s).
  await page.waitForFunction(() => [...document.querySelectorAll('div')].some((el) => el.children.length
    && /^[A-Z]{3}\s+\d{1,2}\s+[A-Z]{3}$/.test((el.innerText || '').replace(/\s+/g, ' ').trim())), null, { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(1500);

  const targetDay = parseInt(date.slice(8, 10), 10);
  // Click target date pill if not selected, verify via opacity/text color
  const clickResult = await page.evaluate((targetDay) => {
    for (const el of document.querySelectorAll('div')) {
      if (el.children.length === 0) continue;
      const txt = (el.innerText || '').replace(/\s+/g, ' ').trim();
      const m = txt.match(/^[A-Z]{3}\s+(\d{1,2})\s+[A-Z]{3}$/);
      if (!m || parseInt(m[1], 10) !== targetDay) continue;
      const cs = window.getComputedStyle(el);
      const opacity = parseFloat(cs.opacity || '1');
      let brightness = 0;
      for (const child of el.querySelectorAll('*')) {
        if ((child.innerText || '').trim() === String(targetDay)) {
          const rgb = window.getComputedStyle(child).color.match(/\d+/g);
          if (rgb) brightness = Math.max(+rgb[0], +rgb[1], +rgb[2]);
          break;
        }
      }
      if (!brightness) { const rgb = cs.color.match(/\d+/g); if (rgb) brightness = Math.max(+rgb[0], +rgb[1], +rgb[2]); }
      const isGrey = opacity < 0.7 || (brightness > 100 && brightness < 200);
      if (isGrey) return 'grey';
      el.click();
      return 'clicked';
    }
    return 'not-found';
  }, targetDay);
  // 'grey' is BookMyShow's own way of saying "no shows on this date", so it's a
  // real zero. 'not-found' means the date strip never rendered — that's not an
  // answer, and returning [] for it made a broken page look like an empty one.
  if (clickResult === 'grey') return { rows: [], outcome: 'date-greyed' };
  if (clickResult === 'not-found') {
    // One fresh load before giving up — this is usually a slow render.
    if (!retried) return scrapeCinemaPage(page, cinemaInfo, date, true);
    return { rows: [], outcome: `date-not-found (${page.url().includes('/buytickets/') ? 'no strip' : 'redirected'})` };
  }
  await page.waitForTimeout(3500);

  // Read the shows by what's visible, not by class names (see bms-dom.js).
  // Show times render a beat after the date click; wait for the first one.
  await page.waitForFunction(() => /\b\d{1,2}:\d{2}\s*[AaPp][Mm]\b/.test(document.body.innerText || ''), null, { timeout: 10000 }).catch(() => {});
  const rows = await page.evaluate(readShowsFromDom);
  const textRows = await page.evaluate(readShowsFromText);
  // An open (non-grey) date with no show times at all means the page didn't
  // render — never that the cinema is empty.
  if (!rows.length && !textRows.length) return { rows: [], textRows: [], outcome: 'no-show-times' };
  return { rows, textRows, outcome: 'ok' };
}

// Which outcomes mean "we genuinely looked". Anything else is a non-answer and
// must not be reported as zero shows.
const BMS_ANSWERED = new Set(['ok', 'date-greyed']);

// Title and theater matching live in match.js, shared with district.

export async function findAndCacheEventCode(movie, city) {
  return await withPage(async (page) => {
    const result = await findEventCode(page, movie, city);
    return result ? result.eventCode : null;
  });
}

export async function checkBMS({ movie, city, theaters = [], dateFrom, dateTo }) {
  try {
    return await withPage(async (page) => {
      await page.goto('https://in.bookmyshow.com/', { waitUntil: 'domcontentloaded', timeout: 30000 });
      await page.waitForTimeout(1500);

      const today = new Date();
      const from = dateFrom ? new Date(dateFrom) : today;
      const to = dateTo ? new Date(dateTo) : new Date(today.getTime() + 7 * 86400e3);
      const dates = [];
      let cursor = new Date(from);
      while (cursor <= to && dates.length < 14) {
        dates.push(cursor.toISOString().slice(0, 10));
        cursor = new Date(cursor.getTime() + 86400e3);
      }

      const cache = await loadCache();
      const cityPrefix = `${citySlug(city)}::`;
      const resolved = [];
      const needEventCode = [];
      for (const t of theaters) {
        const exactKey = `${cityPrefix}${t.toLowerCase()}`;
        if (cache[exactKey]) { resolved.push({ ...cache[exactKey], watchTheater: t }); continue; }
        let found = null;
        for (const [k, v] of Object.entries(cache)) {
          if (!k.startsWith(cityPrefix) || !v) continue;
          const searchIn = `${k.slice(cityPrefix.length)} ${v.displayName || ''} ${(v.slug || '').replace(/-/g, ' ')}`;
          if (theaterMatches(searchIn, t)) { found = v; break; }
        }
        if (found) { resolved.push({ ...found, watchTheater: t }); cache[exactKey] = found; saveCache(cache).catch(() => {}); }
        else { needEventCode.push(t); }
      }

      let movieUrl = '';
      const unresolved = [];
      if (needEventCode.length > 0) {
        let found;
        try { found = await findEventCode(page, movie, city); } catch (e) {
          if (resolved.length === 0) return { sessions: [], showDates: [], reason: `could-not-read: ${e.message}` };
          found = null;
        }
        if (!found && resolved.length === 0) return { sessions: [], showDates: [], reason: 'movie-not-listed' };
        if (found) {
          movieUrl = found.movieUrl;
          const cinemaMap = await resolveCinemaUrls(page, found.eventCode, city, needEventCode, dates);
          for (const [t, v] of Object.entries(cinemaMap)) {
            if (v) resolved.push({ ...v, watchTheater: t }); else unresolved.push(t);
          }
        } else unresolved.push(...needEventCode);
      }
      if (resolved.length === 0) return { sessions: [], showDates: [], movieUrl, reason: `no-cinema-resolved: ${unresolved.join(', ')}` };


      const all = [];
      // Dates where we never got an answer. A zero-show result is only
      // trustworthy if this stays empty.
      const unread = [];
      const degraded = [];
      const titlesSeen = new Set();
      for (const cinema of resolved) {
        for (const d of dates) {
          try {
            const { rows, textRows = [], outcome } = await scrapeCinemaPage(page, cinema, d);
            if (!BMS_ANSWERED.has(outcome)) unread.push(`${d} ${outcome}`);
            // Cross-check the two readers. If the structural one finds nothing
            // for this movie but the plain-text one does, BookMyShow has
            // reshaped its page: use the text result (times are right; seat
            // colours are unknown) and flag it so the user hears about it.
            for (const r of rows) titlesSeen.add(r.movieTitle.replace(/\s*\([^)]*\)\s*$/, ''));
            const domHits = rows.filter((r) => titleMatches(r.movieTitle, movie));
            const textHits = textRows.filter((r) => titleMatches(r.movieTitle, movie));
            const domTimes = new Set(domHits.map((r) => r.time));
            const missed = textHits.filter((r) => !domTimes.has(r.time));
            if (missed.length) degraded.push(`${d}: ${missed.length} show(s) only the text reader saw`);
            for (const r of [...domHits, ...missed]) {
              const tier = tierFromRgb(r.rgb || [0, 0, 0]);
              const seatStatusLabel = { available: 'Available', filling: 'Filling Fast', 'almost-full': 'Almost Full', critical: 'Almost Sold Out', 'sold-out': 'Sold Out', unknown: '' }[tier];
              // Three independent labels — the subtitle is NOT folded into
              // `format` any more. Doing that (while also emitting it on its
              // own) is what made the app render "English · 2D ENG · ENG".
              const language = normalizeLanguage(r.language);
              const format = normalizeFormat(r.format);
              const subtitle = normalizeSubtitle(r.subtitle, language);
              const bookUrl = `https://in.bookmyshow.com/cinemas/${cinema.city}/${cinema.slug}/buytickets/${cinema.cinemaCode}/${dateToCompact(d)}`;
              all.push({
                sid: `bms:${cinema.cinemaCode}:${d}:${r.time}`,
                cid: cinema.cinemaCode, theater: cinema.displayName, movieTitle: r.movieTitle, date: d, time: r.time,
                display: `${d} ${r.time}`, format, language, subtitle,
                avail: null, total: null, seatStatus: seatStatusLabel, soldOut: tier === 'sold-out', tier,
                bookUrl, source: 'bms', watchTheater: cinema.watchTheater, bmsCinemaCity: cinema.city, bmsCinemaSlug: cinema.slug, bmsCinemaCode: cinema.cinemaCode,
              });
            }
          } catch (err) {
            // Was `catch {}`. A swallowed navigation timeout or bot wall became
            // an indistinguishable "no shows yet" — the silent false negative
            // that let the Sigma 1:00 PM show vanish from the app while it was
            // still on sale.
            unread.push(`${d} ${(err.message || 'error').replace(/\s+/g, ' ').slice(0, 40)}`);
          }
        }
      }
      // Never report an empty board we aren't sure about. check-core treats a
      // reason as "couldn't look" and holds the previous result instead of
      // wiping it, and the text names which path failed so the next occurrence
      // identifies itself rather than needing another investigation.
      if (all.length === 0 && unread.length) {
        return { sessions: [], showDates: dates, movieUrl, reason: `could-not-read: ${unread.slice(0, 3).join('; ')}` };
      }
      // Some theaters found, others not: still report it, so a typo in one of
      // three names doesn't silently shrink the watch.
      let note = unresolved.length ? `no-cinema-resolved: ${unresolved.join(', ')}` : undefined;
      // Pages read fine, other films are playing, ours isn't among them: name
      // what IS playing, so a misspelt title is obvious at a glance.
      if (!all.length && !note && titlesSeen.size) note = `movie-not-at-theater: ${[...titlesSeen].slice(0, 5).join(', ')}`;
      if (all.length === 0 && note) return { sessions: [], showDates: dates, movieUrl, reason: note };
      return { sessions: all, allSessions: all, showDates: dates, movieUrl, note, degraded: degraded.length ? degraded.join('; ') : undefined };
    });
  } catch (err) {
    return { sessions: [], showDates: [], reason: `error: ${err.message}` };
  }
}
