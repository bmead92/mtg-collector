import type { Scan } from './db';
import type { GrowthAddition } from './growth';

export interface SaleFrom {
  source_id: number | null;
  quantity: number;
  price_cents: number | null;
  added_at: string;
}

export type SaleCard = Omit<Scan, 'id' | 'photo_uri' | 'quantity'>;

export interface Sale {
  id: number;
  sold_at: string;
  quantity: number;
  sold_cents: number;
  card: SaleCard;
  from: SaleFrom[];
}

const DAY = 86_400_000;

export interface SaleSummary {
  addedCents: number | null;
  gainCents: number | null;
  ownedMs: number;
}

export function summarizeSale(s: Sale): SaleSummary {
  const priced = s.from.filter((f) => f.price_cents != null);
  const addedCents = priced.length ? priced.reduce((n, f) => n + (f.price_cents ?? 0) * f.quantity, 0) : null;
  const firstAdded = Math.min(...s.from.map((f) => Date.parse(f.added_at)).filter((t) => !Number.isNaN(t)));
  const sold = Date.parse(s.sold_at);
  return {
    addedCents,
    gainCents: addedCents == null ? null : s.sold_cents - addedCents,
    ownedMs: Number.isFinite(firstAdded) && !Number.isNaN(sold) ? Math.max(0, sold - firstAdded) : 0,
  };
}

export function formatOwned(ms: number): string {
  const days = Math.floor(ms / DAY);
  if (days < 1) return 'under a day';
  if (days < 60) return `${days} day${days === 1 ? '' : 's'}`;
  const months = Math.floor(days / 30.44);
  if (months < 24) return `${months} months`;
  const years = Math.round((days / 365.25) * 2) / 2;
  return `${years} years`;
}

export interface SoldTotals {
  copies: number;
  soldCents: number;
  addedCents: number;
  gainCents: number | null;
}

export function soldTotals(sales: Sale[]): SoldTotals {
  let copies = 0;
  let soldCents = 0;
  let addedCents = 0;
  let gain: number | null = null;
  for (const s of sales) {
    copies += s.quantity;
    soldCents += s.sold_cents;
    const sum = summarizeSale(s);
    if (sum.gainCents != null) {
      addedCents += sum.addedCents ?? 0;
      gain = (gain ?? 0) + sum.gainCents;
    }
  }
  return { copies, soldCents, addedCents, gainCents: gain };
}

export function soldGrowthAdds(sales: Sale[], unitPrice: (c: SaleCard) => number | null): GrowthAddition[] {
  return sales.flatMap((s) => {
    const unitCents = unitPrice(s.card);
    return s.from.map((f) => ({
      added_at: f.added_at,
      quantity: f.quantity,
      source_id: f.source_id,
      unitCents,
      removed_at: s.sold_at,
    }));
  });
}

export function soldBySource(sales: Sale[]): Map<number, { cards: number; soldCents: number }> {
  const out = new Map<number, { cards: number; soldCents: number }>();
  for (const s of sales)
    for (const f of s.from) {
      if (f.source_id == null || s.quantity <= 0) continue;
      const e = out.get(f.source_id) ?? { cards: 0, soldCents: 0 };
      e.cards += f.quantity;
      e.soldCents += Math.round((s.sold_cents * f.quantity) / s.quantity);
      out.set(f.source_id, e);
    }
  return out;
}

export interface PaidSummary {
  singlesCents: number;
  sealedCents: number;
  preconsCents: number;
  totalCents: number;
  returnCents: number;
  gainCents: number;
}

export function paidSummary(input: {
  sources: { kind: string; cost_cents: number | null }[];
  ownedAdditions: { quantity: number; price_cents: number | null }[];
  sales: Sale[];
  worthCents: number;
}): PaidSummary {
  const cost = (kind: (k: string) => boolean) =>
    input.sources.filter((s) => kind(s.kind)).reduce((n, s) => n + (s.cost_cents ?? 0), 0);
  const soldSingles = input.sales.flatMap((s) => s.from.filter((f) => f.source_id == null));
  const singlesCents = [...input.ownedAdditions, ...soldSingles].reduce((n, a) => n + (a.price_cents ?? 0) * a.quantity, 0);
  const sealedCents = cost((k) => k === 'pack' || k === 'box');
  const preconsCents = cost((k) => k === 'precon');
  const totalCents = singlesCents + sealedCents + preconsCents;
  const returnCents = input.worthCents + input.sales.reduce((n, s) => n + s.sold_cents, 0);
  return { singlesCents, sealedCents, preconsCents, totalCents, returnCents, gainCents: returnCents - totalCents };
}
