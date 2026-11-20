import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { rawDatabase, resetDatabases, stats } from './stubs/expo-sqlite';

const N = 10_000;

beforeEach(() => resetDatabases());
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

async function seed() {
  vi.resetModules();
  const db = await import('../src/lib/db');
  await db.listScans();
  const raw = rawDatabase()!;
  const ins = raw.prepare(
    `INSERT INTO scans (photo_uri, scryfall_id, name, set_code, set_name, collector_number, finish, condition, lang, price_id)
     VALUES ('', ?, ?, 'sim', 'Simulated', ?, ?, 'NM', ?, ?)`,
  );
  raw.exec('BEGIN');
  for (let i = 0; i < N; i++) {
    const foreign = i % 50 === 0; // every 50th card is Japanese, priced from its English printing
    ins.run(`id-${i}`, `Card ${i}`, String(i), i % 7 === 0 ? 'foil' : 'nonfoil', foreign ? 'ja' : 'en', foreign ? `en-${i}` : null);
  }
  raw.exec('COMMIT');
  return db;
}

describe('refresh all prices, 10k cards', () => {
  it('batches requests, prices foreign cards from their English printing, writes in one transaction', async () => {
    const db = await seed();
    const scans = await db.listScans();
    let manapool = 0;
    let scryfall = 0;
    const askedFor = new Set<string>();
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        if (url.includes('manapool.com')) {
          manapool++;
          const ids = new URL(url).searchParams.getAll('scryfall_ids');
          ids.forEach((id) => askedFor.add(id));
          const data = ids.map((id) => ({
            url: `https://manapool.test/${id}`, name: id, set_code: 'sim', number: '1', scryfall_id: id, scryfall_ids: [id],
            available_quantity: 1, price_cents_nm: 123, price_cents_nm_foil: 456, price_cents_nm_etched: null,
            price_market: 120, price_market_foil: 450, variants: [],
          }));
          return new Response(JSON.stringify({ data }));
        }
        scryfall++;
        const ids = (JSON.parse(String(init?.body)) as { identifiers: { id: string }[] }).identifiers.map((x) => x.id);
        return new Response(JSON.stringify({ data: ids.map((id) => ({ id, prices: { usd: '1.00', usd_foil: '2.00' } })) }));
      }),
    );
    vi.useFakeTimers({ toFake: ['setTimeout'] });
    const { refreshPrices } = await import('../src/lib/pricing');
    const before = stats.transactions;
    const t0 = performance.now();
    const run = refreshPrices(scans);
    await vi.runAllTimersAsync();
    await run;
    console.info(`[refresh] ${(performance.now() - t0).toFixed(0)} ms; Mana Pool ${manapool} requests, Scryfall ${scryfall} (≈${(scryfall * 0.1).toFixed(0)} s throttle on a phone)`);

    expect(manapool).toBe(N / 100);
    expect(scryfall).toBe(Math.ceil(N / 75));
    expect(stats.transactions - before).toBe(1);
    expect(askedFor.has('en-0')).toBe(true); // the English printing, not the Japanese one
    expect(askedFor.has('id-0')).toBe(false);

    const raw = rawDatabase()!;
    const priced = raw.prepare('SELECT COUNT(*) AS n FROM scans WHERE price_cents IN (120, 450) AND low_cents IN (123, 456) AND sf_prices IS NOT NULL').get() as { n: number };
    expect(Number(priced.n)).toBe(N);
    const foil = raw.prepare("SELECT price_cents FROM scans WHERE scryfall_id = 'id-7'").get() as { price_cents: number };
    expect(foil.price_cents).toBe(450);
  });
});

describe('headline price', () => {
  it('market for near mint, lowest listing for played cards, falls back to the other', async () => {
    const { headlinePrice } = await import('../src/lib/manapool');
    const q = (condition: 'NM' | 'LP', lowCents: number | null, marketCents: number | null) =>
      ({ condition, lowCents, marketCents, listingsAvailable: 0, recentSales: [], url: '' });
    expect(headlinePrice(q('NM', 100, 150))).toBe(150);
    expect(headlinePrice(q('NM', 100, null))).toBe(100);
    expect(headlinePrice(q('LP', 80, 150))).toBe(80);
    expect(headlinePrice(q('LP', null, 150))).toBe(150);
  });
});
