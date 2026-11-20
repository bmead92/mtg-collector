import { USER_AGENT } from './appInfo';
import { getSetting, setSetting } from './db';
import { slimProduct, type SealedProduct } from './sealed';

const URL = 'https://manapool.com/api/v1/prices/sealed';
const KEY = 'sealed.catalog';
const MAX_AGE_MS = 24 * 60 * 60 * 1000;

interface Cached {
  fetchedAt: number;
  products: SealedProduct[];
}

let memory: Cached | null = null;
let inflight: Promise<SealedProduct[]> | null = null;

export function getSealedCatalog(): Promise<SealedProduct[]> {
  if (memory && Date.now() - memory.fetchedAt < MAX_AGE_MS) return Promise.resolve(memory.products);
  inflight ??= load().finally(() => {
    inflight = null;
  });
  return inflight;
}

async function load(): Promise<SealedProduct[]> {
  if (!memory) memory = await getSetting<Cached>(KEY).catch(() => null);
  if (memory && Date.now() - memory.fetchedAt < MAX_AGE_MS) return memory.products;
  try {
    const res = await fetch(URL, { headers: { Accept: 'application/json', 'User-Agent': USER_AGENT } });
    if (!res.ok) throw new Error(`Mana Pool sealed prices: HTTP ${res.status}`);
    const body = (await res.json()) as { data?: Record<string, unknown>[] };
    const products = (body.data ?? []).map(slimProduct).filter((p): p is SealedProduct => p != null);
    if (products.length === 0) throw new Error('Mana Pool sealed prices: empty list');
    memory = { fetchedAt: Date.now(), products };
    setSetting(KEY, memory).catch(() => {});
    return products;
  } catch (e) {
    console.warn('[sealed] catalog fetch failed', e);
    return memory?.products ?? [];
  }
}
