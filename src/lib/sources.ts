import { groupThousands } from './prices';

export type SourceKind = 'pack' | 'box' | 'precon';

export interface Source {
  id: number;
  kind: SourceKind;
  name: string;
  cost_cents: number | null;
  packs: number;
  packs_opened: number;
  set_code: string | null;
  product_id: string | null;
  finished: number; // 0 / 1
  created_at: string;
}

export type NewSource = Pick<Source, 'kind' | 'name' | 'cost_cents' | 'packs'> &
  Partial<Pick<Source, 'packs_opened' | 'set_code' | 'product_id'>>;

export interface SourceCard {
  source_id: number;
  copies: number;
  priceCents: number | null;
}

export interface SourceSummary {
  source: Source;
  cards: number;
  valueCents: number;
  soldCards: number;
  soldCents: number;
  gainCents: number | null;
}

export function summarizeSources(
  sources: Source[],
  cards: SourceCard[],
  sold: Map<number, { cards: number; soldCents: number }> = new Map(),
): SourceSummary[] {
  const by = new Map<number, { cards: number; value: number }>();
  for (const c of cards) {
    const e = by.get(c.source_id) ?? { cards: 0, value: 0 };
    e.cards += c.copies;
    e.value += (c.priceCents ?? 0) * c.copies;
    by.set(c.source_id, e);
  }
  return sources.map((source) => {
    const e = by.get(source.id) ?? { cards: 0, value: 0 };
    const out = sold.get(source.id) ?? { cards: 0, soldCents: 0 };
    return {
      source,
      cards: e.cards,
      valueCents: e.value,
      soldCards: out.cards,
      soldCents: out.soldCents,
      gainCents: source.cost_cents == null ? null : e.value + out.soldCents - source.cost_cents,
    };
  });
}

export interface OpenedTotals {
  spentCents: number;
  valueCents: number;
  gainCents: number | null;
  soldCents: number;
  packs: number;
  cards: number;
  count: number;
}

export function totals(list: SourceSummary[]): OpenedTotals {
  const withCost = list.filter((s) => s.source.cost_cents != null);
  return {
    spentCents: withCost.reduce((n, s) => n + (s.source.cost_cents ?? 0), 0),
    valueCents: list.reduce((n, s) => n + s.valueCents, 0),
    gainCents: withCost.length ? withCost.reduce((n, s) => n + (s.gainCents ?? 0), 0) : null,
    soldCents: list.reduce((n, s) => n + s.soldCents, 0),
    packs: list.reduce((n, s) => n + s.source.packs_opened, 0),
    cards: list.reduce((n, s) => n + s.cards, 0),
    count: list.length,
  };
}

export function groupOpened(list: SourceSummary[]) {
  const loose = list.filter((s) => s.source.kind === 'pack');
  const boxes = list
    .filter((s) => s.source.kind === 'box')
    .sort((a, b) => a.source.finished - b.source.finished || b.source.created_at.localeCompare(a.source.created_at));
  const precons = list
    .filter((s) => s.source.kind === 'precon')
    .sort((a, b) => b.source.created_at.localeCompare(a.source.created_at));
  return { loose, looseTotals: totals(loose), boxes, precons };
}

export const CARDS_PER_PACK = 14;

export function estimatePacks(cards: number, perPack = CARDS_PER_PACK): number {
  return Math.max(1, Math.round(cards / perPack));
}

export const openBoxes = (sources: Source[]) => sources.filter((s) => s.kind === 'box' && !s.finished);

export function boxProgress(s: Source): string {
  return `${s.packs_opened}/${s.packs} pack${s.packs === 1 ? '' : 's'}`;
}

export function formatGain(cents: number | null): string {
  if (cents == null) return '—';
  const abs = `$${groupThousands((Math.abs(cents) / 100).toFixed(2))}`;
  return cents > 0 ? `+${abs}` : cents < 0 ? `−${abs}` : abs;
}

export function gainPercent(gainCents: number | null, costCents: number | null): string {
  if (gainCents == null || !costCents) return '';
  const p = Math.round((gainCents / costCents) * 100);
  return `${p > 0 ? '+' : p < 0 ? '−' : ''}${Math.abs(p)}%`;
}

export function parseDollars(text: string): number | null {
  const t = text.replace(/[$\s]/g, '').replace(',', '.');
  if (!t) return null;
  if (!/^\d+(\.\d{0,2})?$/.test(t)) return null;
  return Math.round(parseFloat(t) * 100);
}
