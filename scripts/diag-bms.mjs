// TEMPORARY: trace every step of the BMS lookup for the watches that read
// "No shows yet" while BookMyShow was selling them. Delete after diagnosis.
import { withPage, shutdownBrowser } from '../src/browser.js';

const CASES = [
  ['Scene', 'Rohini', '2026-11-18'],
  ['Godzilla Minus Zero', 'Rohini silver', '2026-11-20'],
];

for (const [movie, theater, date] of CASES) {
  console.log(`\n===== ${movie} @ ${theater} ${date} =====`);
  await withPage(async (page) => {
    await page.goto('https://in.bookmyshow.com/', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(1500);
    const q = movie.toLowerCase();
    await page.goto(`https://in.bookmyshow.com/explore/movies-chennai?q=${encodeURIComponent(q)}`, { waitUntil: 'networkidle', timeout: 45000 }).catch((e) => console.log('explore nav:', e.message.slice(0, 80)));
    await page.waitForTimeout(2500);
    const html = await page.content();
    const links = [...new Set(html.match(/\/movies\/[a-z0-9-]+\/ET\d{8}/gi) || [])];
    console.log('explore ET links:', links.length, links.filter((l) => /godzilla|scene/i.test(l)));
    const eb = await page.evaluate(() => document.body.innerText);
    console.log('explore url', page.url(), 'blocked?', /you have been blocked/i.test(eb), 'len', html.length);
    console.log('explore body head:', eb.slice(0, 400).replace(/\n/g, ' | '));
    console.log('explore lines w/ term:', (eb.match(new RegExp('.*' + q.split(' ')[0] + '.*', 'gi')) || []).slice(0, 8));
    console.log('any ET in html:', [...new Set(html.match(/[a-z0-9\/-]{0,60}ET\d{8}/gi) || [])].slice(0, 8));
    const code = (links.find((l) => l.includes(q.split(' ')[0])) || '').match(/ET\d{8}/)?.[0] || (movie === 'Scene' ? 'ET00516631' : '');
    if (!code) return;

    const dc = date.replace(/-/g, '');
    for (const url of [`https://in.bookmyshow.com/buytickets/movie-chen-${code}-MT/${dc}`, `https://in.bookmyshow.com/movies/chennai/x/buytickets/${code}/${dc}`]) {
      await page.goto(url, { waitUntil: 'networkidle', timeout: 60000 }).catch((e) => console.log('nav:', e.message.slice(0, 80)));
      await page.waitForTimeout(5000);
      const body = await page.evaluate(() => document.body.innerText);
      const names = await page.evaluate(() => [...document.querySelectorAll('[class*="edljsy"]')].map((e) => e.innerText.trim()));
      console.log('\nURL', url, '->', page.url());
      console.log('blocked?', /you have been blocked/i.test(body), '| edljsy count', names.length, '| rohini in edljsy', names.filter((n) => /rohini/i.test(n)));
      console.log('rohini lines in body:', (body.match(/.*rohini.*/gi) || []).slice(0, 5));
      console.log('body head:', body.slice(0, 300).replace(/\n/g, ' | '));
      const cinemaLinks = await page.evaluate(() => [...document.querySelectorAll('a[href*="/cinemas/"]')].map((a) => a.href).filter((h) => /rohini/i.test(h)));
      console.log('rohini cinema hrefs:', cinemaLinks.slice(0, 3));
    }

    // Cinema page for Rohini, then the date strip and the film titles on it.
    const cUrl = `https://in.bookmyshow.com/cinemas/chennai/rohini-silver-screens-koyambedu/buytickets/ROHN/${dc}`;
    await page.goto(cUrl, { waitUntil: 'networkidle', timeout: 45000 }).catch((e) => console.log('cinema nav:', e.message.slice(0, 80)));
    await page.waitForTimeout(4000);
    console.log('\nCINEMA', cUrl, '->', page.url());
    const pills = await page.evaluate(() => [...document.querySelectorAll('div')].filter((el) => el.children.length && /^[A-Z]{3}\s+\d{1,2}\s+[A-Z]{3}$/.test((el.innerText || '').replace(/\s+/g, ' ').trim())).map((el) => (el.innerText || '').replace(/\s+/g, ' ').trim() + ' op=' + getComputedStyle(el).opacity + ' col=' + getComputedStyle(el).color));
    console.log('date pills:', pills.slice(0, 10));
    const titles = await page.evaluate(() => [...document.querySelectorAll('div[class*="sc-1412vr2-0"]')].map((c) => (c.innerText || '').split('\n')[0]));
    console.log('sc-1412vr2-0 titles:', titles);
    const body = await page.evaluate(() => document.body.innerText);
    console.log('cinema body head:', body.slice(0, 600).replace(/\n/g, ' | '));
  }).catch((e) => console.log('ERR', e.message));
}
await shutdownBrowser();
