import './sim/mocks';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { applyFilters } from '../src/lib/filter';
import { dailyLine, growthSeries, type GrowthAddition } from '../src/lib/growth';
import { summarizeSources } from '../src/lib/sources';
import { rawDatabase, resetDatabases } from './stubs/expo-sqlite';
import { SIM } from './sim/fixture';
import { launchApp, scanPulls, settle } from './sim/harness';
import { openBox } from './sim/packs';
import { seeded } from './sim/rng';

const N = 10_000;
const DAY = 86_400_000;

beforeEach(() => resetDatabases());
afterEach(() => vi.unstubAllGlobals());

const time = async <T,>(label: string, fn: () => Promise<T> | T): Promise<{ ms: number; value: T }> => {
  const t0 = performance.now();
  const value = await fn();
  const ms = performance.now() - t0;
  console.info(`[scale] ${label}: ${ms.toFixed(0)} ms`);
  return { ms, value };
};

async function seedCollection() {
  const app = await launchApp();
  await app.db.listScans(); // create tables
  const db = rawDatabase()!;
  const now = Date.now();
  const ins = db.prepare(
    `INSERT INTO scans (photo_uri, scryfall_id, name, set_code, set_name, collector_number, image_uri, finish, condition,
                        price_cents, type_line, color_identity, rarity, quantity, created_at, lang)
     VALUES ('', ?, ?, 'sim', 'Simulated', ?, NULL, ?, 'NM', ?, ?, ?, ?, ?, ?, 'en')`,
  );
  db.exec('BEGIN');
  for (let i = 0; i < N; i++) {
    const card = SIM.cards[i % SIM.cards.length];
    ins.run(
      `seed-${i}`,
      `${card.name} ${i}`,
      String(i),
      i % 7 === 0 ? 'foil' : 'nonfoil',
      (i * 37) % 5000,
      i % 3 === 0 ? 'Creature — Simulant' : 'Instant',
      ['W', 'U', 'B', 'R', 'G', 'WU', ''][i % 7],
      card.rarity,
      1 + (i % 4 === 0 ? 2 : 0),
      new Date(now - (i / N) * 730 * DAY).toISOString(),
    );
  }
  db.exec('COMMIT');
  return app;
}

describe('a 10,000-card collection', () => {
  it('opens, migrates the additions log, lists, filters, and charts quickly', async () => {
    let app = await seedCollection();
    rawDatabase()!.exec('DELETE FROM additions'); // as if upgrading from a version without the log
    app = await launchApp();
    const open = await time('first open (log 10k cards as already owned)', () => app.db.listScans());
    expect(open.value).toHaveLength(N);
    expect(open.ms).toBeLessThan(3000);

    const list = await time('listScans', () => app.db.listScans());
    expect(list.ms).toBeLessThan(500);

    const scans = list.value;
    const f1 = await time('filter: search + price + sort', () =>
      applyFilters(scans, { query: 'ember', colors: ['W'], types: [], minPriceCents: 100 }, 'price-desc'),
    );
    expect(f1.value.items.length).toBeGreaterThan(0);
    expect(f1.ms).toBeLessThan(200);
    const f2 = await time('filter: everything, sorted by name', () =>
      applyFilters(scans, { query: '', colors: [], types: [], minPriceCents: null }, 'name'),
    );
    expect(f2.value.items).toHaveLength(N);
    expect(f2.ms).toBeLessThan(300);

    const adds = await time('additions with prices', () => app.db.listAdditionsWithCard());
    const g: GrowthAddition[] = adds.value.map((r) => ({ added_at: r.added_at, quantity: r.quantity, source_id: r.source_id, unitCents: r.price_cents }));
    const line = await time('daily line over 2 years', () => dailyLine(g, [], Date.now()));
    expect(line.value.length).toBeGreaterThan(700);
    expect(line.ms).toBeLessThan(300);
    expect(growthSeries(g, Date.now()).length).toBeGreaterThan(20); // monthly bars
  });

  it('editing quantities stays fast (repairs only what changed)', async () => {
    const app = await seedCollection();
    const [first] = await app.db.listScans();
    const r = await time('setQuantity on a 10k collection', () => app.db.setQuantity(first.id, first.quantity + 1));
    expect(r.ms).toBeLessThan(500);
  });
});

describe('a huge unsaved Stack', () => {
  it('a 20-pack session (280 cards) persists and restores', async () => {
    const rng = seeded(500);
    let app = await launchApp();
    const pulls = openBox(SIM, rng, 'play', 20).flat();
    scanPulls(app, pulls, rng);
    await settle(app);
    const flush = await time('flush 280-card Stack', () => app.stack.flushStack());
    expect(flush.ms).toBeLessThan(1000);
    app = await launchApp();
    expect(app.stack.getStackItems()).toHaveLength(280);
  });

  it('summaries over hundreds of opened products stay instant', async () => {
    const sources = Array.from({ length: 300 }, (_, i) => ({
      id: i + 1, kind: i % 3 ? 'pack' : 'box', name: `P${i}`, cost_cents: 500, packs: 1, packs_opened: 1, set_code: null,
      product_id: null, finished: 0, created_at: new Date(2026, 0, 1 + i).toISOString(),
    })) as Parameters<typeof summarizeSources>[0];
    const cards = Array.from({ length: 20_000 }, (_, i) => ({ source_id: (i % 300) + 1, copies: 1, priceCents: i % 900 }));
    const r = await time('summarize 300 sources / 20k cards', () => summarizeSources(sources, cards));
    expect(r.value).toHaveLength(300);
    expect(r.ms).toBeLessThan(100);
  });
});
