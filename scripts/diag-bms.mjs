// TEMPORARY: find the JSON BookMyShow's pages load, to parse data instead of
// styled-component class names. Delete after.
import { withPage, shutdownBrowser } from '../src/browser.js';

function findPaths(o, pred, path = '$', out = [], depth = 0) {
  if (out.length > 6 || depth > 14 || !o || typeof o !== 'object') return out;
  if (pred(o)) { out.push(path); return out; }
  for (const [k, v] of Object.entries(o)) findPaths(v, pred, `${path}.${k}`, out, depth + 1);
  return out;
}
const URLS = [
  'https://in.bookmyshow.com/cinemas/chennai/rohini-silver-screens-koyambedu/buytickets/RSSC/20261118',
  'https://in.bookmyshow.com/movies/chennai/scene/buytickets/ET00516631/20261118',
];
for (const url of URLS) {
  await withPage(async (page) => {
    const got = [];
    page.on('response', async (r) => {
      const ct = r.headers()['content-type'] || '';
      if (!/json/.test(ct)) return;
      try { const t = await r.text(); got.push({ url: r.url(), len: t.length, t }); } catch {}
    });
    await page.goto('https://in.bookmyshow.com/', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(1500);
    await page.goto(url, { waitUntil: 'networkidle', timeout: 45000 }).catch(() => {});
    await page.waitForTimeout(6000);
    const html = await page.content();
    console.log(`\n##### ${url} -> ${page.url()}  json responses: ${got.length}`);
    for (const g of got) {
      const hasTime = /\b(10:00 AM|1000|"ShowTime|showTime|showtime)/i.test(g.t);
      console.log(`- ${g.url.slice(0, 160)} len=${g.len} scene=${/scene/i.test(g.t)} time=${hasTime}`);
      if (/scene/i.test(g.t) && hasTime) {
        try {
          const j = JSON.parse(g.t);
          console.log('   top keys:', Object.keys(j).slice(0, 15));
          console.log('   paths to objs w/ time-ish keys:', findPaths(j, (o) => !Array.isArray(o) && Object.keys(o).some((k) => /^show_?time$/i.test(k) || /showtime/i.test(k))));
          const i = g.t.search(/showtime/i); console.log('   sample:', g.t.slice(Math.max(0, i - 600), i + 900));
        } catch (e) { console.log('   not parseable', e.message); }
      }
    }
    // Embedded state in the HTML?
    for (const re of [/window\.__INITIAL_STATE__\s*=/, /__NEXT_DATA__/, /window\.__PRELOADED_STATE__/, /"showtimes?"/i, /"ShowTime"/]) console.log('html has', re, re.test(html));
    const i = html.search(/10:00 AM/); console.log('html near 10:00 AM:', i >= 0 ? html.slice(Math.max(0, i - 500), i + 200).replace(/\s+/g, ' ') : 'none');
  }).catch((e) => console.log('ERR', e.message));
}
await shutdownBrowser();
