// TEMPORARY: verify the class-free BookMyShow readers on real watches.
import { checkWatch } from '../src/check-core.js';
import { shutdownBrowser } from '../src/browser.js';

const W = (movie, theaters, d1, d2 = d1) => ({ id: movie, movie, city: 'Chennai', theaters, sites: ['bms', 'district'], dateFrom: d1, dateTo: d2, seenSids: [] });
const CASES = [
  W('gozila minus zero', ['rohini'], '2026-11-20'),
  W('Scene', ['Rohini'], '2026-11-18'),
];
for (const w of CASES) {
  const t0 = Date.now();
  try {
    const { patch, siteHealth } = await checkWatch(w);
    const by = {};
    for (const s of patch.currentSessions) (by[`${s.site}|${s.watchTheater || s.theater}|${s.date}`] ||= []).push(`${s.time}${s.tier && s.tier !== 'unknown' ? '' : '?'}`);
    console.log(`\n== ${w.movie} @ ${w.theaters.join(', ')} ${w.dateFrom}..${w.dateTo} (${Math.round((Date.now() - t0) / 1000)}s)`);
    console.log('status:', patch.lastStatus);
    console.log('health:', JSON.stringify(siteHealth));
    console.log('shows (? = no seat colour):', JSON.stringify(by));
    console.log('bms titles:', [...new Set(patch.currentSessions.map((s) => s.movieTitle).filter(Boolean))]);
    console.log('seat urls:', patch.currentSessions.filter((s) => s.resolvedSeatUrl).length, '/', patch.currentSessions.length);
  } catch (e) { console.log('ERR', w.movie, e.stack); }
}
await shutdownBrowser();
// run 1794938342
