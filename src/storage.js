import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_FILE = path.join(__dirname, '..', 'data.json');

const defaultState = { watches: [] };

async function load() {
  try {
    const raw = await fs.readFile(DATA_FILE, 'utf8');
    if (!raw.trim()) return structuredClone(defaultState);
    return JSON.parse(raw);
  } catch (err) {
    if (err.code === 'ENOENT') return structuredClone(defaultState);
    if (err instanceof SyntaxError) {
      console.warn('[storage] data.json is corrupt, resetting to empty state');
      return structuredClone(defaultState);
    }
    throw err;
  }
}

async function save(state) {
  await fs.writeFile(DATA_FILE, JSON.stringify(state, null, 2));
}

export async function getWatches() {
  const state = await load();
  return state.watches;
}

export async function getWatch(id) {
  const state = await load();
  return state.watches.find((w) => w.id === id);
}

export async function addWatch(watch) {
  const state = await load();
  const id = String(Date.now());
  const newWatch = {
    id,
    movie: watch.movie,
    city: watch.city || 'Chennai',
    theaters: watch.theaters || [],
    intervalSec: Math.max(5, Number(watch.intervalSec) || 60),
    sites: watch.sites || ['bms', 'district'],
    dateFrom: watch.dateFrom || null,
    dateTo: watch.dateTo || null,
    enabled: watch.enabled !== false,
    lastChecked: null,
    lastStatus: 'pending',
    lastSeen: null,
    notifiedAt: null,
    seenSids: [],
    currentSessions: [],
    createdAt: new Date().toISOString(),
  };
  state.watches.push(newWatch);
  await save(state);
  return newWatch;
}

export async function updateWatch(id, patch) {
  const state = await load();
  const idx = state.watches.findIndex((w) => w.id === id);
  if (idx === -1) return null;
  state.watches[idx] = { ...state.watches[idx], ...patch };
  await save(state);
  return state.watches[idx];
}

export async function deleteWatch(id) {
  const state = await load();
  state.watches = state.watches.filter((w) => w.id !== id);
  await save(state);
}
