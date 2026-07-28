import 'dotenv/config';
import { checkWatch } from './check-core.js';
import { getWatches, getState, saveState, getControl, saveControl } from './gist-store.js';
import { sendAlert } from './telegram.js';
import { shutdownBrowser } from './browser.js';

// Self-looping worker for GitHub Actions.
// Runs for ~RUN_MINUTES then exits cleanly; the workflow re-launches it,
// giving effectively 24/7 coverage without a long-lived server.

const RUN_MINUTES = Number(process.env.RUN_MINUTES) || 330; // ~5.5h, under the 6h job cap
const INTERVAL_SEC = Number(process.env.INTERVAL_SEC) || 60; // keep >=60s to stay a light workload
const DEADLINE = Date.now() + RUN_MINUTES * 60 * 1000;

function mergeState(state, watchId, patch) {
  state[watchId] = { ...(state[watchId] || {}), ...patch };
  return state;
}

// Run a check pass. When `onlyIds` is given (a manual "check" / "check all"
// request from the app), we check just those watches and ignore the master
// OFF switch + enabled flag, since the user explicitly asked for it.
async function tickAll(onlyIds = null) {
  const manual = Array.isArray(onlyIds) && onlyIds.length && !onlyIds.includes('all');
  const checkAll = Array.isArray(onlyIds) && onlyIds.includes('all');
  if (!onlyIds) {
    const control = await getControl();
    if (control.master === false) { console.log('[runner] master OFF — skipping'); return; }
  }
  const watches = await getWatches();
  const state = await getState();
  let active = watches.filter((w) => w.enabled !== false);
  if (manual) active = watches.filter((w) => onlyIds.includes(w.id));
  else if (checkAll) active = watches; // check every watch regardless of pause
  if (!active.length) { console.log('[runner] no watches to check'); return; }

  for (const watch of active) {
    // Carry forward persisted seen-set so alerts don't re-fire across runs.
    const prior = state[watch.id] || {};
    const merged = { ...watch, seenSids: prior.seenSids || watch.seenSids || [] };
    try {
      const { patch, alert } = await checkWatch(merged);
      mergeState(state, watch.id, patch);
      // Publish THIS watch's result immediately rather than waiting for every
      // other watch in the pass to finish. Previously state was saved once at
      // the end, so the Telegram alert (sent below) beat the app to the data
      // and the home screen looked stale for the rest of the pass.
      await saveState(state);
      if (alert) {
        const ok = await sendAlert({ movie: watch.movie, theater: watch.theaters.join(', '), url: alert.url, body: alert.body });
        console.log(`[runner] ${ok ? 'ALERT SENT' : 'alert FAILED'} "${watch.movie}" — ${alert.count} new show(s)`);
      } else {
        console.log(`[runner] "${watch.movie}": ${patch.lastStatus}`);
      }
    } catch (err) {
      console.error(`[runner] check error "${watch.movie}":`, err.message);
    }
  }
  await saveState(state);
}

// Track the last manual-check request we've already served, so we run each
// checkNow exactly once. Compares the request timestamp written by the app.
let lastServedCheckTs = 0;

// If the app has posted a fresh checkNow request, run it immediately and clear
// it from control.json. Returns true if a manual check ran.
async function serveManualCheck() {
  const control = await getControl();
  const req = control.checkNow;
  if (!req || !req.ts || req.ts <= lastServedCheckTs) return false;
  lastServedCheckTs = req.ts;
  const ids = Array.isArray(req.ids) && req.ids.length ? req.ids : ['all'];
  console.log(`[runner] manual check requested: ${ids.join(', ')}`);
  await tickAll(ids);
  // Clear the request (read-modify-write so we don't clobber master).
  const fresh = await getControl();
  if (fresh.checkNow && fresh.checkNow.ts === req.ts) {
    const { checkNow, ...rest } = fresh;
    await saveControl(rest);
  }
  return true;
}

async function main() {
  console.log(`[runner] starting — will loop for ~${RUN_MINUTES}m, every ${INTERVAL_SEC}s`);
  // Don't re-serve a checkNow left over from before this shift started.
  try { lastServedCheckTs = (await getControl()).checkNow?.ts || 0; } catch { /* ignore */ }
  let pass = 0;
  while (Date.now() < DEADLINE) {
    const started = Date.now();
    pass++;
    console.log(`[runner] pass #${pass} @ ${new Date().toISOString()}`);
    await tickAll();
    // Wait out the interval, but poll for manual-check requests every ~5s so
    // the app's "check now" / "check all" buttons feel responsive.
    const elapsed = Date.now() - started;
    let wait = Math.max(0, INTERVAL_SEC * 1000 - elapsed);
    if (Date.now() + wait >= DEADLINE) break;
    while (wait > 0) {
      const step = Math.min(5000, wait);
      await new Promise((r) => setTimeout(r, step));
      wait -= step;
      try { await serveManualCheck(); } catch (e) { console.error('[runner] manual check error:', e.message); }
    }
  }
  await shutdownBrowser();
  console.log('[runner] shift complete — exiting so the workflow can relaunch');
}

main().then(() => process.exit(0)).catch(async (err) => {
  console.error('[runner] fatal:', err);
  await shutdownBrowser().catch(() => {});
  process.exit(1);
});
