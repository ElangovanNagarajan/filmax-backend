import { withPage } from '../browser.js';

function dateToCompact(d) { return String(d || '').replace(/-/g, ''); }
function to12h(time) {
  if (!time) return time;
  if (/[AaPp][Mm]/.test(time)) return time;
  const m = time.match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return time;
  let h = parseInt(m[1], 10);
  const min = m[2];
  const ampm = h >= 12 ? 'PM' : 'AM';
  h = ((h + 11) % 12) + 1;
  return `${String(h).padStart(2, '0')}:${min} ${ampm}`;
}

export async function resolveBmsSeatUrl({ city, slug, cinemaCode, date, time, movieHint }) {
  if (!city || !slug || !cinemaCode || !date || !time) return null;
  time = to12h(time);
  const cinemaUrl = `https://in.bookmyshow.com/cinemas/${city}/${slug}/buytickets/${cinemaCode}/${dateToCompact(date)}`;

  return await withPage(async (page) => {
    await page.goto('https://in.bookmyshow.com/', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(1000);
    await page.goto(cinemaUrl, { waitUntil: 'networkidle', timeout: 45000 });
    await page.waitForTimeout(4000);

    const targetDay = parseInt(date.slice(8, 10), 10);
    await page.evaluate((targetDay) => {
      for (const el of document.querySelectorAll('div')) {
        if (el.children.length === 0) continue;
        const txt = (el.innerText || '').replace(/\s+/g, ' ').trim();
        const m = txt.match(/^[A-Z]{3}\s+(\d{1,2})\s+[A-Z]{3}$/);
        if (m && parseInt(m[1], 10) === targetDay) { el.click(); return; }
      }
    }, targetDay);
    await page.waitForTimeout(2000);

    // Find the button by what it says — its time, under the right title —
    // not by class names, which BookMyShow regenerates on deploys.
    await page.waitForFunction(() => /\b\d{1,2}:\d{2}\s*[AaPp][Mm]\b/.test(document.body.innerText || ''), null, { timeout: 10000 }).catch(() => {});
    const result = await page.evaluate(({ time, movieHint }) => {
      const key = (x) => String(x || '').toLowerCase().replace(/[^a-z0-9]/g, '');
      const want = key(movieHint);
      const norm = (t) => t.replace(/\s+/g, ' ').trim().toUpperCase();
      const TIME = /^\d{1,2}:\d{2}\s*[AaPp][Mm]$/;
      for (const el of document.querySelectorAll('body *')) {
        if (el.children.length || norm(el.textContent || '') !== norm(time)) continue;
        // Walk up to the first ancestor whose first line is a title, not a time.
        let block = el.parentElement;
        for (let up = 0; block && up < 12; up++, block = block.parentElement) {
          const fl = ((block.innerText || '').split('\n').map((l) => l.trim()).find(Boolean) || '');
          if (fl && !TIME.test(fl) && fl.length > 3 && !/^[A-Z]{2,4}$/.test(fl)) break;
        }
        const title = ((block?.innerText || '').split('\n').map((l) => l.trim()).find(Boolean) || '');
        if (want && !key(title).includes(want) && !want.includes(key(title))) continue;
        el.click();
        return 'clicked';
      }
      return 'not-found';
    }, { time, movieHint: movieHint || '' });
    if (result !== 'clicked') return null;

    const start = Date.now();
    while (Date.now() - start < 10000) {
      await page.waitForTimeout(300);
      if (page.url().includes('/seat-layout/')) return page.url();
    }
    try {
      const cont = page.locator('text=Continue').first();
      if ((await cont.count()) > 0) {
        await cont.click({ force: true });
        await page.waitForTimeout(4000);
        if (page.url().includes('/seat-layout/')) return page.url();
      }
    } catch {}
    return page.url().includes('/seat-layout/') ? page.url() : null;
  });
}
