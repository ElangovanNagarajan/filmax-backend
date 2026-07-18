import { withPage } from '../browser.js';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CACHE_FILE = path.join(__dirname, '..', '..', 'bms_cinema_cache.json');

function citySlug(city) {
  return String(city || 'chennai').toLowerCase().replace(/\s+/g, '-');
}
function cityCode(city) {
  const map = { chennai: 'chen', coimbatore: 'coim', bengaluru: 'bang', bangalore: 'bang', mumbai: 'mumbai', delhi: 'ncr', 'delhi-ncr': 'ncr', hyderabad: 'hyd', pune: 'pune', kolkata: 'kolk' };
  return map[citySlug(city)] || null;
}
function dateToCompact(d) {
  return String(d || '').replace(/-/g, '');
}

const DEFAULT_CACHE = {
  'chennai::phoenix': { city: 'chennai', slug: 'inox-luxe-phoenix-market-city-velachery', cinemaCode: 'INPR', displayName: 'INOX Phoenix Market City' },
  'chennai::phoenix mall': { city: 'chennai', slug: 'inox-luxe-phoenix-market-city-velachery', cinemaCode: 'INPR', displayName: 'INOX Phoenix Market City' },
  'chennai::pheonix': { city: 'chennai', slug: 'inox-luxe-phoenix-market-city-velachery', cinemaCode: 'INPR', displayName: 'INOX Phoenix Market City' },
  'chennai::pheonix mall': { city: 'chennai', slug: 'inox-luxe-phoenix-market-city-velachery', cinemaCode: 'INPR', displayName: 'INOX Phoenix Market City' },
  'chennai::phenoix': { city: 'chennai', slug: 'inox-luxe-phoenix-market-city-velachery', cinemaCode: 'INPR', displayName: 'INOX Phoenix Market City' },
  'chennai::phenoix mall': { city: 'chennai', slug: 'inox-luxe-phoenix-market-city-velachery', cinemaCode: 'INPR', displayName: 'INOX Phoenix Market City' },
  'chennai::inox phoenix': { city: 'chennai', slug: 'inox-luxe-phoenix-market-city-velachery', cinemaCode: 'INPR', displayName: 'INOX Phoenix Market City' },
  'chennai::inox phoenix mall': { city: 'chennai', slug: 'inox-luxe-phoenix-market-city-velachery', cinemaCode: 'INPR', displayName: 'INOX Phoenix Market City' },
  'chennai::phoenix market city': { city: 'chennai', slug: 'inox-luxe-phoenix-market-city-velachery', cinemaCode: 'INPR', displayName: 'INOX Phoenix Market City' },
  'chennai::palazzo': { city: 'chennai', slug: 'pvr-palazzo-the-nexus-vijaya-mall', cinemaCode: 'PVPZ', displayName: 'PVR Palazzo, The Nexus Vijaya Mall' },
  'chennai::pvr palazzo': { city: 'chennai', slug: 'pvr-palazzo-the-nexus-vijaya-mall', cinemaCode: 'PVPZ', displayName: 'PVR Palazzo, The Nexus Vijaya Mall' },
  'chennai::nexus vijaya': { city: 'chennai', slug: 'pvr-palazzo-the-nexus-vijaya-mall', cinemaCode: 'PVPZ', displayName: 'PVR Palazzo, The Nexus Vijaya Mall' },
  'chennai::cinepolis': { city: 'chennai', slug: 'cinepolis-bsr-mall-omr-thoraipakkam', cinemaCode: 'CBMC', displayName: 'Cinepolis BSR Mall' },
  'chennai::cinepolis bsr': { city: 'chennai', slug: 'cinepolis-bsr-mall-omr-thoraipakkam', cinemaCode: 'CBMC', displayName: 'Cinepolis BSR Mall' },
  'chennai::cinepolis bsr mall': { city: 'chennai', slug: 'cinepolis-bsr-mall-omr-thoraipakkam', cinemaCode: 'CBMC', displayName: 'Cinepolis BSR Mall' },
  'chennai::bsr mall': { city: 'chennai', slug: 'cinepolis-bsr-mall-omr-thoraipakkam', cinemaCode: 'CBMC', displayName: 'Cinepolis BSR Mall' },
  'coimbatore::broadway': { city: 'coimbatore', slug: 'broadway-cinemas-coimbatore', cinemaCode: 'BWCB', displayName: 'Broadway Cinemas' },
  'coimbatore::broadway cinemas': { city: 'coimbatore', slug: 'broadway-cinemas-coimbatore', cinemaCode: 'BWCB', displayName: 'Broadway Cinemas' },
};

async function loadCache() {
  try {
    const raw = await fs.readFile(CACHE_FILE, 'utf8');
    return { ...DEFAULT_CACHE, ...JSON.parse(raw || '{}') };
  } catch {
    return { ...DEFAULT_CACHE };
  }
}
async function saveCache(cache) {
  try { await fs.writeFile(CACHE_FILE, JSON.stringify(cache, null, 2)); } catch {}
}

function tierFromRgb([r, g, b]) {
  if (g > 130 && g > r + 40 && g > b + 40) return 'available';
  if (r > 200 && g > 130 && g < 200 && b < 60) return 'filling';
  if (r > 200 && g < 120 && b < 120) return 'critical';
  return 'unknown';
}

async function findEventCode(page, movie, city) {
  const movieLower = movie.toLowerCase().replace(/^(the|a|an)\s+/i, '').trim();
  await page.goto('https://in.bookmyshow.com/', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(1500);
  await page.goto(`https://in.bookmyshow.com/explore/movies-${citySlug(city)}?q=${encodeURIComponent(movieLower)}`, { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(2500);
  const html = await page.content();
  const movieRe = movieLower.replace(/[^a-z0-9]/g, '[a-z0-9-]*');
  const patterns = [
    new RegExp(`/[a-z-]+/movies/[a-z0-9-]*${movieRe}[a-z0-9-]*/(ET\\d{8})`, 'i'),
    new RegExp(`/movies/[a-z-]+/[a-z0-9-]*${movieRe}[a-z0-9-]*/(ET\\d{8})`, 'i'),
    new RegExp(`/movies/[a-z0-9-]*${movieRe}[a-z0-9-]*/(ET\\d{8})`, 'i'),
  ];
  for (const re of patterns) {
    const match = html.match(re);
    if (match) return { eventCode: match[1], movieUrl: 'https://in.bookmyshow.com' + match[0].split('?')[0] };
  }
  return null;
}

async function resolveCinemaUrls(page, movieEventCode, city, theaters) {
  const cache = await loadCache();
  const result = {};
  const needToClick = [];
  for (const t of theaters) {
    const cacheKey = `${citySlug(city)}::${t.toLowerCase()}`;
    if (cache[cacheKey]) { result[t] = cache[cacheKey]; }
    else { needToClick.push(t); }
  }
  if (needToClick.length === 0) return result;

  const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const code = cityCode(city);
  const url = code
    ? `https://in.bookmyshow.com/buytickets/movie-${code}-${movieEventCode}-MT/${today}`
    : `https://in.bookmyshow.com/movies/${citySlug(city)}/buytickets/${movieEventCode}/${today}`;
  await page.goto(url, { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForTimeout(5000);

  for (const t of needToClick) {
    try {
      const tokens = t.toLowerCase().split(/\s+/).filter((w) => w && w.length > 1);
      const matchingName = await page.evaluate((toks) => {
        const out = [];
        document.querySelectorAll('[class*="edljsy"]').forEach((el) => {
          const name = (el.innerText || '').trim();
          const lower = name.toLowerCase();
          if (toks.every((tok) => lower.includes(tok))) out.push(name);
        });
        out.sort((a, b) => a.length - b.length);
        return out[0] || null;
      }, tokens);
      if (!matchingName) { result[t] = null; continue; }

      let cinemaUrl = '';
      const clickOnce = async () => {
        try { await page.locator(`text=${matchingName}`).first().click({ force: true, timeout: 5000 }); } catch {}
        try { await page.waitForURL(/\/cinemas\//, { timeout: 12000 }); return page.url(); } catch { return ''; }
      };
      cinemaUrl = await clickOnce();
      if (!cinemaUrl) {
        await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
        await page.waitForTimeout(3000);
        cinemaUrl = await clickOnce();
      }
      if (!cinemaUrl) { result[t] = null; continue; }
      const m = cinemaUrl.match(/\/cinemas\/([a-z-]+)\/([a-z0-9-]+)\/buytickets\/([A-Z0-9]+)/);
      if (m) {
        const entry = { city: m[1], slug: m[2], cinemaCode: m[3], displayName: t };
        cache[`${citySlug(city)}::${t.toLowerCase()}`] = entry;
        result[t] = entry;
      } else { result[t] = null; }
      await page.goBack({ waitUntil: 'networkidle' }).catch(() => {});
      await page.waitForTimeout(1000);
    } catch { result[t] = null; }
  }
  await saveCache(cache);
  return result;
}

async function scrapeCinemaPage(page, cinemaInfo, date) {
  const url = `https://in.bookmyshow.com/cinemas/${cinemaInfo.city}/${cinemaInfo.slug}/buytickets/${cinemaInfo.cinemaCode}/${dateToCompact(date)}`;
  await page.goto(url, { waitUntil: 'networkidle', timeout: 45000 });
  await page.waitForTimeout(4000);

  const targetDay = parseInt(date.slice(8, 10), 10);
  // Click target date pill if not selected, verify via opacity/text color
  const clickResult = await page.evaluate((targetDay) => {
    for (const el of document.querySelectorAll('div')) {
      if (el.children.length === 0) continue;
      const txt = (el.innerText || '').replace(/\s+/g, ' ').trim();
      const m = txt.match(/^[A-Z]{3}\s+(\d{1,2})\s+[A-Z]{3}$/);
      if (!m || parseInt(m[1], 10) !== targetDay) continue;
      const cs = window.getComputedStyle(el);
      const opacity = parseFloat(cs.opacity || '1');
      let brightness = 0;
      for (const child of el.querySelectorAll('*')) {
        if ((child.innerText || '').trim() === String(targetDay)) {
          const rgb = window.getComputedStyle(child).color.match(/\d+/g);
          if (rgb) brightness = Math.max(+rgb[0], +rgb[1], +rgb[2]);
          break;
        }
      }
      if (!brightness) { const rgb = cs.color.match(/\d+/g); if (rgb) brightness = Math.max(+rgb[0], +rgb[1], +rgb[2]); }
      const isGrey = opacity < 0.7 || (brightness > 100 && brightness < 200);
      if (isGrey) return 'grey';
      el.click();
      return 'clicked';
    }
    return 'not-found';
  }, targetDay);
  if (clickResult === 'grey' || clickResult === 'not-found') return [];
  await page.waitForTimeout(3500);

  const movieCount = await page.evaluate(() => document.querySelectorAll('div[class*="sc-1412vr2-0"]').length);
  if (movieCount === 0) return [];

  const rows = await page.evaluate(() => {
    const KNOWN_LANGUAGES = ['english', 'hindi', 'tamil', 'telugu', 'malayalam', 'kannada', 'bengali', 'marathi', 'gujarati', 'punjabi', 'odia', 'urdu', 'japanese', 'korean', 'french', 'spanish', 'german'];
    const out = [];
    document.querySelectorAll('div[class*="sc-1412vr2-0"]').forEach((c) => {
      const text = (c.innerText || '').trim();
      if (!text) return;
      const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
      const title = lines[0];
      if (!title || title.length < 2 || title.length > 100) return;
      let language = '', format = '';
      for (let i = 1; i < Math.min(lines.length, 5); i++) {
        const l = lines[i];
        if (KNOWN_LANGUAGES.includes(l.toLowerCase())) { language = l; continue; }
        const fmtMatch = l.match(/^,?\s*(2D|3D|IMAX\s*2D|IMAX\s*3D|4DX|ICE|SCREEN\s*X|MX4D)/i);
        if (fmtMatch) { format = fmtMatch[1].toUpperCase(); continue; }
        if (/^\d{1,2}:\d{2}\s*[AaPp][Mm]$/.test(l)) break;
      }
      c.querySelectorAll('div[class*="sc-yr56qh-0"]').forEach((chip) => {
        const chipLines = (chip.innerText || '').split('\n').map((l) => l.trim()).filter(Boolean);
        const t = chipLines[0];
        if (!/^\d{1,2}:\d{2}\s*[AaPp][Mm]$/.test(t)) return;
        const subtitle = chipLines.find((l, i) => i > 0 && /^[A-Z]{2,4}$/.test(l)) || '';
        const style = window.getComputedStyle(chip);
        const m = (style.color || '').match(/rgb\((\d+),\s*(\d+),\s*(\d+)/);
        let r = 0, g = 0, b = 0;
        if (m) { r = +m[1]; g = +m[2]; b = +m[3]; }
        out.push({ movieTitle: title, time: t, rgb: [r, g, b], language, format, subtitle });
      });
    });
    return out;
  });
  return rows;
}

export async function findAndCacheEventCode(movie, city) {
  return await withPage(async (page) => {
    const result = await findEventCode(page, movie, city);
    return result ? result.eventCode : null;
  });
}

export async function checkBMS({ movie, city, theaters = [], dateFrom, dateTo }) {
  try {
    return await withPage(async (page) => {
      await page.goto('https://in.bookmyshow.com/', { waitUntil: 'domcontentloaded', timeout: 30000 });
      await page.waitForTimeout(1500);

      const cache = await loadCache();
      const cityPrefix = `${citySlug(city)}::`;
      const resolved = [];
      const needEventCode = [];
      for (const t of theaters) {
        const exactKey = `${cityPrefix}${t.toLowerCase()}`;
        if (cache[exactKey]) { resolved.push(cache[exactKey]); continue; }
        const tokens = t.toLowerCase().split(/[\s,:]+/).filter((w) => w.length > 2);
        let found = null;
        for (const [k, v] of Object.entries(cache)) {
          if (!k.startsWith(cityPrefix)) continue;
          const searchIn = `${k} ${(v.displayName || '').toLowerCase()} ${(v.slug || '').toLowerCase()}`;
          if (tokens.every((tok) => searchIn.includes(tok))) { found = v; break; }
        }
        if (found) { resolved.push(found); cache[exactKey] = found; saveCache(cache).catch(() => {}); }
        else { needEventCode.push(t); }
      }

      let movieUrl = '';
      if (needEventCode.length > 0) {
        const found = await findEventCode(page, movie, city);
        if (found) {
          movieUrl = found.movieUrl;
          const cinemaMap = await resolveCinemaUrls(page, found.eventCode, city, needEventCode);
          for (const v of Object.values(cinemaMap)) if (v) resolved.push(v);
        }
      }
      if (resolved.length === 0) return { sessions: [], showDates: [], reason: 'no-cinema-resolved' };

      const today = new Date();
      const from = dateFrom ? new Date(dateFrom) : today;
      const to = dateTo ? new Date(dateTo) : new Date(today.getTime() + 7 * 86400e3);
      const dates = [];
      let cursor = new Date(from);
      while (cursor <= to && dates.length < 14) {
        dates.push(cursor.toISOString().slice(0, 10));
        cursor = new Date(cursor.getTime() + 86400e3);
      }

      const all = [];
      const movieLower = movie.toLowerCase();
      for (const cinema of resolved) {
        for (const d of dates) {
          try {
            const rows = await scrapeCinemaPage(page, cinema, d);
            for (const r of rows) {
              if (!r.movieTitle.toLowerCase().includes(movieLower)) continue;
              const tier = tierFromRgb(r.rgb || [0, 0, 0]);
              const seatStatusLabel = { available: 'Available', filling: 'Filling Fast', 'almost-full': 'Almost Full', critical: 'Almost Sold Out', 'sold-out': 'Sold Out', unknown: '' }[tier];
              const fmtParts = [];
              if (r.language && r.language.toLowerCase() !== 'english' && r.language.toLowerCase() !== 'tamil') fmtParts.push(r.language.toUpperCase());
              if (r.format) fmtParts.push(r.format);
              if (r.subtitle) fmtParts.push(r.subtitle);
              const bookUrl = `https://in.bookmyshow.com/cinemas/${cinema.city}/${cinema.slug}/buytickets/${cinema.cinemaCode}/${dateToCompact(d)}`;
              all.push({
                sid: `bms:${cinema.cinemaCode}:${d}:${r.time}`,
                cid: cinema.cinemaCode, theater: cinema.displayName, date: d, time: r.time,
                display: `${d} ${r.time}`, format: fmtParts.join(' '), language: r.language || '', subtitle: r.subtitle || '',
                avail: null, total: null, seatStatus: seatStatusLabel, soldOut: tier === 'sold-out', tier,
                bookUrl, source: 'bms', bmsCinemaCity: cinema.city, bmsCinemaSlug: cinema.slug, bmsCinemaCode: cinema.cinemaCode,
              });
            }
          } catch {}
        }
      }
      return { sessions: all, allSessions: all, showDates: dates, movieUrl };
    });
  } catch (err) {
    return { sessions: [], showDates: [], reason: `error: ${err.message}` };
  }
}
