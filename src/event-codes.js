import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CODES_FILE = path.join(__dirname, '..', 'event-codes.json');

// Known event codes (never deleted, survives redeploys)
const KNOWN_CODES = {
  'chennai::obsession': 'ET00480914',
  'chennai::supergirl': 'ET00475569',
  'chennai::odyssey': 'ET00452034',
  'chennai::toy-story-5': 'ET00482787',
  'chennai::balan-the-boy': 'ET00501837',
  'chennai::disclosure-day': 'ET00480915',
  'coimbatore::odyssey': 'ET00480917',
};

let runtimeCodes = {};

async function loadCodes() {
  try {
    const raw = await fs.readFile(CODES_FILE, 'utf8');
    runtimeCodes = JSON.parse(raw || '{}');
  } catch {
    runtimeCodes = {};
  }
}
loadCodes();

async function saveCodes() {
  try {
    await fs.writeFile(CODES_FILE, JSON.stringify(runtimeCodes, null, 2));
  } catch {}
}

function keyFor(movie, city) {
  return `${city.toLowerCase()}::${movie.toLowerCase().replace(/^(the|a|an)\s+/i, '').replace(/[^a-z0-9]+/g, '-')}`;
}

export function getEventCode(movie, city) {
  const key = keyFor(movie, city);
  return runtimeCodes[key] || KNOWN_CODES[key] || null;
}

export async function saveEventCode(movie, city, eventCode) {
  runtimeCodes[keyFor(movie, city)] = eventCode;
  await saveCodes();
}
