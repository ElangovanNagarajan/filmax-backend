// TEMPORARY diagnostic. Answers one question: when checkBMS reports zero shows
// with no error, did it look and find nothing, or did it fail to look?
//
// Must run on GitHub Actions — BookMyShow serves this runner's IP differently
// from a home connection, so reproducing locally proves nothing.
import { withPage, shutdownBrowser } from './src/browser.js';
import { checkBMS } from './src/scrapers/bookmyshow.js';

const CINEMA = { city: 'chennai', slug: 'cinepolis-bsr-mall-omr-thoraipakkam', cinemaCode: 'CBMC' };
const DATE = '2026-10-12';
const MOVIE = 'Sigma';

// The selectors the scraper depends on. Both are styled-components hashes,
// which BookMyShow regenerates on every frontend deploy — the prime suspect.
const MOVIE_CONTAINER = 'div[class*="sc-1412vr2-0"]';
const SHOWTIME_CHIP = 'div[class*="sc-yr56qh-0"]';

await withPage(async (page) => {
  const url = `https://in.bookmyshow.com/cinemas/${CINEMA.city}/${CINEMA.slug}/buytickets/${CINEMA.cinemaCode}/${DATE.replace(/-/g, '')}`;
  console.log('GET', url);
  const resp = await page.goto(url, { waitUntil: 'networkidle', timeout: 45000 }).catch((e) => {
    console.log('NAV ERROR:', e.message);
    return null;
  });
  await page.waitForTimeout(4000);

  console.log('--- page ---');
  console.log('  http status :', resp ? resp.status() : 'n/a');
  console.log('  final url   :', page.url());
  console.log('  title       :', await page.title());

  const probe = await page.evaluate((sels) => {
    const body = document.body ? document.body.innerText : '';
    return {
      bodyChars: body.length,
      movieContainers: document.querySelectorAll(sels.MOVIE_CONTAINER).length,
      showtimeChips: document.querySelectorAll(sels.SHOWTIME_CHIP).length,
      mentionsMovie: /sigma/i.test(body),
      // Is this a wall rather than the page we asked for?
      looksBlocked: /access denied|are you a human|unusual traffic|captcha|forbidden|just a moment/i.test(body),
      // Any styled-components classes at all -> the app rendered, just not
      // under the hashes we hardcoded.
      sampleScClasses: [...new Set([...document.querySelectorAll('div[class*="sc-"]')]
        .flatMap((d) => [...d.classList].filter((c) => c.startsWith('sc-'))))].slice(0, 25),
      firstLines: body.split('\n').map((l) => l.trim()).filter(Boolean).slice(0, 15),
    };
  }, { MOVIE_CONTAINER, SHOWTIME_CHIP });

  console.log('  body chars  :', probe.bodyChars);
  console.log('  looksBlocked:', probe.looksBlocked);
  console.log('  mentions "sigma":', probe.mentionsMovie);
  console.log(`  ${MOVIE_CONTAINER} matches:`, probe.movieContainers, '  <-- 0 means SELECTOR ROT');
  console.log(`  ${SHOWTIME_CHIP} matches:`, probe.showtimeChips);
  console.log('  sc- classes present on page:', JSON.stringify(probe.sampleScClasses));
  console.log('  first visible lines:', JSON.stringify(probe.firstLines, null, 2));
});

console.log('\n=== what the production code returns right now ===');
const res = await checkBMS({ movie: MOVIE, city: 'Chennai', theaters: ['Cinepolis bsr mall'], dateFrom: DATE, dateTo: DATE });
console.log('  sessions :', (res.sessions || []).length);
console.log('  reason   :', JSON.stringify(res.reason ?? null), '  <-- null + 0 sessions = the silent false-negative');
console.log('  movieUrl :', res.movieUrl || '(none)');
if (res.sessions?.length) console.log('  first    :', JSON.stringify(res.sessions[0], null, 2));

await shutdownBrowser();
