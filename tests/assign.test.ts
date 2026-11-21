import './sim/mocks';
import { beforeEach, describe, expect, it } from 'vitest';
import { summarizeSources } from '../src/lib/sources';
import { historyRows, sessionsOf } from '../src/lib/unsorted';
import { resetDatabases } from './stubs/expo-sqlite';
import { ALT, SIM } from './sim/fixture';
import { launchApp, review, scanPulls, settle, type App } from './sim/harness';
import { openPack, packValue, type Pull } from './sim/packs';
import { seeded } from './sim/rng';

beforeEach(() => resetDatabases());

async function scan(app: App, pulls: Pull[], rng: () => number) {
  scanPulls(app, pulls, rng);
  await settle(app);
  await review(app, pulls);
  await settle(app);
}

const pack = (name: string) => ({ kind: 'pack' as const, name, cost_cents: 600, packs: 1, packs_opened: 1 });

async function valueOf(app: App, id: number) {
  const src = (await app.db.getSource(id))!;
  const rows = await app.db.listSourceCards(id);
  const [s] = summarizeSources([src], rows.map((r) => ({ source_id: r.source_id, copies: r.copies, priceCents: r.price_cents })));
  return { copies: rows.reduce((n, r) => n + r.copies, 0), value: s.valueCents };
}

describe('two packs in one stack', () => {
  it('selected cards save to one pack, the rest stay for the next', async () => {
    const rng = seeded(31);
    const app = await launchApp();
    const a = openPack(SIM, rng, 'play');
    const b = openPack(ALT, rng, 'play');
    await scan(app, [...a, ...b], rng);

    const items = app.stack.getStackItems();
    const simIds = new Set(items.filter((i) => i.card?.set === SIM.code.toLowerCase()).map((i) => i.id));
    expect(await app.stack.saveStack({ kind: 'new', source: pack('First') }, simIds)).toBe(a.length);
    expect(app.stack.getStackItems()).toHaveLength(b.length);

    expect(await app.stack.saveStack({ kind: 'new', source: pack('Second') })).toBe(b.length);
    const [second, first] = await app.db.listSources();
    expect(await valueOf(app, first.id)).toEqual({ copies: a.length, value: packValue(a) });
    expect(await valueOf(app, second.id)).toEqual({ copies: b.length, value: packValue(b) });
  });
});

describe('adding saved cards to a pack', () => {
  it('cards saved without a pack move into one later', async () => {
    const rng = seeded(32);
    const app = await launchApp();
    const pulls = openPack(SIM, rng, 'play');
    await scan(app, pulls, rng);
    await app.stack.saveStack();

    const unsorted = (await app.db.listHistory()).filter((r) => r.source_id == null);
    const [session] = sessionsOf(unsorted);
    expect(session.rows.reduce((n, r) => n + r.copies, 0)).toBe(pulls.length);

    const id = (await app.stack.sourceForTarget({ kind: 'new', source: pack('Marvel') }))!;
    await app.db.assignAdditions(session.rows.map((r) => r.addition_id), id);

    expect(await valueOf(app, id)).toEqual({ copies: pulls.length, value: packValue(pulls) });
    expect((await app.db.listHistory()).filter((r) => r.source_id == null)).toHaveLength(0);
  });

  it('history shows where each card came from; cards move between packs and back to singles', async () => {
    const rng = seeded(33);
    const app = await launchApp();
    const pulls = openPack(SIM, rng, 'play');
    await scan(app, pulls, rng);
    await app.stack.saveStack({ kind: 'new', source: pack('Wrong pack') });

    const history = await app.db.listHistory();
    expect(new Set(history.map((r) => r.source_name))).toEqual(new Set(['Wrong pack']));

    const right = (await app.stack.sourceForTarget({ kind: 'new', source: pack('Right pack') }))!;
    await app.db.assignAdditions(history.map((r) => r.addition_id), right);
    expect(await valueOf(app, right)).toEqual({ copies: pulls.length, value: packValue(pulls) });

    await app.db.assignAdditions([history[0].addition_id], null);
    const after = await app.db.listHistory();
    expect(after.filter((r) => r.source_id == null)).toHaveLength(1);
    expect(after.filter((r) => r.source_name === 'Right pack')).toHaveLength(history.length - 1);
  });
});

describe('editing an opened pack', () => {
  it('a forgotten card joins the existing pack; a wrong one goes back to not in a pack', async () => {
    const rng = seeded(34);
    const app = await launchApp();
    const pulls = openPack(SIM, rng, 'play');
    await scan(app, pulls.slice(0, -1), rng);
    await app.stack.saveStack({ kind: 'new', source: pack('Marvel') });
    await scan(app, pulls.slice(-1), rng);
    await app.stack.saveStack();

    const [src] = await app.db.listSources();
    const forgotten = (await app.db.listHistory()).filter((r) => r.source_id == null);
    expect(forgotten).toHaveLength(1);
    await app.db.assignAdditions([forgotten[0].addition_id], src.id);
    expect(await valueOf(app, src.id)).toEqual({ copies: pulls.length, value: packValue(pulls) });
    expect(await app.db.listSources()).toHaveLength(1);

    await app.db.removeFromSource(src.id, [forgotten[0].id]);
    expect((await valueOf(app, src.id)).copies).toBe(pulls.length - 1);
    expect((await app.db.listHistory()).filter((r) => r.source_id == null)).toHaveLength(1);
  });
});

describe('scan sessions', () => {
  it('splits saves more than 30 minutes apart', () => {
    const at = (t: string) => ({ added_at: `2026-11-20T${t}:00.000Z` });
    const s = sessionsOf([at('19:00'), at('19:05'), at('21:40'), at('21:41'), at('21:45')]);
    expect(s.map((x) => x.rows.length)).toEqual([3, 2]);
    expect(s[0].start).toBe('2026-11-20T21:40:00.000Z');
  });
});

describe('history filter', () => {
  const rows = [{ source_id: null }, { source_id: 1 }, { source_id: 2 }];
  it('shows cards not in a pack, in both views', () => {
    expect(historyRows(rows, 'all', null)).toHaveLength(3);
    expect(historyRows(rows, 'loose', null)).toEqual([{ source_id: null }]);
  });
  it("adding to a pack hides that pack's own cards", () => {
    expect(historyRows(rows, 'all', 1)).toEqual([{ source_id: null }, { source_id: 2 }]);
    expect(historyRows(rows, 'loose', 1)).toEqual([{ source_id: null }]);
  });
});
