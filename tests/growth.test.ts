import { describe, expect, it } from 'vitest';
import {
  addedSince,
  breakdown,
  dailyLine,
  dayKey,
  growthSeries,
  pickGranularity,
  priceMove,
  startOfMonth,
  startOfWeek,
  type GrowthAddition,
} from '../src/lib/growth';

const at = (y: number, m: number, d: number, h = 12) => new Date(y, m - 1, d, h).getTime();
const add = (ms: number, quantity: number, unitCents: number, source_id: number | null = null): GrowthAddition => ({
  added_at: new Date(ms).toISOString(),
  quantity,
  unitCents,
  source_id,
});

describe('growth over time', () => {
  const now = at(2026, 11, 18);
  const adds = [add(at(2026, 11, 2), 100, 50), add(at(2026, 11, 10), 14, 30, 1), add(at(2026, 11, 15), 60, 200, 2)];

  it('picks bar size from the time span', () => {
    expect(pickGranularity(at(2026, 11, 2), now)).toBe('day');
    expect(pickGranularity(at(2026, 9, 1), now)).toBe('week');
    expect(pickGranularity(at(2025, 1, 1), now)).toBe('month');
  });

  it('builds daily periods with running totals, empty days included', () => {
    const s = growthSeries(adds, now);
    expect(s).toHaveLength(17); // Nov 2 … Nov 18
    expect(s[0]).toMatchObject({ label: 'Nov 2', copies: 100, valueCents: 5000, cumCopies: 100 });
    expect(s[1]).toMatchObject({ copies: 0, cumCopies: 100 });
    expect(s[8]).toMatchObject({ label: 'Nov 10', copies: 14, fromOpened: 14, cumCopies: 114 });
    expect(s.at(-1)).toMatchObject({ label: 'Nov 18', cumCopies: 174, cumValueCents: 5000 + 420 + 12000 });
  });

  it('weekly and monthly bars group the same additions', () => {
    const w = growthSeries(adds, now, 'week');
    expect(w.map((p) => p.copies)).toEqual([100, 74, 0]); // weeks of Mon Nov 2, Nov 9 (Tue 10 + Sun 15), Nov 16
    const m = growthSeries([add(at(2026, 9, 5), 3, 100), ...adds], now, 'month');
    expect(m.map((p) => p.label)).toEqual(['Sep', 'Oct', 'Nov']);
    expect(m.map((p) => p.cumCopies)).toEqual([3, 3, 177]);
  });

  it('this week / month summaries and the owned vs opened split', () => {
    expect(addedSince(adds, startOfWeek(now))).toEqual({ copies: 0, valueCents: 0 }); // this week = Mon Nov 16 on
    expect(addedSince(adds, startOfMonth(now)).copies).toBe(174);
    expect(breakdown(adds)).toEqual({ owned: { copies: 100, valueCents: 5000 }, opened: { copies: 74, valueCents: 12420 } });
  });

  it('nothing added → no bars', () => {
    expect(growthSeries([], now)).toEqual([]);
  });
});

describe('price moves vs cards added', () => {
  const now = at(2026, 11, 20);
  it('needs a snapshot from an earlier day', () => {
    expect(priceMove([{ day: dayKey(now), value_cents: 100, copies: 1 }], 100, [], now)).toBeNull();
  });

  it('separates price changes from new cards', () => {
    const snaps = [
      { day: '2026-11-18', value_cents: 10000, copies: 50 },
      { day: '2026-11-19', value_cents: 13200, copies: 60 },
    ];
    const adds = [add(at(2026, 11, 1), 50, 200), add(at(2026, 11, 19), 10, 300)];
    expect(priceMove(snaps, 14500, adds, now)).toEqual({ since: '2026-11-18', cents: 1500 });
  });

  it('cards added on the snapshot day are already in its value', () => {
    const adds = [add(at(2026, 11, 18, 9), 5, 100)];
    expect(priceMove([{ day: '2026-11-18', value_cents: 500, copies: 5 }], 450, adds, now)).toEqual({ since: '2026-11-18', cents: -50 });
  });
});

describe('daily line', () => {
  it('one point per day; snapshots where recorded, estimates before', () => {
    const now = at(2026, 11, 5);
    const adds = [add(at(2026, 11, 2), 10, 100), add(at(2026, 11, 4), 5, 200)];
    const line = dailyLine(adds, [{ day: '2026-11-04', value_cents: 2100, copies: 15 }], now);
    expect(line).toEqual([
      { day: '2026-11-02', valueCents: 1000, copies: 10, estimated: true },
      { day: '2026-11-03', valueCents: 1000, copies: 10, estimated: true },
      { day: '2026-11-04', valueCents: 2100, copies: 15, estimated: false },
      { day: '2026-11-05', valueCents: 2000, copies: 15, estimated: true },
    ]);
  });

  it('no cards → no points', () => {
    expect(dailyLine([], [], at(2026, 11, 5))).toEqual([]);
  });
});

