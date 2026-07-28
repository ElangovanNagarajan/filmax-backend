import axios from 'axios';
import { normalizeLanguage, normalizeFormat, normalizeSubtitle, extractSubtitleFrom } from './show-labels.js';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

async function fetchHtml(url) {
  const { data } = await axios.get(url, {
    headers: { 'User-Agent': UA, Accept: 'text/html' },
    decompress: true,
    timeout: 20000,
  });
  return data;
}

function extractNextData(html) {
  const m = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  if (!m) return null;
  try {
    return JSON.parse(m[1]);
  } catch {
    return null;
  }
}

async function findMovieUrl(movie, city) {
  const html = await fetchHtml('https://www.district.in/movies/');
  const slugCity = String(city || 'chennai').toLowerCase().replace(/\s+/g, '-');
  const movieLower = movie.toLowerCase().replace(/^(the|a|an)\s+/i, '').trim();
  const pattern = new RegExp(
    `https://www\\.district\\.in/movies/[a-z0-9-]*${movieLower.replace(/[^a-z0-9]/g, '[a-z0-9-]*')}[a-z0-9-]*-movie-tickets-in-${slugCity}-MV\\d+`,
    'i',
  );
  const match = html.match(pattern);
  if (match) return match[0];
  const looseRe = new RegExp(
    `https://www\\.district\\.in/movies/[a-z0-9-]*${movieLower.replace(/[^a-z0-9]/g, '[a-z0-9-]*')}[a-z0-9-]*-movie-tickets-MV(\\d+)`,
    'i',
  );
  const loose = html.match(looseRe);
  if (loose) {
    // Force city into slug
    return loose[0].replace('-movie-tickets-MV', `-movie-tickets-in-${slugCity}-MV`);
  }
  return null;
}

function utcToIST(isoNoTz) {
  const [date, time] = isoNoTz.split('T');
  if (!time) return { date, time: '', display: isoNoTz };
  const [yyyy, mm, dd] = date.split('-').map(Number);
  const [hh, min] = time.split(':').map(Number);
  const utcMs = Date.UTC(yyyy, mm - 1, dd, hh, min);
  const ist = new Date(utcMs + 5.5 * 60 * 60 * 1000);
  const istDate = ist.toISOString().slice(0, 10);
  const istHH = String(ist.getUTCHours()).padStart(2, '0');
  const istMM = String(ist.getUTCMinutes()).padStart(2, '0');
  const h12 = ((ist.getUTCHours() + 11) % 12) + 1;
  const ampm = ist.getUTCHours() >= 12 ? 'PM' : 'AM';
  return {
    date: istDate,
    time: `${istHH}:${istMM}`,
    display: `${istDate} ${String(h12).padStart(2, '0')}:${istMM} ${ampm}`,
  };
}

function tierFromAvail(avail, total, status) {
  if (typeof avail === 'number' && typeof total === 'number' && total > 0) {
    if (avail === 0) return 'sold-out';
    const pct = avail / total;
    if (pct < 0.05) return 'critical';
    if (pct < 0.2) return 'almost-full';
    if (pct < 0.5) return 'filling';
    return 'available';
  }
  const s = (status || '').toLowerCase();
  if (s.includes('sold out')) return 'sold-out';
  if (s.includes('almost full')) return 'almost-full';
  if (s.includes('fast filling') || s.includes('filling fast')) return 'filling';
  if (s.includes('available')) return 'available';
  return 'unknown';
}

function extractSessions(nextData) {
  const ms = nextData?.props?.pageProps?.initialState?.movies?.movieSessions;
  if (!ms) return { sessions: [], showDates: [], movieMid: '' };
  const firstKey = Object.keys(ms)[0];
  if (!firstKey) return { sessions: [], showDates: [], movieMid: '' };
  const obj = ms[firstKey];
  const cinemas = obj.arrangedSessions || [];
  const showDates = obj?.meta?.showDates || [];
  let movieMid = '';
  const result = [];
  for (const c of cinemas) {
    const theater = c.entityName || c?.data?.name || 'Unknown theater';
    for (const s of c.sessions || []) {
      if (s.mcd && !movieMid) movieMid = s.mcd;
      const ist = utcToIST(s.showTime);
      const avail = s.avail ?? null;
      const total = s.total ?? null;
      const status = s.seatStatus || '';
      const soldOut = avail === 0 || /sold out/i.test(status);
      // Language / format / subtitle are kept as three SEPARATE fields and are
      // never concatenated here — the app composes the display line itself.
      // district's session payload spells these a few different ways depending
      // on the endpoint version, so check each known key.
      const rawLang = s.lang || s.language || s.langName || s.movieLang || '';
      const language = normalizeLanguage(rawLang);
      // scrnFmt is like "2D", "3D", "IMAX 3D" — but sometimes arrives as
      // "2D ENG" with the subtitle glued on. Split the format out cleanly.
      const scrnFmt = s.scrnFmt || s.screenFormat || '';
      const format = normalizeFormat(scrnFmt);
      // Subtitle language, e.g. "ENG". Ignore it when it merely repeats the
      // audio language (an English film subtitled ENG tells the user nothing).
      const subtitle = normalizeSubtitle(s.subtitle || extractSubtitleFrom(scrnFmt), language);
      const encSessionId = s.encSessionId || `${c.entityCode}-${s.sid}-${s.mid?.toLowerCase?.() || ''}-${c.entityCode}`;
      result.push({
        sid: String(s.sid),
        cid: String(c.entityCode || s.cid || ''),
        theater,
        date: ist.date,
        time: ist.time,
        display: ist.display,
        format,
        language,
        subtitle,
        avail,
        total,
        seatStatus: status,
        soldOut,
        tier: tierFromAvail(avail, total, status),
        encSessionId,
        source: 'district',
      });
    }
  }
  return { sessions: result, showDates, movieMid };
}

export async function checkDistrict({ movie, city, theaters = [], dateFrom, dateTo }) {
  try {
    const movieUrl = await findMovieUrl(movie, city);
    if (!movieUrl) return { sessions: [], showDates: [], reason: 'movie-not-listed' };

    const html = await fetchHtml(movieUrl);
    const next = extractNextData(html);
    if (!next) return { sessions: [], showDates: [], reason: 'no-next-data', movieUrl };
    const initial = extractSessions(next);
    const showDates = initial.showDates || [];

    let datesToFetch = showDates;
    if (dateFrom || dateTo) {
      datesToFetch = showDates.filter((d) => {
        if (dateFrom && d < dateFrom) return false;
        if (dateTo && d > dateTo) return false;
        return true;
      });
    }
    if (!datesToFetch.length) datesToFetch = showDates;

    const all = [];
    const seen = new Set();
    let movieMid = '';
    for (const d of datesToFetch) {
      const dateUrl = `${movieUrl}?date=${d}`;
      try {
        const dHtml = await fetchHtml(dateUrl);
        const dNext = extractNextData(dHtml);
        if (!dNext) continue;
        const { sessions: dSessions, movieMid: mid } = extractSessions(dNext);
        if (mid && !movieMid) movieMid = mid;
        for (const s of dSessions) {
          // Only accept sessions whose actual date matches what we asked for
          if (s.date !== d) continue;
          if (seen.has(s.sid)) continue;
          seen.add(s.sid);
          const bookUrl = movieMid
            ? `https://www.district.in/movies/seat-layout/${movieMid}?encsessionid=${encodeURIComponent(s.encSessionId)}&freeseating=false&fromsessions=true&type=MOVIES&contentid=undefined`
            : '';
          all.push({ ...s, requestedDate: d, bookUrl });
        }
      } catch {}
    }

    const wanted = theaters.length
      ? all.filter((s) => theaters.some((t) => s.theater.toLowerCase().includes(t.toLowerCase())))
      : all;
    const inRange = wanted.filter((s) => {
      const d = s.requestedDate || s.date;
      if (dateFrom && d < dateFrom) return false;
      if (dateTo && d > dateTo) return false;
      return true;
    });
    const final = inRange.map((s) => ({ ...s, date: s.requestedDate || s.date }));

    return { sessions: final, allSessions: all, showDates, movieUrl };
  } catch (err) {
    return { sessions: [], showDates: [], reason: `error: ${err.message}` };
  }
}
