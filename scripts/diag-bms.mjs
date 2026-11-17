// TEMPORARY: map the embedded BMS show data (SessionId etc.).
import { withPage, shutdownBrowser } from '../src/browser.js';
const URL = 'https://in.bookmyshow.com/cinemas/chennai/rohini-silver-screens-koyambedu/buytickets/RSSC/20261120';
await withPage(async (page) => {
  await page.goto('https://in.bookmyshow.com/', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(1500);
  await page.goto(URL, { waitUntil: 'networkidle', timeout: 45000 }).catch(() => {});
  await page.waitForTimeout(3000);
  const html = await page.content();
  const i = html.indexOf('"SessionId"');
  // Which <script> holds it, and how does it start?
  const sStart = html.lastIndexOf('<script', i);
  console.log('script tag:', html.slice(sStart, sStart + 300));
  console.log('context before first SessionId:', html.slice(i - 2500, i + 200));
  const res = await page.evaluate(() => {
    const out = {};
    for (const k of Object.keys(window)) {
      try { const v = window[k]; if (v && typeof v === 'object' && JSON.stringify(v).includes('"SessionId"')) out[k] = JSON.stringify(v).length; } catch {}
    }
    return out;
  });
  console.log('window globals holding SessionId:', res);
});
await shutdownBrowser();
