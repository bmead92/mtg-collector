export interface GrowthAddition {
  added_at: string; // ISO timestamp
  quantity: number;
  source_id: number | null;
  unitCents: number | null;
  removed_at?: string;
}

export interface Snapshot {
  day: string; // YYYY-MM-DD (local)
  value_cents: number;
  copies: number;
}

export type Granularity = 'day' | 'week' | 'month';

const DAY = 24 * 60 * 60 * 1000;

export function dayKey(d: Date | number): string {
  const x = new Date(d);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${x.getFullYear()}-${pad(x.getMonth() + 1)}-${pad(x.getDate())}`;
}

export function pickGranularity(firstMs: number, nowMs: number): Granularity {
  const span = nowMs - firstMs;
  return span < 21 * DAY ? 'day' : span < 183 * DAY ? 'week' : 'month';
}

export function periodStart(ms: number, g: Granularity): number {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  if (g === 'week') d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  if (g === 'month') d.setDate(1);
  return d.getTime();
}

function nextPeriod(ms: number, g: Granularity): number {
  const d = new Date(ms);
  if (g === 'day') d.setDate(d.getDate() + 1);
  else if (g === 'week') d.setDate(d.getDate() + 7);
  else d.setMonth(d.getMonth() + 1);
  return d.getTime();
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function periodLabel(ms: number, g: Granularity): string {
  const d = new Date(ms);
  if (g === 'month') return d.getMonth() === 0 ? `${MONTHS[0]} '${String(d.getFullYear()).slice(2)}` : MONTHS[d.getMonth()];
  return `${MONTHS[d.getMonth()]} ${d.getDate()}`;
}

export interface Period {
  start: number;
  label: string;
  copies: number;
  valueCents: number;
  fromOpened: number;
  removedCopies: number;
  removedValueCents: number;
  cumCopies: number;
  cumValueCents: number;
}

export function growthSeries(adds: GrowthAddition[], now = Date.now(), g?: Granularity): Period[] {
  if (adds.length === 0) return [];
  const times = adds.map((a) => Date.parse(a.added_at)).filter((t) => !Number.isNaN(t));
  if (times.length === 0) return [];
  const first = Math.min(...times);
  const gran = g ?? pickGranularity(first, now);
  const periods: Period[] = [];
  const index = new Map<number, Period>();
  for (let t = periodStart(first, gran); t <= now; t = nextPeriod(t, gran)) {
    const p: Period = {
      start: t,
      label: periodLabel(t, gran),
      copies: 0,
      valueCents: 0,
      fromOpened: 0,
      removedCopies: 0,
      removedValueCents: 0,
      cumCopies: 0,
      cumValueCents: 0,
    };
    periods.push(p);
    index.set(t, p);
  }
  for (const a of adds) {
    const t = Date.parse(a.added_at);
    if (Number.isNaN(t)) continue;
    const p = index.get(periodStart(Math.min(t, now), gran));
    if (!p) continue;
    p.copies += a.quantity;
    p.valueCents += (a.unitCents ?? 0) * a.quantity;
    if (a.source_id != null) p.fromOpened += a.quantity;
    if (a.removed_at) {
      const r = index.get(periodStart(Math.min(Math.max(Date.parse(a.removed_at), t), now), gran));
      if (r) {
        r.removedCopies += a.quantity;
        r.removedValueCents += (a.unitCents ?? 0) * a.quantity;
      }
    }
  }
  let copies = 0;
  let value = 0;
  for (const p of periods) {
    copies += p.copies - p.removedCopies;
    value += p.valueCents - p.removedValueCents;
    p.cumCopies = copies;
    p.cumValueCents = value;
  }
  return periods;
}

export function addedSince(adds: GrowthAddition[], sinceMs: number): { copies: number; valueCents: number } {
  let copies = 0;
  let valueCents = 0;
  for (const a of adds) {
    if (Date.parse(a.added_at) < sinceMs) continue;
    copies += a.quantity;
    valueCents += (a.unitCents ?? 0) * a.quantity;
  }
  return { copies, valueCents };
}

export function breakdown(adds: GrowthAddition[]) {
  const out = { owned: { copies: 0, valueCents: 0 }, opened: { copies: 0, valueCents: 0 } };
  for (const a of adds) {
    if (a.removed_at) continue;
    const b = a.source_id == null ? out.owned : out.opened;
    b.copies += a.quantity;
    b.valueCents += (a.unitCents ?? 0) * a.quantity;
  }
  return out;
}

export function priceMove(
  snapshots: Snapshot[],
  currentValueCents: number,
  adds: GrowthAddition[],
  now = Date.now(),
): { since: string; cents: number } | null {
  const today = dayKey(now);
  const base = [...snapshots].filter((s) => s.day < today).sort((a, b) => a.day.localeCompare(b.day))[0];
  if (!base) return null;
  const [y, m, d] = base.day.split('-').map(Number);
  const afterBase = new Date(y, m - 1, d + 1).getTime(); // additions on the snapshot day are in its value
  const added = addedSince(adds, afterBase).valueCents;
  const sold = adds
    .filter((a) => a.removed_at && Date.parse(a.removed_at) >= afterBase)
    .reduce((n, a) => n + (a.unitCents ?? 0) * a.quantity, 0);
  return { since: base.day, cents: currentValueCents - base.value_cents - added + sold };
}

export const startOfWeek = (now = Date.now()) => periodStart(now, 'week');
export const startOfMonth = (now = Date.now()) => periodStart(now, 'month');

export interface DayPoint {
  day: string; // YYYY-MM-DD (local)
  valueCents: number;
  copies: number;
  estimated: boolean;
}

export function dailyLine(adds: GrowthAddition[], snapshots: Snapshot[], now = Date.now()): DayPoint[] {
  const days = growthSeries(adds, now, 'day');
  const snap = new Map(snapshots.map((x) => [x.day, x]));
  return days.map((p) => {
    const day = dayKey(p.start);
    const s = snap.get(day);
    return s
      ? { day, valueCents: s.value_cents, copies: s.copies, estimated: false }
      : { day, valueCents: p.cumValueCents, copies: p.cumCopies, estimated: true };
  });
}

