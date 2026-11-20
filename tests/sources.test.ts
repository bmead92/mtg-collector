import './sim/mocks';
import { beforeEach, describe, expect, it } from 'vitest';
import { buildBackup, parseBackup, planRestore } from '../src/lib/backup';
import { estimatePacks, groupOpened, parseDollars, summarizeSources, totals } from '../src/lib/sources';
import { rawDatabase, resetDatabases } from './stubs/expo-sqlite';
import { SIM } from './sim/fixture';
import { launchApp, review, scanPulls, settle, type App } from './sim/harness';
import { openBox, openPack, packValue, type Pull } from './sim/packs';
import { CLEAN } from './sim/reads';
import { seeded } from './sim/rng';

beforeEach(() => resetDatabases());

const q = <T,>(sql: string, ...p: (string | number | null)[]) => rawDatabase()!.prepare(sql).all(...p) as T[];

function expectLogConsistent() {
  const off = q<{ id: number }>(
    `SELECT s.id FROM scans s LEFT JOIN additions a ON a.scan_id = s.id
     GROUP BY s.id HAVING COALESCE(SUM(a.quantity), 0) <> s.quantity`,
  );
  expect(off).toEqual([]);
  expect(q('SELECT id FROM additions WHERE scan_id NOT IN (SELECT id FROM scans)')).toEqual([]);
}

async function scanAndSave(app: App, pulls: Pull[], rng: () => number, target: Parameters<App['stack']['saveStack']>[0]) {
  scanPulls(app, pulls, rng);
  await settle(app);
  await review(app, pulls);
  await settle(app);
  return app.stack.saveStack(target);
}

async function summaries(app: App) {
  const rows = await app.db.listSourceCards();
  return summarizeSources(
    await app.db.listSources(),
    rows.map((r) => ({ source_id: r.source_id, copies: r.copies, priceCents: r.price_cents })),
  );
}

describe('opening a box over several sittings', () => {
  it('tracks packs opened, cards, value and gain for a collector box', async () => {
    const rng = seeded(100);
    const box = openBox(SIM, rng, 'collector'); // 12 packs
    let app = await launchApp();
    await scanAndSave(app, box.slice(0, 4).flat(), rng, {
      kind: 'new',
      source: { kind: 'box', name: 'SIM Collector Booster Box', cost_cents: 30000, packs: 12, packs_opened: 4 },
    });
    const [src] = await app.db.listSources();
    for (const sitting of [box.slice(4, 8), box.slice(8)]) {
      app = await launchApp();
      await scanAndSave(app, sitting.flat(), rng, { kind: 'existing', sourceId: src.id, packsOpened: sitting.length });
    }

    const [s] = await summaries(app);
    expect(s.source).toMatchObject({ kind: 'box', packs: 12, packs_opened: 12, cost_cents: 30000 });
    expect(s.cards).toBe(12 * 15);
    const expected = box.reduce((n, p) => n + packValue(p), 0);
    expect(s.valueCents).toBe(expected);
    expect(s.gainCents).toBe(expected - 30000);
    expectLogConsistent();
  });

  it('cards that were already owned stay "already owned"; only the box copies count for the box', async () => {
    const rng = seeded(101);
    const app = await launchApp();
    const pack = openPack(SIM, rng, 'play');
    await scanAndSave(app, pack, rng, { kind: 'owned' });
    await scanAndSave(app, pack, rng, { kind: 'new', source: { kind: 'box', name: 'Box', cost_cents: 15000, packs: 30, packs_opened: 1 } });
    const [s] = await summaries(app);
    expect(s.cards).toBe(14);
    expect(s.valueCents).toBe(packValue(pack));
    const owned = q<{ n: number }>('SELECT SUM(quantity) AS n FROM scans')[0].n;
    expect(owned).toBe(28);
    expectLogConsistent();
  });
});

describe('loose packs', () => {
  it('each pack is its own entry; the group totals add up', async () => {
    const rng = seeded(102);
    const app = await launchApp();
    const packs = [openPack(SIM, rng, 'play'), openPack(SIM, rng, 'play'), openPack(SIM, rng, 'collector')];
    const costs = [499, 499, 3500];
    for (const [i, p] of packs.entries())
      await scanAndSave(app, p, rng, { kind: 'new', source: { kind: 'pack', name: `Pack ${i + 1}`, cost_cents: costs[i], packs: 1, packs_opened: 1 } });

    const g = groupOpened(await summaries(app));
    expect(g.loose).toHaveLength(3);
    expect(g.boxes).toHaveLength(0);
    const value = packs.reduce((n, p) => n + packValue(p), 0);
    expect(g.looseTotals).toMatchObject({ spentCents: 4498, valueCents: value, gainCents: value - 4498, packs: 3, cards: 43 });
  });

  it('a pack with no price entered has no gain, and is left out of the spent total', async () => {
    const rng = seeded(103);
    const app = await launchApp();
    await scanAndSave(app, openPack(SIM, rng, 'play'), rng, { kind: 'new', source: { kind: 'pack', name: 'Gift', cost_cents: null, packs: 1, packs_opened: 1 } });
    const list = await summaries(app);
    expect(list[0].gainCents).toBeNull();
    expect(totals(list)).toMatchObject({ spentCents: 0, gainCents: null });
  });
});

describe('the additions log stays consistent', () => {
  it('existing collections are migrated: every card becomes already owned on its added date', async () => {
    let app = await launchApp();
    const card = SIM.byRarity('rare')[3];
    await app.db.insertScan({
      photo_uri: '', scryfall_id: card.id, name: card.name, set_code: 'sim', set_name: SIM.name, collector_number: card.collector_number,
      image_uri: null, finish: 'nonfoil', condition: 'NM', price_cents: 100, market_cents: null, manapool_url: null, price_updated_at: null,
      type_line: null, color_identity: '', rarity: 'rare', released_at: null, layout: null, quantity: 3,
    });
    rawDatabase()!.exec("DELETE FROM additions; UPDATE scans SET created_at = '2026-01-02T03:04:05.000Z'");
    app = await launchApp();
    await app.db.listScans(); // opens the database
    expect(q('SELECT source_id, quantity, added_at FROM additions')).toEqual([
      { source_id: null, quantity: 3, added_at: '2026-01-02T03:04:05.000Z' },
    ]);
  });

  it('lowering a quantity takes copies off the newest addition (the box), deleting removes them', async () => {
    const rng = seeded(104);
    const app = await launchApp();
    const pull: Pull = { card: SIM.byRarity('mythic')[0], finish: 'nonfoil' };
    await scanAndSave(app, [pull], rng, { kind: 'owned' });
    await scanAndSave(app, [pull], rng, { kind: 'new', source: { kind: 'box', name: 'Box', cost_cents: 100, packs: 1, packs_opened: 1 } });
    const [row] = await app.db.listScans();
    expect(row.quantity).toBe(2);
    await app.db.setQuantity(row.id, 1);
    expect((await summaries(app))[0].cards).toBe(0);
    expectLogConsistent();

    await app.db.setQuantity(row.id, 3); // more copies by hand: already owned
    expect((await summaries(app))[0].cards).toBe(0);
    expectLogConsistent();

    await app.db.deleteScan(row.id);
    expect(q('SELECT * FROM additions')).toEqual([]);
  });

  it('editing a card into one already owned merges rows and keeps where each copy came from', async () => {
    const rng = seeded(105);
    const app = await launchApp();
    const a: Pull = { card: SIM.byRarity('rare')[0], finish: 'nonfoil' };
    const b: Pull = { card: SIM.byRarity('rare')[1], finish: 'nonfoil' };
    await scanAndSave(app, [a], rng, { kind: 'owned' });
    await scanAndSave(app, [b], rng, { kind: 'new', source: { kind: 'pack', name: 'P', cost_cents: 500, packs: 1, packs_opened: 1 } });
    const rowB = (await app.db.listScans()).find((s) => s.scryfall_id === b.card.id)!;
    await app.db.updateScanDetails(rowB.id, {
      scryfall_id: a.card.id, name: a.card.name, set_code: 'sim', set_name: SIM.name, collector_number: a.card.collector_number,
      image_uri: null, finish: 'nonfoil', condition: 'NM',
    });
    const rows = await app.db.listScans();
    expect(rows).toHaveLength(1);
    expect(rows[0].quantity).toBe(2);
    const [s] = await summaries(app);
    expect(s.cards).toBe(1);
    expectLogConsistent();
  });

  it('forgetting a pack keeps its cards, as already owned', async () => {
    const rng = seeded(106);
    const app = await launchApp();
    await scanAndSave(app, openPack(SIM, rng, 'play'), rng, { kind: 'new', source: { kind: 'pack', name: 'P', cost_cents: 500, packs: 1, packs_opened: 1 } });
    const [src] = await app.db.listSources();
    await app.db.deleteSource(src.id);
    expect(await app.db.listSources()).toEqual([]);
    expect(q<{ n: number }>('SELECT SUM(quantity) AS n FROM scans')[0].n).toBe(14);
    expect(q('SELECT * FROM additions WHERE source_id IS NOT NULL')).toEqual([]);
    expectLogConsistent();
  });
});

describe('backup keeps packs and boxes', () => {
  it('round-trips sources and where every copy came from', async () => {
    const rng = seeded(107);
    let app = await launchApp();
    await scanAndSave(app, openPack(SIM, rng, 'play'), rng, { kind: 'owned' });
    await scanAndSave(app, openBox(SIM, rng, 'collector', 2).flat(), rng, {
      kind: 'new',
      source: { kind: 'box', name: 'Collector Box', cost_cents: 30000, packs: 12, packs_opened: 2 },
    });
    await scanAndSave(app, openPack(SIM, rng, 'play'), rng, { kind: 'new', source: { kind: 'pack', name: 'Pack', cost_cents: 499, packs: 1, packs_opened: 1 } });
    const before = (await summaries(app)).map((s) => ({ name: s.source.name, cards: s.cards, value: s.valueCents, opened: s.source.packs_opened }));
    const file = buildBackup(await app.db.listScans(), null, '0.8.0', new Date(), {
      sources: await app.db.listSources(),
      additions: await app.db.listAdditions(),
    });
    const text = JSON.stringify(file);

    resetDatabases(); // new phone
    app = await launchApp();
    const parsed = parseBackup(text);
    await app.db.applyRestore(planRestore([], parsed.backup.cards, 'replace', parsed.backup.sources));
    const after = (await summaries(app)).map((s) => ({ name: s.source.name, cards: s.cards, value: s.valueCents, opened: s.source.packs_opened }));
    expect(after).toEqual(before);
    expectLogConsistent();
  });

  it('restoring a v1 backup (no sources) still works: everything already owned', async () => {
    const app = await launchApp();
    const card = SIM.byRarity('uncommon')[0];
    const v1 = JSON.stringify({
      format: 'mtg-price-checker-backup', version: 1, exportedAt: '', appVersion: '0.6.0', prefs: null,
      cards: [{ scryfall_id: card.id, name: card.name, set_code: 'sim', collector_number: card.collector_number, finish: 'nonfoil', condition: 'NM', quantity: 2 }],
    });
    const parsed = parseBackup(v1);
    await app.db.applyRestore(planRestore([], parsed.backup.cards, 'replace', parsed.backup.sources));
    expect(q('SELECT source_id, quantity FROM additions')).toEqual([{ source_id: null, quantity: 2 }]);
  });
});

describe('save-flow helpers', () => {
  it('estimates packs from a card count', () => {
    expect(estimatePacks(1)).toBe(1);
    expect(estimatePacks(14)).toBe(1);
    expect(estimatePacks(30)).toBe(2);
    expect(estimatePacks(180, 15)).toBe(12);
  });

  it('parses typed prices', () => {
    expect(parseDollars('35')).toBe(3500);
    expect(parseDollars('$4.99')).toBe(499);
    expect(parseDollars('4,5')).toBe(450);
    expect(parseDollars('')).toBeNull();
    expect(parseDollars('abc')).toBeNull();
    expect(parseDollars('1.234')).toBeNull();
  });

  it('a noisy scan of a clean box needs few review fixes', async () => {
    const rng = seeded(108);
    const app = await launchApp();
    const pulls = openBox(SIM, rng, 'play', 5).flat();
    scanPulls(app, pulls, rng, CLEAN);
    await settle(app);
    expect((await review(app, pulls)).cardFixes).toBe(0);
  });
});
