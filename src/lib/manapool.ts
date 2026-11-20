import { USER_AGENT } from './appInfo';
import type { Finish } from './scryfall';

const BASE = 'https://manapool.com/api/v1';
const MAX_IDS_PER_REQUEST = 100;

export type Condition = 'NM' | 'LP' | 'MP' | 'HP' | 'DMG';
export const CONDITIONS: Condition[] = ['NM', 'LP', 'MP', 'HP', 'DMG'];

type FinishId = 'NF' | 'FO' | 'EF';
const FINISH_ID: Record<Finish, FinishId> = { nonfoil: 'NF', foil: 'FO', etched: 'EF' };

export interface RecentSale {
  created_at: string;
  price: number;
  quantity: number;
}

export interface ManaPoolVariant {
  product_id: string;
  language_id: string;
  condition_id: Condition | 'UC';
  finish_id: FinishId;
  low_price: number;
  available_quantity: number;
  recent_sales: RecentSale[];
}

export interface ManaPoolSingle {
  url: string;
  name: string;
  set_code: string;
  number: string;
  scryfall_id: string | null;
  scryfall_ids: string[];
  available_quantity: number;
  price_cents_nm: number | null;
  price_cents_nm_foil: number | null;
  price_cents_nm_etched: number | null;
  price_market: number | null;
  price_market_foil: number | null;
  variants: ManaPoolVariant[];
}

export async function getSinglesByScryfallId(ids: string[]): Promise<Map<string, ManaPoolSingle>> {
  const unique = [...new Set(ids)];
  const out = new Map<string, ManaPoolSingle>();

  for (let i = 0; i < unique.length; i += MAX_IDS_PER_REQUEST) {
    const chunk = unique.slice(i, i + MAX_IDS_PER_REQUEST);
    const qs = chunk.map((id) => `scryfall_ids=${encodeURIComponent(id)}`).join('&');
    const res = await fetch(`${BASE}/products/singles?${qs}`, {
      headers: { Accept: 'application/json', 'User-Agent': USER_AGENT },
    });
    if (res.status === 429) {
      throw new Error(`Mana Pool rate limit hit; retry after ${res.headers.get('Retry-After') ?? '?'}s`);
    }
    if (!res.ok) throw new Error(`Mana Pool request failed (${res.status})`);
    const body = (await res.json()) as { data: ManaPoolSingle[] };
    for (const single of body.data) {
      for (const id of single.scryfall_ids?.length ? single.scryfall_ids : [single.scryfall_id]) {
        if (id) out.set(id, single);
      }
    }
  }
  return out;
}

function variantFor(single: ManaPoolSingle, finish: Finish, condition: Condition) {
  return single.variants?.find(
    (v) => v.language_id === 'EN' && v.finish_id === FINISH_ID[finish] && v.condition_id === condition,
  );
}

export interface PriceQuote {
  condition: Condition;
  lowCents: number | null;
  marketCents: number | null;
  listingsAvailable: number;
  recentSales: RecentSale[];
  url: string;
}

export function quoteFor(single: ManaPoolSingle, finish: Finish, condition: Condition): PriceQuote {
  const v = variantFor(single, finish, condition);
  let low = v && v.available_quantity > 0 && v.low_price > 0 ? v.low_price : null;
  if (low == null && condition === 'NM') {
    low =
      finish === 'foil'
        ? single.price_cents_nm_foil
        : finish === 'etched'
          ? single.price_cents_nm_etched
          : single.price_cents_nm;
  }
  return {
    condition,
    lowCents: low,
    marketCents: finish === 'nonfoil' ? single.price_market : single.price_market_foil,
    listingsAvailable: v?.available_quantity ?? 0,
    recentSales: v?.recent_sales ?? [],
    url: single.url,
  };
}

export function headlinePrice(q: PriceQuote): number | null {
  return q.condition === 'NM' ? (q.marketCents ?? q.lowCents) : (q.lowCents ?? q.marketCents);
}
