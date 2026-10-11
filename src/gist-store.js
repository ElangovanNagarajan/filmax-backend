import axios from 'axios';

// Shared "mailbox" backed by a single GitHub Gist.
//   watches.json  — written by the phone app, read by the runner
//   state.json    — written by the runner (shows/status), read by the phone app
// Auth via a fine-grained PAT with gist scope (GH_GIST_TOKEN).

const GIST_ID = process.env.GIST_ID;
const TOKEN = process.env.GH_GIST_TOKEN;
const API = 'https://api.github.com';

function headers() {
  return {
    Authorization: `Bearer ${TOKEN}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'ticket-sniper',
  };
}

// Every gist read swallows its error and returns a fallback, which is right for
// a blip but was the last silent way to die: GH_GIST_TOKEN is a fine-grained
// PAT, so GitHub forces it to expire. On expiry the runner would start fine,
// fail every read, see `{}` instead of state, and sit there checking nothing —
// and the coverage-gap alert could not fire either, because spotting a gap
// means reading the heartbeat it just failed to read. So credential and access
// failures are recorded here and reported by the runner over Telegram, which
// uses a different token and keeps working.
let accessFailure = null;

function noteFailure(name, err) {
  const status = err.response?.status;
  if (status === 401 || status === 403 || status === 404) {
    accessFailure = { status, file: name, at: new Date().toISOString(), message: err.message };
  }
}

// Read-and-clear, so the runner reports a given failure once rather than every pass.
export function takeAccessFailure() {
  const f = accessFailure;
  accessFailure = null;
  return f;
}

async function readFile(name, fallback) {
  if (!GIST_ID || !TOKEN) return fallback;
  try {
    const { data } = await axios.get(`${API}/gists/${GIST_ID}`, { headers: headers(), timeout: 15000 });
    const file = data.files?.[name];
    if (!file) return fallback;
    // Large gists are truncated — refetch raw if so.
    let content = file.content;
    if (file.truncated && file.raw_url) {
      const raw = await axios.get(file.raw_url, { timeout: 15000 });
      content = typeof raw.data === 'string' ? raw.data : JSON.stringify(raw.data);
    }
    return JSON.parse(content || 'null') ?? fallback;
  } catch (err) {
    noteFailure(name, err);
    console.error(`[gist] read ${name} failed:`, err.message);
    return fallback;
  }
}

// Gist writes have their own hourly ceiling, separate from the 5,000/hour core
// quota: `gist_update` allows only 100. Nothing tells you this up front — you
// find out when a PATCH returns 403 with x-ratelimit-resource: gist_update
// while /rate_limit still cheerfully reports ~4,950 core requests left.
//
// So a write that would be a no-op is not free, it's 1% of the hour's budget.
// Skipping unchanged content is what keeps the app's own buttons working.
let lastWritten = new Map();

async function writeFiles(files) {
  if (!GIST_ID || !TOKEN) throw new Error('GIST_ID / GH_GIST_TOKEN not set');
  const payload = { files: {} };
  let changed = false;
  for (const [name, obj] of Object.entries(files)) {
    const content = JSON.stringify(obj, null, 2);
    if (lastWritten.get(name) === content) continue;   // identical — don't spend a write
    payload.files[name] = { content };
    changed = true;
  }
  if (!changed) return;
  try {
    await axios.patch(`${API}/gists/${GIST_ID}`, payload, { headers: headers(), timeout: 20000 });
  } catch (err) {
    // Record, then rethrow — callers still treat a failed write as fatal.
    noteFailure(Object.keys(payload.files).join('+'), err);
    throw err;
  }
  for (const [name, file] of Object.entries(payload.files)) lastWritten.set(name, file.content);
}

export async function getWatches() {
  return await readFile('watches.json', []);
}
export async function saveWatches(watches) {
  await writeFiles({ 'watches.json': watches });
}
export async function getState() {
  return await readFile('state.json', {});
}
export async function saveState(state) {
  await writeFiles({ 'state.json': state });
}
export async function getControl() {
  return await readFile('control.json', { master: true });
}
export async function saveControl(control) {
  await writeFiles({ 'control.json': control });
}
export function gistConfigured() {
  return Boolean(GIST_ID && TOKEN);
}
