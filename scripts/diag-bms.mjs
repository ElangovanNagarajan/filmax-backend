// TEMPORARY: where does a show's seat-layout id live on the cinema page?
import { withPage, shutdownBrowser } from '../src/browser.js';
const URL = 'https://in.bookmyshow.com/cinemas/chennai/rohini-silver-screens-koyambedu/buytickets/RSSC/20261118';
await withPage(async (page) => {
  const reqs = [];
  page.on('request', (r) => { if (!/\.(png|jpg|webp|svg|css|woff2?|js)(\?|$)/.test(r.url())) reqs.push(r.url()); });
  await page.goto('https://in.bookmyshow.com/', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(1500);
  await page.goto(URL, { waitUntil: 'networkidle', timeout: 45000 }).catch(() => {});
  await page.waitForFunction(() => /\b\d{1,2}:\d{2}\s*[AP]M\b/.test(document.body.innerText), null, { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(2000);
  const info = await page.evaluate(() => {
    const leaf = [...document.querySelectorAll('body *')].find((e) => !e.children.length && /^\d{1,2}:\d{2}\s*[AP]M$/.test((e.textContent || '').trim()));
    if (!leaf) return 'no chip';
    const chain = [];
    for (let el = leaf, i = 0; el && i < 8; el = el.parentElement, i++) {
      chain.push(`${el.tagName} ${[...el.attributes].map((a) => `${a.name}="${a.value.slice(0, 80)}"`).join(' ')}`);
    }
    // React props on the chip often carry the session id.
    const fiberKey = Object.keys(leaf.parentElement || {}).find((k) => k.startsWith('__reactProps') || k.startsWith('__reactFiber'));
    let props = '';
    try {
      let f = leaf[Object.keys(leaf).find((k) => k.startsWith('__reactFiber'))];
      for (let i = 0; f && i < 12; i++, f = f.return) {
        const p = f.memoizedProps;
        if (p && typeof p === 'object') {
          const s = JSON.stringify(p, (k, v) => (k === 'children' || typeof v === 'function' ? undefined : v));
          if (s && s.length > 20 && /\d{4,}/.test(s)) { props += `\n  [${i}] ${s.slice(0, 600)}`; }
        }
      }
    } catch (e) { props = 'err ' + e.message; }
    return { time: leaf.textContent, chain, fiberKey, props };
  });
  console.log(JSON.stringify(info, null, 1));
  const html = await page.content();
  console.log('html has sessionId-ish:', (html.match(/"?(sessionId|SessionId|sid|showId)"?\s*[:=]\s*"?\d+/g) || []).slice(0, 10));
  const before = reqs.length;
  await page.evaluate(() => {
    const leaf = [...document.querySelectorAll('body *')].find((e) => !e.children.length && /^\d{1,2}:\d{2}\s*[AP]M$/.test((e.textContent || '').trim()));
    leaf.click();
  });
  await page.waitForTimeout(6000);
  console.log('after click url:', page.url());
  console.log('requests after click:', reqs.slice(before).map((u) => u.slice(0, 200)));
  const body = await page.evaluate(() => document.body.innerText.slice(0, 400));
  console.log('body:', body.replace(/\n/g, ' | '));
});
await shutdownBrowser();
