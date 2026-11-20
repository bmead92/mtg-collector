import './sim/mocks';
import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { setCodesByCount, slimProduct, suggestProducts, type SealedProduct } from '../src/lib/sealed';
import { buildSetList, productsFor, searchSets, type ScrySet } from '../src/lib/setList';
import { summarizeSources } from '../src/lib/sources';
import { resetDatabases } from './stubs/expo-sqlite';
import { ALT, SIM } from './sim/fixture';
import { launchApp, review, scanPulls, settle, type App } from './sim/harness';
import { openBox, openPack, packValue, type Pull } from './sim/packs';
import { seeded } from './sim/rng';
import { simCatalog } from './sim/sealed';

const real = JSON.parse(readFileSync(new URL('./fixtures/sealed-sample.json', import.meta.url), 'utf8')) as {
  data: Record<string, unknown>[];
};
const CATALOG: SealedProduct[] = [
  ...real.data.map(slimProduct).filter((p): p is SealedProduct => p != null),
  ...simCatalog(SIM),
  ...simCatalog(ALT),
];

const SETS: ScrySet[] = [SIM, ALT].map((s, i) => ({ code: s.code, name: s.name, released: `2026-0${i + 1}-01`, icon: null, type: 'expansion' }));
const LIST = buildSetList(SETS, CATALOG, new Date('2026-11-18'));
function pick(query: string, product: string, want: 'pack' | 'box' | 'any' = 'any') {
  const [set] = searchSets(LIST, query);
  const p = productsFor(set, CATALOG, want).find((x) => x.product.name.endsWith(product));
  if (!p) throw new Error(`no ${product} in ${set.name}`);
  return p;
}

beforeEach(() => resetDatabases());

type OpeningModule = typeof import('../src/lib/opening');
const loadOpening = () => import('../src/lib/opening') as Promise<OpeningModule>;

async function scanAndReview(app: App, pulls: Pull[], rng: () => number) {
  scanPulls(app, pulls, rng);
  await settle(app);
  await review(app, pulls);
  await settle(app);
}

const setCodesOf = (app: App) => setCodesByCount(app.stack.getStackItems().flatMap((i) => (i.card ? [i.card.set] : [])));

describe('picking the product before opening', () => {
  it('a collector pack: set picked → product picked → its cards saved against its price', async () => {
    const rng = seeded(200);
    const app = await launchApp();
    const opening = await loadOpening();

    const top = pick('simulated', 'Collector Booster Pack');
    expect(top.product.name).toBe('Simulated Expansion Collector Booster Pack');
    opening.setOpening({ product: top.product, type: top.type });

    const pack = openPack(SIM, rng, 'collector');
    await scanAndReview(app, pack, rng);
    const items = app.stack.getStackItems();
    await app.stack.saveStack({ kind: 'new', source: opening.sourceFromProduct(opening.getOpening()!, items.length) });

    const [src] = await app.db.listSources();
    expect(src).toMatchObject({
      kind: 'pack',
      name: 'Simulated Expansion Collector Booster Pack',
      cost_cents: 2500,
      packs: 1,
      set_code: 'SIM',
      product_id: 'sealed-sim-collector-booster-pack',
    });
    const rows = await app.db.listSourceCards(src.id);
    const [s] = summarizeSources([src], rows.map((r) => ({ source_id: r.source_id, copies: r.copies, priceCents: r.price_cents })));
    expect(s.valueCents).toBe(packValue(pack));
    expect(s.gainCents).toBe(packValue(pack) - 2500);
  });

  it('a set without prices yet: saved with no price and no product id', async () => {
    const rng = seeded(201);
    const app = await launchApp();
    const opening = await loadOpening();
    const sets = buildSetList([...SETS, { code: 'NEW', name: 'Brand New Set', released: '2026-11-14', icon: null, type: 'expansion' }], CATALOG, new Date('2026-11-18'));
    const [set] = searchSets(sets, 'brand new');
    const p = productsFor(set, CATALOG, 'pack')[0];
    expect(p.product.name).toBe('Brand New Set Play Booster Pack');
    opening.setOpening({ product: p.product, type: p.type });
    await scanAndReview(app, openPack(ALT, rng, 'play'), rng);
    await app.stack.saveStack({ kind: 'new', source: opening.sourceFromProduct(opening.getOpening()!, app.stack.getStackItems().length) });
    const [src] = await app.db.listSources();
    expect(src).toMatchObject({ name: 'Brand New Set Play Booster Pack', cost_cents: null, set_code: 'NEW', product_id: null });
  });

  it('nothing picked: suggestions from the cards, everyday booster first', async () => {
    const rng = seeded(202);
    const app = await launchApp();
    await scanAndReview(app, openPack(SIM, rng, 'play'), rng);
    const s = suggestProducts(CATALOG, { setCodes: setCodesOf(app), want: 'pack' });
    expect(s.map((x) => x.product.name).slice(0, 2)).toEqual([
      'Simulated Expansion Play Booster Pack',
      'Simulated Expansion Collector Booster Pack',
    ]);
    const boxes = suggestProducts(CATALOG, { setCodes: setCodesOf(app), want: 'box' });
    expect(boxes.map((x) => x.product.name)).toEqual(
      expect.arrayContaining(['Simulated Expansion Play Booster Box', 'Simulated Expansion Collector Booster Box', 'Simulated Expansion Bundle']),
    );
    expect(boxes.some((x) => /case|prerelease/i.test(x.product.name))).toBe(false);
  });
});

describe('a box picked from the catalog, opened over several sittings', () => {
  it('starts a 12-pack collector box at its price; later sittings continue it', async () => {
    const rng = seeded(204);
    const box = openBox(SIM, rng, 'collector');
    let app = await launchApp();
    let opening = await loadOpening();
    const top = pick('SIM', 'Collector Booster Box', 'box');
    expect(top.product.name).toBe('Simulated Expansion Collector Booster Box');
    opening.setOpening({ product: top.product, type: top.type });

    app = await launchApp();
    opening = await loadOpening();
    expect((await opening.loadOpening())?.product.name).toBe('Simulated Expansion Collector Booster Box');

    await scanAndReview(app, box.slice(0, 4).flat(), rng);
    const src = opening.sourceFromProduct(opening.getOpening()!, app.stack.getStackItems().length);
    expect(src).toMatchObject({ kind: 'box', packs: 12, packs_opened: 4, cost_cents: 28999 });
    await app.stack.saveStack({ kind: 'new', source: src });
    opening.setOpening(null);

    const [created] = await app.db.listSources();
    for (const sitting of [box.slice(4, 9), box.slice(9)]) {
      app = await launchApp();
      await scanAndReview(app, sitting.flat(), rng);
      await app.stack.saveStack({ kind: 'existing', sourceId: created.id, packsOpened: sitting.length });
    }
    const [done] = await app.db.listSources();
    expect(done.packs_opened).toBe(12);
    const rows = await app.db.listSourceCards(done.id);
    expect(rows.reduce((n, r) => n + r.copies, 0)).toBe(180);
  });
});

describe('the sealed catalog download', () => {
  it('fetches once, caches on the device, and falls back to the cache when offline', async () => {
    const body = { data: [{ product_id: 'p1', set_code: 'SIM', name: 'Simulated Expansion Play Booster Pack', low_price: 449, price_market: 500, url: null }] };
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(body), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    try {
      await launchApp();
      let cat = await import('../src/lib/sealedCatalog');
      expect(await cat.getSealedCatalog()).toHaveLength(1);
      expect(await cat.getSealedCatalog()).toHaveLength(1);
      expect(fetchMock).toHaveBeenCalledTimes(1);

      fetchMock.mockImplementation(async () => {
        throw new Error('offline');
      });
      vi.useFakeTimers({ now: Date.now() + 25 * 60 * 60 * 1000, toFake: ['Date'] });
      await launchApp();
      cat = await import('../src/lib/sealedCatalog');
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      expect((await cat.getSealedCatalog())[0].name).toBe('Simulated Expansion Play Booster Pack');
      warn.mockRestore();
    } finally {
      vi.useRealTimers();
      vi.unstubAllGlobals();
    }
  });
});
