import 'dotenv/config';
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getWatches, getWatch, addWatch, updateWatch, deleteWatch } from './storage.js';
import { startScheduler, startWatch, stopWatch, restartWatch, runOne } from './scheduler.js';
import { sendTestMessage } from './telegram.js';
import { shutdownBrowser } from './browser.js';
import { resolveBmsSeatUrl } from './scrapers/bms_seat_resolver.js';
import { getEventCode, saveEventCode } from './event-codes.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(express.json());
app.use((_req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (_req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});
app.use(express.static(path.join(__dirname, '..', 'public')));

app.get('/api/health', (_req, res) => res.json({ status: 'ok', uptime: process.uptime() }));

export let masterEnabled = true;
app.get('/api/master', (_req, res) => res.json({ enabled: masterEnabled }));
app.post('/api/master', (req, res) => { masterEnabled = req.body.enabled !== false; res.json({ enabled: masterEnabled }); });

app.get('/api/watches', async (_req, res) => res.json(await getWatches()));

app.post('/api/watches', async (req, res) => {
  const watch = await addWatch(req.body);
  startWatch(watch.id);
  res.status(201).json(watch);
  const city = (watch.city || 'chennai').toLowerCase();
  if (!getEventCode(watch.movie, city)) resolveEventCodeBackground(watch.movie, city, watch.id);
});

async function resolveEventCodeBackground(movie, city, watchId) {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const { findAndCacheEventCode } = await import('./scrapers/bookmyshow.js');
      const eventCode = await findAndCacheEventCode(movie, city);
      if (eventCode) {
        await saveEventCode(movie, city, eventCode);
        const slug = movie.toLowerCase().replace(/^(the|a|an)\s+/i, '').replace(/[^a-z0-9]+/g, '-');
        await updateWatch(watchId, { bmsMovieUrl: `https://in.bookmyshow.com/${city}/movies/${slug}/${eventCode}` });
        console.log(`[event-code] ✓ ${movie} → ${eventCode}`);
        return;
      }
    } catch (err) { console.error(`[event-code] ${movie}:`, err.message); }
    if (attempt === 0) await new Promise((r) => setTimeout(r, 30000));
  }
}

app.patch('/api/watches/:id', async (req, res) => {
  const updated = await updateWatch(req.params.id, req.body);
  if (!updated) return res.status(404).json({ error: 'not found' });
  if ('enabled' in req.body || 'intervalSec' in req.body) restartWatch(updated.id);
  res.json(updated);
});

app.delete('/api/watches/:id', async (req, res) => {
  stopWatch(req.params.id);
  await deleteWatch(req.params.id);
  res.json({ ok: true });
});

app.post('/api/watches/:id/check', async (req, res) => {
  const watch = await getWatch(req.params.id);
  if (!watch) return res.status(404).json({ error: 'not found' });
  await runOne(watch.id);
  res.json(await getWatch(watch.id));
});

app.post('/api/watches/check-all', async (_req, res) => {
  const watches = await getWatches();
  await Promise.all(watches.filter((w) => w.enabled).map((w) => runOne(w.id)));
  res.json(await getWatches());
});

app.post('/api/telegram/test', async (_req, res) => res.json({ ok: await sendTestMessage() }));

app.get('/api/movie-url/:id', async (req, res) => {
  const watch = await getWatch(req.params.id);
  if (!watch) return res.status(404).json({ error: 'not found' });
  const city = (watch.city || 'chennai').toLowerCase();
  const movieSlug = watch.movie.toLowerCase().replace(/^(the|a|an)\s+/i, '').replace(/[^a-z0-9]+/g, '-');

  let eventCode = getEventCode(watch.movie, city);
  if (!eventCode && watch.bmsMovieUrl) { const m = watch.bmsMovieUrl.match(/\/(ET\d{8})/); if (m) { eventCode = m[1]; saveEventCode(watch.movie, city, eventCode); } }
  if (!eventCode) {
    for (const s of (watch.currentSessions || [])) {
      if (s.resolvedSeatUrl) { const m = s.resolvedSeatUrl.match(/\/(ET\d{8})/); if (m) { eventCode = m[1]; saveEventCode(watch.movie, city, eventCode); break; } }
    }
  }
  if (!eventCode) return res.json({ resolving: true });

  const sessions = watch.currentSessions || [];
  const languages = new Set(sessions.map((s) => (s.language || '').toLowerCase()).filter(Boolean));
  const isMultiLang = languages.size > 1;
  if (isMultiLang) return res.json({ moviePageUrl: `https://in.bookmyshow.com/${city}/movies/${movieSlug}/${eventCode}` });
  const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const dateToUse = watch.dateFrom ? watch.dateFrom.replace(/-/g, '') : today;
  return res.json({ moviePageUrl: `https://in.bookmyshow.com/movies/${city}/${movieSlug}/buytickets/${eventCode}/${dateToUse}` });
});

app.get('/api/go-url/:watchId/:sid', async (req, res) => {
  try {
    const watch = await getWatch(req.params.watchId);
    if (!watch) return res.status(404).json({ error: 'not found' });
    const session = (watch.currentSessions || []).find((s) => s.sid === req.params.sid);
    if (!session) return res.status(404).json({ error: 'session not found' });
    if (session.resolvedSeatUrl) return res.json({ url: session.resolvedSeatUrl });

    if (session.bmsCinemaSlug) {
      try {
        const url = await resolveBmsSeatUrl({ city: session.bmsCinemaCity, slug: session.bmsCinemaSlug, cinemaCode: session.bmsCinemaCode, date: session.date, time: session.time, movieHint: watch.movie });
        if (url) {
          const freshWatch = await getWatch(req.params.watchId);
          const freshSessions = freshWatch?.currentSessions || [];
          const idx = freshSessions.findIndex((s) => s.sid === session.sid);
          if (idx !== -1) {
            freshSessions[idx].resolvedSeatUrl = url;
            const patch = { currentSessions: freshSessions };
            const evM = url.match(/\/(ET\d{8})/);
            if (evM) {
              const movieSlug = freshWatch.movie.toLowerCase().replace(/^(the|a|an)\s+/i, '').replace(/[^a-z0-9]+/g, '-');
              patch.bmsMovieUrl = `https://in.bookmyshow.com/${(freshWatch.city || 'chennai').toLowerCase()}/movies/${movieSlug}/${evM[1]}`;
              saveEventCode(freshWatch.movie, freshWatch.city || 'chennai', evM[1]);
            }
            await updateWatch(freshWatch.id, patch);
          }
          return res.json({ url });
        }
      } catch (err) { console.error('[go-url]', err.message); }
      const dateCompact = (session.date || '').replace(/-/g, '');
      return res.json({ url: `https://in.bookmyshow.com/cinemas/${session.bmsCinemaCity}/${session.bmsCinemaSlug}/buytickets/${session.bmsCinemaCode}/${dateCompact}` });
    }
    res.json({ url: null });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

const PORT = Number(process.env.PORT) || 3000;
app.listen(PORT, async () => {
  console.log(`[server] http://localhost:${PORT}`);
  await startScheduler();
});

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, async () => { await shutdownBrowser(); process.exit(0); });
}
