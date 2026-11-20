import type { Finish } from './scryfall';

export interface ScryfallPrices {
  usd?: string | null;
  usd_foil?: string | null;
  usd_etched?: string | null;
  eur?: string | null;
  eur_foil?: string | null;
  eur_etched?: string | null;
}

export type PriceSource = 'manapool' | 'tcgplayer' | 'cardmarket';
export type HeadlineSource = 'manapool' | 'tcgplayer';

export const PRICE_SOURCES: { key: PriceSource; label: string; currency: 'USD' | 'EUR' }[] = [
  { key: 'manapool', label: 'Mana Pool', currency: 'USD' },
  { key: 'tcgplayer', label: 'TCGplayer', currency: 'USD' },
  { key: 'cardmarket', label: 'Cardmarket', currency: 'EUR' },
];
export const HEADLINE_SOURCES: HeadlineSource[] = ['manapool', 'tcgplayer'];

export interface Priced {
  finish: Finish;
  price_cents: number | null; // Mana Pool headline price
  sf_prices: string | null; // JSON of Scryfall's `prices`
}

export function toCents(v: string | null | undefined): number | null {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) : null;
}

export function serializePrices(p: ScryfallPrices | null | undefined): string | null {
  if (!p) return null;
  const keep: ScryfallPrices = {
    usd: p.usd ?? null,
    usd_foil: p.usd_foil ?? null,
    usd_etched: p.usd_etched ?? null,
    eur: p.eur ?? null,
    eur_foil: p.eur_foil ?? null,
    eur_etched: p.eur_etched ?? null,
  };
  return JSON.stringify(keep);
}

export function parsePrices(json: string | null | undefined): ScryfallPrices | null {
  if (!json) return null;
  try {
    const v = JSON.parse(json);
    return v && typeof v === 'object' ? (v as ScryfallPrices) : null;
  } catch {
    return null;
  }
}

export function scryfallCents(p: ScryfallPrices | null, source: 'tcgplayer' | 'cardmarket', finish: Finish) {
  if (!p) return null;
  if (source === 'tcgplayer') {
    if (finish === 'foil') return toCents(p.usd_foil);
    if (finish === 'etched') return toCents(p.usd_etched) ?? toCents(p.usd_foil);
    return toCents(p.usd);
  }
  if (finish === 'foil') return toCents(p.eur_foil);
  if (finish === 'etched') return toCents(p.eur_etched) ?? toCents(p.eur_foil);
  return toCents(p.eur);
}

export function priceFrom(card: Priced, source: PriceSource): number | null {
  if (source === 'manapool') return card.price_cents;
  return scryfallCents(parsePrices(card.sf_prices), source, card.finish);
}

const cache = new WeakMap<object, Partial<Record<PriceSource, number | null>>>();
export function cachedPrice(card: Priced, source: PriceSource): number | null {
  let entry = cache.get(card);
  if (!entry) cache.set(card, (entry = {}));
  if (!(source in entry)) entry[source] = priceFrom(card, source);
  return entry[source] ?? null;
}

export function formatMoney(cents: number | null | undefined, currency: 'USD' | 'EUR' = 'USD'): string {
  if (cents == null) return '—';
  const amount = groupThousands((cents / 100).toFixed(2));
  return currency === 'EUR' ? `€${amount}` : `$${amount}`;
}

export function groupThousands(amount: string): string {
  const [whole, frac] = amount.split('.');
  const sign = whole.startsWith('-') ? '-' : '';
  const digits = sign ? whole.slice(1) : whole;
  const grouped = digits.replace(/\B(?=(\d{3})+$)/g, ',');
  return `${sign}${grouped}${frac == null ? '' : `.${frac}`}`;
}
