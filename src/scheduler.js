import { getWatches, updateWatch } from './storage.js';
import { checkBMS } from './scrapers/bookmyshow.js';
import { checkDistrict } from './scrapers/district.js';
import { sendAlert } from './telegram.js';

const timers = new Map();
const inFlight = new Set();

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

export async function runOne(watchId) {
  const { masterEnabled } = await import('./server.js');
  if (!masterEnabled) return;
  const watches = await getWatches();
  const watch = watches.find((w) => w.id === watchId);
  if (!watch || !watch.enabled) return;

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

  const checkDurationSec = Math.round((Date.now() - runStart) / 100) / 10;
  const patch = { lastChecked: now, lastStatus: status, currentSessions: allCurrent, lastDurationSec: checkDurationSec };
  if (allCurrent.length) patch.lastSeen = now;

  if (newSessions.length) {
    patch.seenSids = [...seenSet, ...newSessions.map((s) => s.sid)];
    const alertable = newSessions.filter((s) => !s.soldOut);
    if (alertable.length) {
      patch.notifiedAt = now;
      const theater = watch.theaters.join(', ');
      const uniqueDates = [...new Set(alertable.map((s) => s.date))].sort();
      const dateParts = uniqueDates.map((d) => {
        const dt = new Date(d + 'T00:00:00');
        const weekday = dt.toLocaleDateString('en-IN', { weekday: 'short' });
        const day = dt.toLocaleDateString('en-IN', { day: '2-digit' });
        const month = dt.toLocaleDateString('en-IN', { month: 'short' });
        return `${weekday} ${day} ${month}`;
      });
      const msg = `${watch.movie} [${theater}] - ${dateParts.join(', ')} - Booking Opened`;
      await sendAlert({ movie: watch.movie, theater, url: movieUrl || 'https://in.bookmyshow.com/', body: msg });
      console.log(`[scheduler] ALERT for "${watch.movie}" — ${alertable.length} new show(s)`);
    }
  }

  if (allCurrent.length) patch.seenSids = (patch.seenSids || watch.seenSids || []).filter((sid) => currentSidSet.has(sid));
  await updateWatch(watch.id, patch);
}

async function tick(watchId) {
  const watches = await getWatches();
  const watch = watches.find((w) => w.id === watchId);
  if (watch && watch.enabled) {
    const ms = Math.max(5, watch.intervalSec) * 1000;
    timers.set(watchId, setTimeout(() => tick(watchId), ms));
  } else { timers.delete(watchId); return; }

  if (inFlight.has(watchId)) return;
  inFlight.add(watchId);
  try { await runOne(watchId); }
  catch (err) { console.error(`[scheduler] tick error for ${watchId}:`, err.message); }
  finally { inFlight.delete(watchId); }
}

export async function startScheduler() {
  const watches = await getWatches();
  for (const w of watches) if (w.enabled) tick(w.id);
  console.log(`[scheduler] started ${timers.size} watcher(s)`);
}
export function startWatch(id) { if (!timers.has(id)) tick(id); }
export function stopWatch(id) { const t = timers.get(id); if (t) { clearTimeout(t); timers.delete(id); } }
export function restartWatch(id) { stopWatch(id); startWatch(id); }
