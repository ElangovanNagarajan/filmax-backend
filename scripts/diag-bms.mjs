// TEMPORARY: verify exact seat links for every show + short statuses.
import { checkWatch } from '../src/check-core.js';
import { shutdownBrowser } from '../src/browser.js';
const W = (movie, theaters, d1, d2 = d1) => ({ id: movie, movie, city: 'Chennai', theaters, sites: ['bms', 'district'], dateFrom: d1, dateTo: d2, seenSids: [] });
for (const w of [
  W('Scene', ['Rohini'], '2026-11-19'),
  W('Godzilla Minus Zero', ['Rohini'], '2026-11-20'),
  W('Scene', ['Cinepolis', 'Phoenix', 'Palazzo'], '2026-11-19'),
  W('Nonexistent Film Qq', ['Rohini'], '2026-11-19'),
  W('Scene', ['Kasi Talkies'], '2026-11-19'),
]) {
  const t0 = Date.now();
  const { patch, siteHealth } = await checkWatch(w);
  const ss = patch.currentSessions;
  console.log(`\n== ${w.movie} @ ${w.theaters.join(', ')} ${w.dateFrom} (${Math.round((Date.now() - t0) / 1000)}s)`);
  console.log('status:', patch.lastStatus, '| card warning:', patch.checkFailed);
  console.log('health:', JSON.stringify(siteHealth));
  console.log('exact seat links:', ss.filter((s) => /seat-layout/.test(s.resolvedSeatUrl || '')).length, '/', ss.length,
    '| non-BMS links:', ss.filter((s) => [s.resolvedSeatUrl, s.bookUrl].some((u) => u && !/bookmyshow/.test(u))).length,
    '| no BMS target:', ss.filter((s) => !s.resolvedSeatUrl && !s.bmsCinemaCode).length);
  console.log('sample:', ss.slice(0, 3).map((s) => `${s.watchTheater} ${s.time} ${s.tier} ${s.resolvedSeatUrl || s.bookUrl}`));
}
await shutdownBrowser();
