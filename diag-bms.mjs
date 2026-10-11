// TEMPORARY. Validates the BookMyShow false-negative fix on Actions, which is
// the only environment where BMS treats us the way the watcher sees it.
//
// Two things must hold:
//   1. a real watch still finds its show (the fix didn't break the happy path)
//   2. a pass that cannot read the page reports a `reason` instead of
//      returning a confident, silent zero
import { checkBMS } from './src/scrapers/bookmyshow.js';
import { shutdownBrowser } from './src/browser.js';

const REAL = { movie: 'Sigma', city: 'Chennai', theaters: ['Cinepolis bsr mall'], dateFrom: '2026-10-12', dateTo: '2026-10-12' };

function show(label, res) {
  const n = (res.sessions || []).length;
  const reason = res.reason ?? null;
  const verdict = n > 0
    ? 'FOUND SHOWS'
    : (reason ? 'zero WITH a reason (honest non-answer)' : 'zero with NO reason  <-- SILENT FALSE NEGATIVE');
  console.log(`\n[${label}] sessions=${n} reason=${JSON.stringify(reason)}`);
  console.log(`          -> ${verdict}`);
  if (n) console.log(`          -> ${res.sessions[0].date} ${res.sessions[0].time} ${res.sessions[0].seatStatus} @ ${res.sessions[0].theater}`);
  return { n, reason };
}

console.log('=== 1. happy path, repeated: does the real watch keep finding its show? ===');
const runs = [];
for (let i = 1; i <= 3; i++) {
  runs.push(show(`real #${i}`, await checkBMS(REAL)));
  if (i < 3) await new Promise((r) => setTimeout(r, 20000));
}

console.log('\n=== 2. a date BookMyShow does not offer: must report, not claim zero ===');
// Far enough out that the date strip cannot contain it, forcing the
// date-not-found path that used to return a bare [].
const far = show('far-future', await checkBMS({ ...REAL, dateFrom: '2027-06-01', dateTo: '2027-06-01' }));

console.log('\n=== 3. a movie that genuinely is not playing: must stay a REAL zero ===');
// Must NOT acquire a reason, or check-core would hold a stale board forever.
const absent = show('absent-movie', await checkBMS({ ...REAL, movie: 'Zzzqqxnotamovie' }));

await shutdownBrowser();

console.log('\n==================== VERDICT ====================');
const silent = runs.filter((r) => r.n === 0 && !r.reason).length;
console.log(`happy-path runs finding shows : ${runs.filter((r) => r.n > 0).length}/3`);
console.log(`happy-path silent zeros       : ${silent}  (want 0)`);
console.log(`unreadable date reported      : ${far.n === 0 && far.reason ? 'YES' : 'NO'}  (want YES)`);
console.log(`absent movie stayed a real zero: ${absent.n === 0 && !absent.reason ? 'YES' : 'NO'}  (want YES)`);
const pass = silent === 0 && far.n === 0 && !!far.reason && absent.n === 0 && !absent.reason;
console.log(pass ? 'ALL CHECKS PASS' : 'CHECKS FAILED');
process.exit(pass ? 0 : 1);
