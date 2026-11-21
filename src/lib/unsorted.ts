export const SESSION_GAP_MS = 30 * 60 * 1000;

export interface Session<T> {
  start: string;
  rows: T[];
}

export function sessionsOf<T extends { added_at: string }>(rows: T[], gapMs = SESSION_GAP_MS): Session<T>[] {
  const sorted = [...rows].sort((a, b) => b.added_at.localeCompare(a.added_at));
  const out: Session<T>[] = [];
  let last = Infinity;
  for (const r of sorted) {
    const t = Date.parse(r.added_at);
    const cur = out[out.length - 1];
    if (!cur || last - t > gapMs) out.push({ start: r.added_at, rows: [r] });
    else {
      cur.rows.push(r);
      cur.start = r.added_at;
    }
    last = t;
  }
  return out;
}

export function historyRows<T extends { source_id: number | null }>(rows: T[], show: 'all' | 'loose', into: number | null): T[] {
  return rows.filter((r) => (into == null || r.source_id !== into) && (show === 'all' || r.source_id == null));
}
