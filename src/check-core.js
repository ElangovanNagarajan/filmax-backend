import { checkBMS } from './scrapers/bookmyshow.js';
import { checkDistrict } from './scrapers/district.js';
import { getEventCode, saveEventCode } from './event-codes.js';
import { resolveBmsSeatUrl } from './scrapers/bms_seat_resolver.js';

function movieSlug(movie) {
  return movie.toLowerCase().replace(/^(the|a|an)\s+/i, '').replace(/[^a-z0-9]+/g, '-');
}

// Build the BMS destination URL for the movie-name tap.
// Single language -> buytickets page (theaters+showtimes); multi -> poster page.
function resolveMoviePageUrl(watch, sessions, eventCode) {
  if (!eventCode) return '';
  const city = (watch.city || 'chennai').toLowerCase();
  const slug = movieSlug(watch.movie);
  const langs = new Set(sessions.map((s) => (s.language || '').toLowerCase()).filter(Boolean));
  if (langs.size > 1) return `https://in.bookmyshow.com/${city}/movies/${slug}/${eventCode}`;
  const dateCompact = (watch.dateFrom || new Date().toISOString().slice(0, 10)).replace(/-/g, '');
  return `https://in.bookmyshow.com/movies/${city}/${slug}/buytickets/${eventCode}/${dateCompact}`;
}

const NETWORK_ERROR_PATTERNS = ['ERR_NAME_NOT_RESOLVED', 'EAI_AGAIN', 'ENOTFOUND', 'ETIMEDOUT', 'ECONNRESET', 'ECONNREFUSED', 'net::ERR_', 'timeout'];
function isNetworkError(reason) {
  if (!reason) return false;
  return NETWORK_ERROR_PATTERNS.some((p) => reason.toLowerCase().includes(p.toLowerCase()));
}
function friendlyReason(reason, siteName) {
  if (!reason) return '';
  if (isNetworkError(reason)) return `${siteName}: network issue (will retry)`;
  if (reason.includes('movie-not-listed')) return `${siteName}: movie not listed`;
  if (reason.includes('no-cinema-resolved')) return `${siteName}: theater not found`;
  if (reason.includes('blocked')) return `${siteName}: temporarily blocked`;
  return `${siteName}: ${reason.replace(/^error:\s*/, '').slice(0, 60)}`;
}
async function withRetry(fn, attempts = 2) {
  let last;
  for (let i = 0; i < attempts; i++) {
    const res = await fn();
    last = res;
    if (!isNetworkError(res?.reason)) return res;
    if (i < attempts - 1) await new Promise((r) => setTimeout(r, 1500));
  }
  return last;
}
function normalizeTime(t) {
  if (!t) return '';
  const m = String(t).trim().match(/^(\d{1,2}):(\d{2})\s*([AaPp][Mm])?$/);
  if (!m) return t;
  let h = parseInt(m[1], 10);
  const min = m[2];
  const ampm = (m[3] || '').toUpperCase();
  if (ampm === 'PM' && h < 12) h += 12;
  if (ampm === 'AM' && h === 12) h = 0;
  return `${String(h).padStart(2, '0')}:${min}`;
}
function deduplicateSessions(sessions) {
  const map = new Map();
  for (const s of sessions) {
    const key = `${s.date || ''}|${normalizeTime(s.time)}`;
    const existing = map.get(key);
    if (!existing) { map.set(key, { ...s, sid: key }); }
    else {
      if (s.source === 'bms' && existing.source === 'district') {
        existing.bmsCinemaCity = s.bmsCinemaCity; existing.bmsCinemaSlug = s.bmsCinemaSlug;
        existing.bmsCinemaCode = s.bmsCinemaCode; existing.bookUrl = s.bookUrl; existing.source = 'both';
        if ((s.format || '').length > (existing.format || '').length) existing.format = s.format;
        if (s.language && !existing.language) existing.language = s.language;
      } else if (s.source === 'district' && existing.source === 'bms') {
        const bmsFields = { bmsCinemaCity: existing.bmsCinemaCity, bmsCinemaSlug: existing.bmsCinemaSlug, bmsCinemaCode: existing.bmsCinemaCode, bookUrl: existing.bookUrl };
        const format = (existing.format || '').length >= (s.format || '').length ? existing.format : s.format;
        const language = existing.language || s.language || '';
        map.set(key, { ...s, ...bmsFields, source: 'both', sid: key, format, language });
      }
    }
  }
  return [...map.values()];
}

function formatAlert(movie, theater, alertable) {
  const uniqueDates = [...new Set(alertable.map((s) => s.date))].sort();
  const dateParts = uniqueDates.map((d) => {
    const dt = new Date(d + 'T00:00:00');
    const weekday = dt.toLocaleDateString('en-IN', { weekday: 'short' });
    const day = dt.toLocaleDateString('en-IN', { day: '2-digit' });
    const month = dt.toLocaleDateString('en-IN', { month: 'short' });
    return `${weekday} ${day} ${month}`;
  });
  return `${movie} [${theater}] - ${dateParts.join(', ')} - Booking Opened`;
}

/**
 * Runs one check pass for a watch. Pure logic — no storage side effects.
 * Returns { patch, alert } where patch is the fields to persist and
 * alert (or null) is { body, url } to send to Telegram.
 */
export async function checkWatch(watch) {
  const runStart = Date.now();
  const args = { movie: watch.movie, city: watch.city, theaters: watch.theaters, dateFrom: watch.dateFrom || undefined, dateTo: watch.dateTo || undefined };

  const results = [];
  if (watch.sites.includes('district')) results.push({ siteName: 'district.in', res: await withRetry(() => checkDistrict(args)) });
  if (watch.sites.includes('bms')) results.push({ siteName: 'BookMyShow', res: await withRetry(() => checkBMS(args)) });

  const rawSessions = [];
  const reasons = [];
  let movieUrl = '';
  for (const { siteName, res } of results) {
    if (res.movieUrl) movieUrl = res.movieUrl;
    if (res.sessions?.length) for (const s of res.sessions) rawSessions.push({ site: siteName, ...s });
    if (res.reason) reasons.push(friendlyReason(res.reason, siteName));
  }

  const allCurrent = deduplicateSessions(rawSessions);
  const now = new Date().toISOString();
  const seenSet = new Set(watch.seenSids || []);
  const currentSidSet = new Set(allCurrent.map((s) => s.sid));
  const newSessions = allCurrent.filter((s) => !seenSet.has(s.sid));

  let status;
  if (allCurrent.length === 0) status = reasons.length ? reasons.join(' · ') : 'No shows yet';
  else {
    const open = allCurrent.filter((s) => !s.soldOut).length;
    status = `${allCurrent.length} shows · ${open} available · ${allCurrent.length - open} sold out`;
  }

  // Carry forward already-resolved seat URLs from the previous check so we
  // don't re-run Playwright for shows we've already resolved.
  const priorByStableSid = new Map((watch.currentSessions || []).map((s) => [`${s.date}|${s.time}`, s]));
  for (const s of allCurrent) {
    const prior = priorByStableSid.get(`${s.date}|${s.time}`);
    if (prior?.resolvedSeatUrl && !s.resolvedSeatUrl) s.resolvedSeatUrl = prior.resolvedSeatUrl;
  }

  // Pre-resolve the exact BMS seat-layout URL for each unresolved, non-sold-out
  // BMS-backed show, so the app can open it instantly on tap. Cap the work per
  // pass so a check never runs long. district-only shows keep their bookUrl.
  const toResolve = allCurrent
    .filter((s) => !s.resolvedSeatUrl && !s.soldOut && s.bmsCinemaSlug && s.bmsCinemaCode)
    .slice(0, 6);
  for (const s of toResolve) {
    try {
      const url = await resolveBmsSeatUrl({
        city: s.bmsCinemaCity, slug: s.bmsCinemaSlug, cinemaCode: s.bmsCinemaCode,
        date: s.date, time: s.time, movieHint: watch.movie,
      });
      if (url) s.resolvedSeatUrl = url;
    } catch { /* leave unresolved; app falls back to cinema date page */ }
  }

  // Resolve/refresh the movie-page URL for the movie-name tap.
  const city = watch.city || 'chennai';
  let eventCode = getEventCode(watch.movie, city);
  if (!eventCode && movieUrl) { const m = movieUrl.match(/\/(ET\d{8})/); if (m) { eventCode = m[1]; saveEventCode(watch.movie, city, eventCode).catch(() => {}); } }
  // Harvest event code from any resolved seat URL too (helps movie-name tap).
  if (!eventCode) {
    for (const s of allCurrent) {
      const m = s.resolvedSeatUrl?.match(/\/(ET\d{8})/);
      if (m) { eventCode = m[1]; saveEventCode(watch.movie, city, eventCode).catch(() => {}); break; }
    }
  }
  const moviePageUrl = resolveMoviePageUrl(watch, allCurrent, eventCode);

  const checkDurationSec = Math.round((Date.now() - runStart) / 100) / 10;
  const patch = { lastChecked: now, lastStatus: status, currentSessions: allCurrent, lastDurationSec: checkDurationSec };
  if (moviePageUrl) patch.moviePageUrl = moviePageUrl;
  if (movieUrl) patch.bmsMovieUrl = movieUrl;
  if (allCurrent.length) patch.lastSeen = now;

  let alert = null;
  if (newSessions.length) {
    patch.seenSids = [...seenSet, ...newSessions.map((s) => s.sid)];
    const alertable = newSessions.filter((s) => !s.soldOut);
    if (alertable.length) {
      patch.notifiedAt = now;
      const theater = watch.theaters.join(', ');
      alert = { body: formatAlert(watch.movie, theater, alertable), url: movieUrl || 'https://in.bookmyshow.com/', count: alertable.length };
    }
  }
  if (allCurrent.length) patch.seenSids = (patch.seenSids || watch.seenSids || []).filter((sid) => currentSidSet.has(sid));

  return { patch, alert };
}
