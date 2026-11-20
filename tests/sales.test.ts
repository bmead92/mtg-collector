import './sim/mocks';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { buildBackup, parseBackup, planRestore } from '../src/lib/backup';
import { breakdown, dailyLine, priceMove, type GrowthAddition } from '../src/lib/growth';
import { formatOwned, soldBySource, soldGrowthAdds, soldTotals, summarizeSale, type Sale } from '../src/lib/sales';
import { summarizeSources } from '../src/lib/sources';
import { resetDatabases } from './stubs/expo-sqlite';
import { launchApp, type App } from './sim/harness';

beforeEach(() => {
  resetDatabases();
  vi.useRealTimers();
});

const DAY = 86_400_000;

const card = (id: string, price: number) => ({
  photo_uri: '',
  scryfall_id: id,
  name: `Card ${id}`,
  set_code: 'tst',
  set_name: 'Test Set',
  collector_number: id,
  image_uri: null,
  finish: 'nonfoil' as const,
  condition: 'NM' as const,
  price_cents: price,
  market_cents: price,
  manapool_url: null,
  price_updated_at: null,
  type_line: 'Creature',
  color_identity: 'G',
  rarity: 'rare',
  released_at: '2025-01-01',
  layout: 'normal',
});

async function at<T>(iso: string, fn: () => Promise<T>): Promise<T> {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(iso));
  try {
    return await fn();
  } finally {
    vi.useRealTimers();
  }
}

async function seed(app: App) {
  const src = await at('2026-01-05T12:00:00Z', () =>
    app.db.createSource({ kind: 'pack', name: 'TST pack', cost_cents: 500, packs: 1 }),
  );
  const a = await at('2026-01-05T12:00:00Z', () => app.db.insertScan({ ...card('a', 1000), quantity: 2 }, src));
  await at('2026-02-01T12:00:00Z', () => app.db.insertScan({ ...card('a', 1200), quantity: 1 }));
  const b = await at('2026-01-10T12:00:00Z', () => app.db.insertScan(card('b', 300)));
  return { src, a, b };
}

describe('selling', () => {
  it('sells the oldest copies first and keeps the rest', async () => {
    const app = await launchApp();
    const { a, src } = await seed(app);
    const result = await at('2026-03-01T12:00:00Z', () => app.db.sellScan(a, 2, 2500));
    expect(result).toBe('sold-some');
    expect((await app.db.getScan(a))?.quantity).toBe(1);
    const [sale] = await app.db.listSales();
    expect(sale).toMatchObject({ quantity: 2, sold_cents: 2500, sold_at: '2026-03-01T12:00:00.000Z' });
    expect(sale.from).toEqual([{ source_id: src, quantity: 2, price_cents: 1000, added_at: '2026-01-05T12:00:00.000Z' }]);
    const left = (await app.db.listAdditions()).filter((x) => x.scan_id === a);
    expect(left).toEqual([expect.objectContaining({ quantity: 1, added_at: '2026-02-01T12:00:00.000Z', source_id: null })]);
  });

  it('selling every copy removes the card; undo brings it back with its history', async () => {
    const app = await launchApp();
    const { b } = await seed(app);
    expect(await at('2026-03-01T12:00:00Z', () => app.db.sellScan(b, 5, 400))).toBe('sold-all');
    expect(await app.db.getScan(b)).toBeNull();
    const [sale] = await app.db.listSales();
    expect(sale.quantity).toBe(1);

    await app.db.undoSale(sale.id);
    expect(await app.db.listSales()).toEqual([]);
    const back = (await app.db.listScans()).find((s) => s.scryfall_id === 'b')!;
    expect(back).toMatchObject({ quantity: 1, price_cents: 300 });
    expect((await app.db.listAdditions()).filter((x) => x.scan_id === back.id)).toEqual([
      expect.objectContaining({ quantity: 1, added_at: '2026-01-10T12:00:00.000Z' }),
    ]);
  });

  it('undo adds to a copy still in the collection', async () => {
    const app = await launchApp();
    const { a } = await seed(app);
    await app.db.sellScan(a, 1, 900);
    const [sale] = await app.db.listSales();
    await app.db.undoSale(sale.id);
    expect((await app.db.getScan(a))?.quantity).toBe(3);
  });
});

describe('deleting is "never owned"', () => {
  it('takes the card out of past daily values', async () => {
    const app = await launchApp();
    const { b } = await seed(app);
    await app.db.recordSnapshot('2026-01-08', 2000, 2000, 2);
    await app.db.recordSnapshot('2026-01-12', 2300, 2300, 3);
    await app.db.recordSnapshot('2026-02-02', 3500, 3500, 4);
    await app.db.deleteScan(b);
    expect(await app.db.listSnapshots()).toEqual([
      { day: '2026-01-08', value_cents: 2000, tcg_cents: 2000, copies: 2 },
      { day: '2026-01-12', value_cents: 2000, tcg_cents: 2300, copies: 2 },
      { day: '2026-02-02', value_cents: 3200, tcg_cents: 3500, copies: 3 },
    ]);
  });

  it('fewer copies takes the newest ones out of history', async () => {
    const app = await launchApp();
    const { a } = await seed(app);
    await app.db.recordSnapshot('2026-01-20', 2000, null, 2);
    await app.db.recordSnapshot('2026-02-02', 3200, null, 3);
    await app.db.setQuantity(a, 2);
    const snaps = await app.db.listSnapshots();
    expect(snaps.map((s) => [s.day, s.value_cents, s.copies])).toEqual([
      ['2026-01-20', 2000, 2],
      ['2026-02-02', 2000, 2],
    ]);
  });

  it('selling leaves past values alone', async () => {
    const app = await launchApp();
    const { b } = await seed(app);
    await app.db.recordSnapshot('2026-01-12', 2300, null, 3);
    await app.db.sellScan(b, 1, 400);
    expect((await app.db.listSnapshots())[0]).toMatchObject({ value_cents: 2300, copies: 3 });
  });
});

describe('backup', () => {
  it('round-trips sales, linked to their pack', async () => {
    let app = await launchApp();
    const { a } = await seed(app);
    await app.db.sellScan(a, 2, 2500);
    const text = JSON.stringify(
      buildBackup(await app.db.listScans(), null, '1', new Date(), {
        sources: await app.db.listSources(),
        additions: await app.db.listAdditions(),
        sales: await app.db.listSales(),
      }),
    );
    resetDatabases();
    app = await launchApp();
    const b = parseBackup(text).backup;
    await app.db.applyRestore(planRestore([], b.cards, 'replace', b.sources, b.snapshots, b.sales));
    const [src] = await app.db.listSources();
    const [sale] = await app.db.listSales();
    expect(sale).toMatchObject({ quantity: 2, sold_cents: 2500 });
    expect(sale.card.name).toBe('Card a');
    expect(sale.from[0].source_id).toBe(src.id);

    await app.db.applyRestore(planRestore(await app.db.listScans(), b.cards, 'merge', b.sources, [], b.sales));
    expect(await app.db.listSales()).toHaveLength(1);
  });
});

const sale = (over: Partial<Sale> = {}): Sale => ({
  id: 1,
  sold_at: '2026-03-01T00:00:00Z',
  quantity: 2,
  sold_cents: 3000,
  card: { ...card('x', 1400), created_at: '2026-01-01', sf_prices: null, price_id: null, lang: 'en', low_cents: null },
  from: [
    { source_id: 7, quantity: 1, price_cents: 1000, added_at: '2026-01-01T00:00:00Z' },
    { source_id: null, quantity: 1, price_cents: 1200, added_at: '2026-02-01T00:00:00Z' },
  ],
  ...over,
});

describe('sale summaries', () => {
  it('gain against value when added, and time owned', () => {
    const s = summarizeSale(sale());
    expect(s).toMatchObject({ addedCents: 2200, gainCents: 800 });
    expect(Math.round(s.ownedMs / DAY)).toBe(59);
    expect(formatOwned(s.ownedMs)).toBe('59 days');
    expect(formatOwned(400 * DAY)).toBe('13 months');
    expect(formatOwned(900 * DAY)).toBe('2.5 years');
    expect(summarizeSale(sale({ from: [{ source_id: null, quantity: 2, price_cents: null, added_at: '2026-01-01' }] })).gainCents).toBeNull();
  });

  it('totals and per-pack share', () => {
    expect(soldTotals([sale(), sale({ id: 2, sold_cents: 1000 })])).toEqual({
      copies: 4,
      soldCents: 4000,
      addedCents: 4400,
      gainCents: -400,
    });
    expect(soldBySource([sale()]).get(7)).toEqual({ cards: 1, soldCents: 1500 });
    const [s] = summarizeSources(
      [{ id: 7, kind: 'pack', name: 'p', cost_cents: 2000, packs: 1, packs_opened: 1, set_code: null, product_id: null, finished: 0, created_at: '' }],
      [{ source_id: 7, copies: 3, priceCents: 200 }],
      soldBySource([sale()]),
    );
    expect(s).toMatchObject({ valueCents: 600, soldCards: 1, soldCents: 1500, gainCents: 100 });
  });
});

describe('growth with sold copies', () => {
  const now = new Date(2026, 2, 10, 12).getTime();
  const held: GrowthAddition = { added_at: new Date(2026, 2, 1, 9).toISOString(), quantity: 1, source_id: null, unitCents: 500 };
  const sold = soldGrowthAdds([sale({ sold_at: new Date(2026, 2, 5, 9).toISOString(), from: [{ source_id: 7, quantity: 2, price_cents: 1000, added_at: new Date(2026, 2, 3, 9).toISOString() }] })], () => 1400);

  it('count until the day they were sold', () => {
    const line = dailyLine([held, ...sold], [], now);
    const v = Object.fromEntries(line.map((p) => [p.day, [p.valueCents, p.copies]]));
    expect(v['2026-03-02']).toEqual([500, 1]);
    expect(v['2026-03-04']).toEqual([3300, 3]);
    expect(v['2026-03-05']).toEqual([500, 1]);
    expect(v['2026-03-10']).toEqual([500, 1]);
  });

  it('are not in today\'s breakdown, and a sale is not a price drop', () => {
    expect(breakdown([held, ...sold])).toEqual({ owned: { copies: 1, valueCents: 500 }, opened: { copies: 0, valueCents: 0 } });
    const snaps = [{ day: '2026-03-04', value_cents: 3300, copies: 3 }];
    expect(priceMove(snaps, 500, [held, ...sold], now)).toEqual({ since: '2026-03-04', cents: 0 });
  });
});

describe('undo after forgetting the pack', () => {
  it('copies come back as already owned', async () => {
    const app = await launchApp();
    const { a, src } = await seed(app);
    await app.db.sellScan(a, 2, 2500);
    await app.db.deleteSource(src);
    const [sale] = await app.db.listSales();
    await app.db.undoSale(sale.id);
    const adds = (await app.db.listAdditions()).filter((x) => x.scan_id === a);
    expect(adds.every((x) => x.source_id === null)).toBe(true);
    expect(adds.reduce((n, x) => n + x.quantity, 0)).toBe(3);
  });
});
