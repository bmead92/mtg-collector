import './sim/mocks';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { rawDatabase, resetDatabases } from './stubs/expo-sqlite';
import { SIM } from './sim/fixture';
import { currentItems, launchApp, review, scanPulls, settle } from './sim/harness';
import { collectorBooster, openBox, playBooster } from './sim/packs';
import { CLEAN } from './sim/reads';
import { seeded } from './sim/rng';

const ownedCopies = () =>
  Number((rawDatabase()!.prepare('SELECT COALESCE(SUM(quantity), 0) AS n FROM scans').get() as { n: number }).n);
const savedStackRows = () =>
  Number((rawDatabase()!.prepare('SELECT COUNT(*) AS n FROM stack_items').get() as { n: number }).n);

beforeEach(() => resetDatabases());

describe('unsaved Stack survives the app closing', () => {
  it('restores a scanned pack after a restart, in order, with cards and prices', async () => {
    const rng = seeded(7);
    let app = await launchApp();
    const pack = collectorBooster(SIM, rng);
    scanPulls(app, pack, rng);
    await settle(app);
    const before = currentItems(app).map((it) => ({ n: it.number, card: it.card?.id, status: it.status }));
    expect(before).toHaveLength(15);

    app = await launchApp(); // app closed and reopened
    const after = currentItems(app).map((it) => ({ n: it.number, card: it.card?.id, status: it.status }));
    expect(after).toEqual(before);
    expect(currentItems(app).every((it) => it.single)).toBe(true);
  });

  it('keeps review edits (finish, untick) across a restart', async () => {
    const rng = seeded(8);
    let app = await launchApp();
    const pack = playBooster(SIM, rng);
    scanPulls(app, pack, rng);
    await settle(app);
    const [first, second] = currentItems(app);
    app.stack.updateItem(first.id, { finish: 'foil', condition: 'LP' });
    app.stack.updateItem(second.id, { include: false });
    await app.stack.flushStack();

    app = await launchApp();
    const items = currentItems(app);
    expect(items[0]).toMatchObject({ finish: 'foil', condition: 'LP' });
    expect(items[1].include).toBe(false);
  });

  it('resumes cards that were still being identified; marks unread photos as failed', async () => {
    let app = await launchApp();
    const card = SIM.byRarity('rare')[0];
    const base = { addedAt: Date.now(), card: null, method: 'none', finish: 'nonfoil', condition: 'NM', single: null, include: true };
    await app.db.writeStackItems(
      [
        { id: 'a', data: JSON.stringify({ ...base, id: 'a', number: 1, status: 'identifying', photoUri: null, guess: { name: card.name, setCode: 'SIM', collectorNumber: card.collector_number, foil: false, rawText: card.name } }) },
        { id: 'b', data: JSON.stringify({ ...base, id: 'b', number: 2, status: 'reading', photoUri: null, guess: null }) },
      ],
      [],
    );

    app = await launchApp();
    await settle(app);
    const [a, b] = currentItems(app);
    expect(a).toMatchObject({ status: 'done', method: 'set+number' });
    expect(a.card?.id).toBe(card.id);
    expect(b.status).toBe('failed');
    expect(b.error).toMatch(/scan it again/i);
  });

  it('new cards scanned after a restart are numbered after the restored ones', async () => {
    const rng = seeded(9);
    let app = await launchApp();
    scanPulls(app, playBooster(SIM, rng).slice(0, 3), rng);
    await settle(app);
    app = await launchApp();
    scanPulls(app, playBooster(SIM, rng).slice(0, 2), rng);
    await settle(app);
    expect(currentItems(app).map((it) => it.number)).toEqual([1, 2, 3, 4, 5]);
  });

  it('saving empties the saved Stack, so nothing is saved twice after a restart', async () => {
    const rng = seeded(10);
    let app = await launchApp();
    scanPulls(app, playBooster(SIM, rng), rng, CLEAN);
    await settle(app);
    expect(await app.stack.saveStack()).toBe(14);
    expect(savedStackRows()).toBe(0); // gone immediately, not just at the next flush

    app = await launchApp();
    expect(currentItems(app)).toHaveLength(0);
    expect(ownedCopies()).toBe(14);
  });

  it('clearing the Stack clears the saved copy', async () => {
    const rng = seeded(11);
    let app = await launchApp();
    scanPulls(app, playBooster(SIM, rng), rng);
    await settle(app);
    app.stack.clearStack();
    await app.stack.flushStack();
    app = await launchApp();
    expect(currentItems(app)).toHaveLength(0);
  });
});

describe('simulated box opening', () => {
  it('a 30-pack play box scanned over three sittings ends up fully in the collection', async () => {
    const rng = seeded(42);
    const box = openBox(SIM, rng, 'play');
    const sittings = [box.slice(0, 10), box.slice(10, 20), box.slice(20)];
    let total = 0;
    for (const packs of sittings) {
      let app = await launchApp();
      const pulls = packs.flat();
      scanPulls(app, pulls, rng);
      await settle(app);
      app = await launchApp(); // e.g. the phone killed the app mid-session
      expect(currentItems(app)).toHaveLength(pulls.length);
      const fixes = await review(app, pulls);
      expect(fixes.cardFixes).toBeLessThanOrEqual(pulls.length * 0.02); // OCR noise rarely defeats identify
      expect(currentItems(app).map((it) => it.card?.id)).toEqual(pulls.map((p) => p.card.id));
      total += await app.stack.saveStack();
    }
    expect(total).toBe(30 * 14);
    expect(ownedCopies()).toBe(30 * 14);
  });
});

describe('the app dies in the middle of saving', () => {
  it('cards already saved are not saved again; the rest are still in the Stack', async () => {
    const rng = seeded(12);
    let app = await launchApp();
    scanPulls(app, playBooster(SIM, rng), rng, CLEAN);
    await settle(app);
    const db = await import('../src/lib/db');
    let writes = 0;
    const real = db.insertScan;
    const spy = vi.spyOn(db, 'insertScan').mockImplementation(async (...args) => {
      if (++writes > 5) throw new Error('killed');
      return real(...args);
    });
    await expect(app.stack.saveStack()).rejects.toThrow('killed');
    spy.mockRestore();

    app = await launchApp();
    expect(ownedCopies()).toBe(5);
    expect(currentItems(app)).toHaveLength(9);
    expect(await app.stack.saveStack()).toBe(9);
    expect(ownedCopies()).toBe(14);
  });
});
