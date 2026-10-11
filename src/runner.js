import 'dotenv/config';
import { checkWatch } from './check-core.js';
import { getWatches, getState, saveState, getControl, saveControl } from './gist-store.js';
import { sendAlert, sendTestMessage } from './telegram.js';
import { shutdownBrowser } from './browser.js';

// Self-looping worker for GitHub Actions.
// Runs for ~RUN_MINUTES then exits cleanly; the workflow re-launches it,
// giving effectively 24/7 coverage without a long-lived server.

const RUN_MINUTES = Number(process.env.RUN_MINUTES) || 330; // ~5.5h, under the 6h job cap
const INTERVAL_SEC = Number(process.env.INTERVAL_SEC) || 60; // keep >=60s to stay a light workload
const DEADLINE = Date.now() + RUN_MINUTES * 60 * 1000;
// How often to refresh lastChecked when nothing has actually changed. Gist
// writes are capped at 100/hour (see gist-store.js), and the app's own buttons
// need room in that budget, so a no-change pass doesn't get to write every time.
const HEARTBEAT_MIN = Number(process.env.HEARTBEAT_MIN) || 3;
let lastHeartbeat = 0;

function mergeState(state, watchId, patch) {
  state[watchId] = { ...(state[watchId] || {}), ...patch };
  return state;
}

// `_heartbeat` is a top-level marker, not a watch id — nothing iterates
// state.json's keys, the app only looks up state[watch.id], so it rides along
// harmlessly. It exists because "no shows yet" and "nobody is checking any
// more" looked identical for the two weeks the runner was off in Sept 2026.
// Anything reading the gist can now tell the difference.
const HEARTBEAT_KEY = '_heartbeat';

function publish(state) {
  state[HEARTBEAT_KEY] = {
    at: new Date().toISOString(),
    shiftEndsAt: new Date(DEADLINE).toISOString(),
    intervalSec: INTERVAL_SEC,
  };
  return saveState(state);
}

// Did this check produce news, or just a fresh timestamp on the same answer?
// Only news justifies an immediate write — see the gist_update budget note in
// gist-store.js. Everything else rides along on the end-of-pass save.
function isNews(prior, patch) {
  if (!prior || !prior.lastChecked) return true;              // first result ever
  if (prior.lastStatus !== patch.lastStatus) return true;     // sold out -> open, etc.
  const before = (prior.currentSessions || []).map((s) => `${s.sid}|${s.soldOut}`).sort().join(',');
  const after = (patch.currentSessions || []).map((s) => `${s.sid}|${s.soldOut}`).sort().join(',');
  return before !== after;                                    // shows appeared/vanished/changed
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

  let anyNews = false;
  for (const watch of active) {
    // Carry forward persisted seen-set so alerts don't re-fire across runs.
    const prior = state[watch.id] || {};
    const merged = { ...watch, seenSids: prior.seenSids || watch.seenSids || [] };
    try {
      const { patch, alert } = await checkWatch(merged);
      const news = manual || checkAll || isNews(prior, patch);
      mergeState(state, watch.id, patch);
      // Publish THIS watch's result immediately when there's actually something
      // to see, so the app isn't left stale while the rest of the pass runs.
      // When the answer hasn't changed, let it wait for the end-of-pass save:
      // gist writes are capped at 100/hour, and a pass every 60s across several
      // watches would otherwise burn the whole budget re-stating "sold out",
      // leaving none for the app's own Check / Add buttons.
      // A manual check always writes — the app is watching lastChecked move.
      if (news) { await publish(state); anyNews = true; }
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

  // Nothing newsworthy this pass, so the only difference is a fresher
  // lastChecked. That's worth publishing — the app shows "Last check: Xs ago" —
  // but not once a minute: 60 writes/hour out of 100 would leave too few for
  // the app's own buttons. Heartbeat at most every HEARTBEAT_MIN minutes.
  const now = Date.now();
  if (anyNews || manual || checkAll) { await publish(state); lastHeartbeat = now; }
  else if (now - lastHeartbeat >= HEARTBEAT_MIN * 60 * 1000) {
    await publish(state);
    lastHeartbeat = now;
  } else {
    console.log('[runner] no change — skipping write to preserve the gist write budget');
  }
}

// Track the last manual-check request we've already served, so we run each
// checkNow exactly once. Compares the request timestamp written by the app.
let lastServedCheckTs = 0;
// Same idea for the Settings "Telegram" test button: the app can't hold the
// bot token (it would have to ship in the public APK), so it drops a
// testTelegram request in control.json and the runner — which does hold the
// token as a GitHub secret — sends the message on its behalf.
let lastServedTestTs = 0;

// If the app has posted a fresh testTelegram request, send the test message
// and clear it. Returns true if one was served.
async function serveTelegramTest() {
  const control = await getControl();
  const req = control.testTelegram;
  if (!req || !req.ts || req.ts <= lastServedTestTs) return false;
  lastServedTestTs = req.ts;
  console.log('[runner] Telegram test requested');
  try {
    const ok = await sendTestMessage();
    console.log(`[runner] Telegram test ${ok ? 'sent' : 'skipped (token/chat not set)'}`);
  } catch (e) {
    console.error('[runner] Telegram test failed:', e.message);
  }
  // Clear the request (read-modify-write so we don't clobber master/checkNow).
  const fresh = await getControl();
  if (fresh.testTelegram && fresh.testTelegram.ts === req.ts) {
    const { testTelegram, ...rest } = fresh;
    await saveControl(rest);
  }
  return true;
}

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
  // Don't re-serve a checkNow / testTelegram left over from before this shift.
  try {
    const c = await getControl();
    lastServedCheckTs = c.checkNow?.ts || 0;
    lastServedTestTs = c.testTelegram?.ts || 0;
  } catch { /* ignore */ }

  // Report any gap since the last shift. Shifts hand over continuously, so a
  // gap wider than one shift plus slack means coverage was lost — and a missed
  // booking window is the whole reason this project exists, so say so out loud
  // instead of resuming as if nothing happened.
  try {
    const prev = (await getState())[HEARTBEAT_KEY];
    if (prev?.at) {
      const gapMin = Math.round((Date.now() - new Date(prev.at).getTime()) / 60000);
      if (gapMin > RUN_MINUTES + 30) {
        const since = new Date(prev.at).toISOString();
        console.warn(`[runner] COVERAGE GAP — nothing checked for ${gapMin}m (since ${since})`);
        await sendAlert({
          body: `⚠️ 70 mm Filmax was not checking for ${
            gapMin >= 120 ? `${Math.round(gapMin / 60)}h` : `${gapMin}m`
          } (since ${since}). Watching again now — re-check anything time-sensitive.`,
        }).catch(() => {});
      }
    }
  } catch { /* a gap report is never worth failing the shift over */ }

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
      try { await serveTelegramTest(); } catch (e) { console.error('[runner] telegram test error:', e.message); }
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
