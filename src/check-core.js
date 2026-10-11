import { checkBMS } from './scrapers/bookmyshow.js';
import { checkDistrict } from './scrapers/district.js';
import { getEventCode, saveEventCode } from './event-codes.js';
import { resolveBmsSeatUrl } from './scrapers/bms_seat_resolver.js';
import { normalizeSubtitle } from './scrapers/show-labels.js';

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
export function friendlyReason(reason, siteName) {
  if (!reason) return '';
  if (isNetworkError(reason)) return `${siteName}: network issue (will retry)`;
  if (reason.includes('movie-not-listed')) return `${siteName}: couldn't find this movie — check the spelling`;
  if (reason.includes('no-cinema-resolved')) return `${siteName}: theater not found`;
  // district.in answers 200 to a home connection and 403 to this runner using
  // byte-identical headers, so the block is on the datacenter IP range, not on
  // anything we send. Worth naming precisely: "temporarily blocked" invites
  // pointless UA-tweaking for something no header can fix.
  if (/status code 403/i.test(reason) || reason.includes('blocked')) return `${siteName}: blocks our server's IP`;
  if (/status code 429/i.test(reason)) return `${siteName}: rate-limited (will retry)`;
  return `${siteName}: ${reason.replace(/^error:\s*/, '').slice(0, 60)}`;
}

// "We couldn't look" vs "we looked and it isn't there". Only the first is a
// non-answer worth holding the previous board for; the second is a real result,
// and treating it as a non-answer would leave a finished movie showing last
// week's shows indefinitely.
export function isNonAnswer(reason) {
  if (!reason) return false;
  if (reason.includes('movie-not-listed')) return false;   // looked — absent
  if (reason.includes('no-cinema-resolved')) return false; // looked — no such theater
  return true;                                             // 403 / 429 / 5xx / network / unexpected
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
// Merge the three display labels field-by-field. Whichever site supplies a
// value wins for that field only — we never pick "the longest string", which
// used to let a combined value like "2D ENG" beat a clean "2D".
function mergeLabels(a, b) {
  return {
    language: a.language || b.language || '',
    format: a.format || b.format || '',
    subtitle: a.subtitle || b.subtitle || '',
  };
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
        Object.assign(existing, mergeLabels(existing, s));
      } else if (s.source === 'district' && existing.source === 'bms') {
        const bmsFields = { bmsCinemaCity: existing.bmsCinemaCity, bmsCinemaSlug: existing.bmsCinemaSlug, bmsCinemaCode: existing.bmsCinemaCode, bookUrl: existing.bookUrl };
        map.set(key, { ...s, ...bmsFields, source: 'both', sid: key, ...mergeLabels(existing, s) });
      }
    }
  }
  return [...map.values()];
}

// A show should never render as a bare "3D" with no language. When a site omits
// the language (district often does), borrow the one the rest of this movie's
// shows agree on — a single film in a single city runs in one language far more
// often than not. Same idea for a missing format.
function fillMissingLabels(sessions) {
  const tally = (field) => {
    const counts = new Map();
    for (const s of sessions) if (s[field]) counts.set(s[field], (counts.get(s[field]) || 0) + 1);
    let best = '', bestN = 0;
    for (const [v, n] of counts) if (n > bestN) { best = v; bestN = n; }
    return best;
  };
  const commonLanguage = tally('language');
  const commonFormat = tally('format');
  for (const s of sessions) {
    if (!s.language && commonLanguage) s.language = commonLanguage;
    if (!s.format && commonFormat) s.format = commonFormat;
    // Subtitle is deliberately NOT back-filled — a blank means "the site didn't
    // advertise subtitles for this show", which is information in itself.
    // Re-check it against the *final* language: one site may have reported
    // "ENG" before we knew the film runs in English, and "English · 2D · ENG"
    // tells the user nothing they don't already know.
    s.subtitle = normalizeSubtitle(s.subtitle, s.language);
  }
  return sessions;
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

  // Scrape both sites CONCURRENTLY. They're independent network calls, so
  // running them in sequence made every check take district-time + bms-time.
  // In parallel a pass costs only the slower of the two.
  const jobs = [];
  if (watch.sites.includes('district')) jobs.push({ siteName: 'district.in', p: withRetry(() => checkDistrict(args)) });
  if (watch.sites.includes('bms')) jobs.push({ siteName: 'BookMyShow', p: withRetry(() => checkBMS(args)) });
  const settled = await Promise.all(jobs.map((j) => j.p.catch((e) => ({ reason: e.message || 'error' }))));
  const results = jobs.map((j, i) => ({ siteName: j.siteName, res: settled[i] }));

  const rawSessions = [];
  const reasons = [];
  const rawReasons = [];
  let movieUrl = '';
  for (const { siteName, res } of results) {
    if (res.movieUrl) movieUrl = res.movieUrl;
    if (res.sessions?.length) for (const s of res.sessions) rawSessions.push({ site: siteName, ...s });
    if (res.reason) { reasons.push(friendlyReason(res.reason, siteName)); rawReasons.push(res.reason); }
  }

  const allCurrent = fillMissingLabels(deduplicateSessions(rawSessions));
  // NOTE: `now` is only used for alert/lastSeen bookkeeping. `lastChecked` is
  // stamped at the very END of the pass (see below) — stamping it here would
  // make the app say "3m ago" the instant a 3-minute check finished, because
  // the timestamp would predate all the seat-URL resolution work that follows.
  const now = new Date().toISOString();
  const seenSet = new Set(watch.seenSids || []);
  const currentSidSet = new Set(allCurrent.map((s) => s.sid));
  const newSessions = allCurrent.filter((s) => !seenSet.has(s.sid));

  // A pass that found nothing AND had a site fail has proved nothing — it
  // cannot tell "the show is gone" from "we were unable to look". Treating the
  // two alike is what made the app read 0 shows while BookMyShow was still
  // selling the 1:00 PM Sigma seat: one district.in 403 overwrote
  // currentSessions with [] and buried the good result behind the error text.
  // Hold the previous board only when EVERY site failed to look. If one site
  // answered and said zero, that IS evidence — trusting it is what stops a
  // finished movie from advertising last week's shows forever.
  const allFailedToLook = rawReasons.length > 0
    && rawReasons.length === results.length
    && rawReasons.every(isNonAnswer);
  const inconclusive = allCurrent.length === 0 && allFailedToLook;
  const priorSessions = watch.currentSessions || [];

  let status;
  if (inconclusive) {
    status = priorSessions.length
      ? `last known: ${priorSessions.length} show${priorSessions.length === 1 ? '' : 's'} · ${reasons.join(' · ')}`
      : reasons.join(' · ');
  } else if (allCurrent.length === 0) {
    status = 'No shows yet';
  } else {
    const open = allCurrent.filter((s) => !s.soldOut).length;
    status = `${allCurrent.length} shows · ${open} available · ${allCurrent.length - open} sold out`;
    // Shows were found, but one site still failed — say so quietly rather than
    // hiding it, since the list may be missing that site's screenings.
    if (reasons.length) status += ` · ${reasons.join(' · ')}`;
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
  // Resolve in parallel (bounded to 3 at a time so we don't hammer BMS or
  // exhaust browser contexts). Sequentially this was the single biggest cost
  // in a pass — 6 page loads back-to-back.
  const RESOLVE_CONCURRENCY = 3;
  for (let i = 0; i < toResolve.length; i += RESOLVE_CONCURRENCY) {
    const batch = toResolve.slice(i, i + RESOLVE_CONCURRENCY);
    await Promise.all(batch.map(async (s) => {
      try {
        const url = await resolveBmsSeatUrl({
          city: s.bmsCinemaCity, slug: s.bmsCinemaSlug, cinemaCode: s.bmsCinemaCode,
          date: s.date, time: s.time, movieHint: watch.movie,
        });
        if (url) s.resolvedSeatUrl = url;
      } catch { /* leave unresolved; app falls back to cinema date page */ }
    }));
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

  // Stamp lastChecked NOW — at the true end of the pass, after scraping and
  // seat-URL resolution are done. This is the moment the data became current,
  // so the app's "Last check: Xs ago" counts from when the check *finished*.
  const finishedAt = new Date().toISOString();
  const checkDurationSec = Math.round((Date.now() - runStart) / 100) / 10;
  // On a non-answer, hold the last known board rather than blanking it.
  const patch = {
    lastChecked: finishedAt,
    lastStatus: status,
    currentSessions: inconclusive ? priorSessions : allCurrent,
    lastDurationSec: checkDurationSec,
    // null (not undefined) so it actively clears once a check succeeds again —
    // mergeState spreads the patch, so undefined would leave a stale warning.
    checkFailed: reasons.length ? reasons.join(' · ') : null,
    staleData: inconclusive && priorSessions.length > 0,
  };
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
