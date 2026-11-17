// TEMPORARY: run the real check pass for the watches that read "No shows yet"
// while BookMyShow was selling them. Delete after verification.
import { checkWatch } from '../src/check-core.js';
import { shutdownBrowser } from '../src/browser.js';

const W = (movie, theaters, d1, d2 = d1) => ({ id: movie, movie, city: 'Chennai', theaters, sites: ['bms', 'district'], dateFrom: d1, dateTo: d2, seenSids: [] });
const CASES = [
  W('Godzilla Minus Zero', ['Rohini silver'], '2026-11-20'),
  W('gozilla', ['rohini sliver screens'], '2026-11-20', '2026-11-21'),
  W('Godzilla Minus Zero', ['Rohini'], '2026-11-20'),
  W('Scene', ['Rohini'], '2026-11-18'),
];
for (const w of CASES) {
  const t0 = Date.now();
  try {
    const { patch } = await checkWatch(w);
    const by = {};
    for (const s of patch.currentSessions) (by[`${s.site}|${s.watchTheater || s.theater}|${s.date}`] ||= []).push(s.time);
    console.log(`\n== ${w.movie} @ ${w.theaters.join(', ')} ${w.dateFrom} (${Math.round((Date.now() - t0) / 1000)}s)`);
    console.log('status:', patch.lastStatus);
    console.log('shows:', JSON.stringify(by));
    console.log('seat urls:', patch.currentSessions.filter((s) => s.resolvedSeatUrl).length, '/', patch.currentSessions.length, '| movie page:', patch.moviePageUrl);
  } catch (e) { console.log('ERR', w.movie, e.stack); }
}
await shutdownBrowser();
