import 'dotenv/config';
import { checkWatch } from './check-core.js';
import { getWatches, getState, saveState, getControl } from './gist-store.js';
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

async function tickAll() {
  const control = await getControl();
  if (control.master === false) { console.log('[runner] master OFF — skipping'); return; }
  const watches = await getWatches();
  const state = await getState();
  const active = watches.filter((w) => w.enabled !== false);
  if (!active.length) { console.log('[runner] no active watches'); return; }

  for (const watch of active) {
    // Carry forward persisted seen-set so alerts don't re-fire across runs.
    const prior = state[watch.id] || {};
    const merged = { ...watch, seenSids: prior.seenSids || watch.seenSids || [] };
    try {
      const { patch, alert } = await checkWatch(merged);
      mergeState(state, watch.id, patch);
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

async function main() {
  console.log(`[runner] starting — will loop for ~${RUN_MINUTES}m, every ${INTERVAL_SEC}s`);
  let pass = 0;
  while (Date.now() < DEADLINE) {
    const started = Date.now();
    pass++;
    console.log(`[runner] pass #${pass} @ ${new Date().toISOString()}`);
    await tickAll();
    const elapsed = Date.now() - started;
    const wait = Math.max(0, INTERVAL_SEC * 1000 - elapsed);
    if (Date.now() + wait >= DEADLINE) break;
    await new Promise((r) => setTimeout(r, wait));
  }
  await shutdownBrowser();
  console.log('[runner] shift complete — exiting so the workflow can relaunch');
}

main().then(() => process.exit(0)).catch(async (err) => {
  console.error('[runner] fatal:', err);
  await shutdownBrowser().catch(() => {});
  process.exit(1);
});
