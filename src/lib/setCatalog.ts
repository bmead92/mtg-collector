import { USER_AGENT } from './appInfo';
import { getSetting, setSetting } from './db';
import { slimSet, type ScrySet } from './setList';

const URL = 'https://api.scryfall.com/sets';
const KEY = 'scryfall.sets';
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

interface Cached {
  fetchedAt: number;
  sets: ScrySet[];
}

let memory: Cached | null = null;
let inflight: Promise<ScrySet[]> | null = null;

export function getSets(): Promise<ScrySet[]> {
  if (memory && Date.now() - memory.fetchedAt < MAX_AGE_MS) return Promise.resolve(memory.sets);
  inflight ??= load().finally(() => {
    inflight = null;
  });
  return inflight;
}

async function load(): Promise<ScrySet[]> {
  if (!memory) memory = await getSetting<Cached>(KEY).catch(() => null);
  if (memory && Date.now() - memory.fetchedAt < MAX_AGE_MS) return memory.sets;
  try {
    const res = await fetch(URL, { headers: { Accept: 'application/json', 'User-Agent': USER_AGENT } });
    if (!res.ok) throw new Error(`Scryfall sets: HTTP ${res.status}`);
    const body = (await res.json()) as { data?: Record<string, unknown>[] };
    const sets = (body.data ?? []).map(slimSet).filter((s): s is ScrySet => s != null);
    if (sets.length === 0) throw new Error('Scryfall sets: empty list');
    memory = { fetchedAt: Date.now(), sets };
    setSetting(KEY, memory).catch(() => {});
    return sets;
  } catch (e) {
    console.warn('[sets] fetch failed', e);
    return memory?.sets ?? [];
  }
}
