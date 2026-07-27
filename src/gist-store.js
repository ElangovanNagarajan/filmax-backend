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
    console.error(`[gist] read ${name} failed:`, err.message);
    return fallback;
  }
}

async function writeFiles(files) {
  if (!GIST_ID || !TOKEN) throw new Error('GIST_ID / GH_GIST_TOKEN not set');
  const payload = { files: {} };
  for (const [name, obj] of Object.entries(files)) {
    payload.files[name] = { content: JSON.stringify(obj, null, 2) };
  }
  await axios.patch(`${API}/gists/${GIST_ID}`, payload, { headers: headers(), timeout: 20000 });
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
