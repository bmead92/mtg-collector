import './sim/mocks';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildBackup, parseBackup, planRestore } from '../src/lib/backup';
import { breakdown, dayKey, growthSeries, priceMove, type GrowthAddition } from '../src/lib/growth';
import { rawDatabase, resetDatabases } from './stubs/expo-sqlite';
import { SIM } from './sim/fixture';
import { launchApp, review, scanPulls, settle, type App } from './sim/harness';
import { openPack, packValue, type Pull } from './sim/packs';
import { seeded } from './sim/rng';

beforeEach(() => resetDatabases());
afterEach(() => vi.useRealTimers());

const day = (d: number) => new Date(2026, 10, d, 12).getTime(); // Nov d, 2026, noon

async function scanAndSave(app: App, pulls: Pull[], rng: () => number, target: Parameters<App['stack']['saveStack']>[0]) {
  scanPulls(app, pulls, rng);
  await settle(app);
  await review(app, pulls);
  await settle(app);
  return app.stack.saveStack(target);
}

const toAdds = (rows: Awaited<ReturnType<App['db']['listAdditionsWithCard']>>): GrowthAddition[] =>
  rows.map((r) => ({ added_at: r.added_at, quantity: r.quantity, source_id: r.source_id, unitCents: r.price_cents }));

async function snapshot(app: App) {
  const scans = await app.db.listScans();
  const value = scans.reduce((n, s) => n + (s.price_cents ?? 0) * s.quantity, 0);
  await app.db.recordSnapshot(dayKey(Date.now()), value, null, scans.reduce((n, s) => n + s.quantity, 0));
  return value;
}

describe('collection growth from real saves', () => {
  it('singles on day 1, a pack a week later, prices rise: growth and price moves are told apart', async () => {
    const rng = seeded(300);
    vi.useFakeTimers({ now: day(2), toFake: ['Date'] });
    let app = await launchApp();
    const singles = openPack(SIM, rng, 'play'); // stand-in for a stack of singles
    await scanAndSave(app, singles, rng, { kind: 'owned' });
    const v1 = await snapshot(app);

    vi.setSystemTime(day(9));
    app = await launchApp();
    const pack = openPack(SIM, rng, 'collector');
    await scanAndSave(app, pack, rng, { kind: 'new', source: { kind: 'pack', name: 'P', cost_cents: 2500, packs: 1, packs_opened: 1 } });

    vi.setSystemTime(day(12));
    rawDatabase()!.exec('UPDATE scans SET price_cents = CAST(ROUND(price_cents * 1.1) AS INTEGER)');
    app = await launchApp();
    const now = await snapshot(app);

    const adds = toAdds(await app.db.listAdditionsWithCard());
    const series = growthSeries(adds, Date.now());
    expect(series[0].label).toBe('Nov 2');
    expect(series.at(-1)!.cumCopies).toBe(14 + 15);
    expect(series.find((p) => p.label === 'Nov 9')!.fromOpened).toBe(15);
    expect(breakdown(adds).opened.copies).toBe(15);

    const move = priceMove(await app.db.listSnapshots(), now, adds, Date.now())!;
    expect(move.since).toBe('2026-11-02');
    expect(Math.abs(move.cents - Math.round(v1 * 0.1))).toBeLessThanOrEqual(singles.length);
    expect(packValue(pack)).toBeGreaterThan(0);
  });

  it('one snapshot per day: later loads replace it', async () => {
    vi.useFakeTimers({ now: day(5), toFake: ['Date'] });
    const app = await launchApp();
    await app.db.recordSnapshot('2026-11-05', 100, null, 1);
    await app.db.recordSnapshot('2026-11-05', 250, 300, 2);
    expect(await app.db.listSnapshots()).toEqual([{ day: '2026-11-05', value_cents: 250, tcg_cents: 300, copies: 2 }]);
  });

  it('snapshots survive a backup and restore to a new phone', async () => {
    const rng = seeded(301);
    let app = await launchApp();
    await scanAndSave(app, openPack(SIM, rng, 'play'), rng, { kind: 'owned' });
    await app.db.recordSnapshot('2026-11-01', 1234, 1500, 14);
    await app.db.recordSnapshot('2026-11-02', 1300, null, 14);
    const text = JSON.stringify(
      buildBackup(await app.db.listScans(), null, '1.0.0', new Date(), {
        sources: await app.db.listSources(),
        additions: await app.db.listAdditions(),
        snapshots: await app.db.listSnapshots(),
      }),
    );
    resetDatabases();
    app = await launchApp();
    const b = parseBackup(text).backup;
    const plan = planRestore([], b.cards, 'replace', b.sources, b.snapshots);
    const progress: [number, number][] = [];
    await app.db.applyRestore(plan, (done, total) => progress.push([done, total]));
    const total = (plan.sources?.length ?? 0) + plan.insert.length + (plan.snapshots?.length ?? 0);
    expect(progress[0]).toEqual([0, total]);
    expect(progress.at(-1)).toEqual([total, total]);
    expect(progress.every(([d], i) => i === 0 || d > progress[i - 1][0])).toBe(true);
    expect(await app.db.listSnapshots()).toEqual([
      { day: '2026-11-01', value_cents: 1234, tcg_cents: 1500, copies: 14 },
      { day: '2026-11-02', value_cents: 1300, tcg_cents: null, copies: 14 },
    ]);
  });
});
