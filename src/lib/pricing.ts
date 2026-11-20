import { deleteScan, sellScan, updatePricesBulk, type PriceUpdate, type Scan } from './db';
import { getSinglesByScryfallId, headlinePrice, quoteFor } from './manapool';
import { deletePhoto } from './photos';
import { formatMoney, serializePrices } from './prices';
import { cardsByIds } from './scryfall';

export async function removeScan(scan: Pick<Scan, 'id' | 'photo_uri'>) {
  await deleteScan(scan.id);
  if (scan.photo_uri) deletePhoto(scan.photo_uri);
}

export async function sellCard(scan: Pick<Scan, 'id' | 'photo_uri'>, copies: number, soldCents: number) {
  const result = await sellScan(scan.id, copies, soldCents);
  if (result === 'sold-all' && scan.photo_uri) deletePhoto(scan.photo_uri);
  return result;
}
export async function refreshPrices(scans: Scan[]): Promise<void> {
  if (scans.length === 0) return;
  const pid = (s: Scan) => s.price_id ?? s.scryfall_id;
  const ids = [...new Set(scans.map(pid))];
  const [singles, cards] = await Promise.all([getSinglesByScryfallId(ids), cardsByIds(ids).catch(() => null)]);
  const byId = cards ? new Map(cards.map((c) => [c.id, c])) : null;
  const updates: PriceUpdate[] = scans.map((s) => {
    const single = singles.get(pid(s));
    const q = single ? quoteFor(single, s.finish, s.condition) : null;
    const c = byId?.get(pid(s));
    return {
      id: s.id,
      manapool: q
        ? { price_cents: headlinePrice(q), market_cents: q.marketCents, low_cents: q.lowCents, manapool_url: q.url }
        : { price_cents: null, market_cents: null, low_cents: null, manapool_url: null },
      ...(c ? { sf_prices: serializePrices(c.prices) ?? '{}' } : {}),
    };
  });
  await updatePricesBulk(updates);
}

export const cardCount = (n: number) => `${n.toLocaleString()} card${n === 1 ? '' : 's'}`;

export const formatCents = (cents: number | null | undefined) => formatMoney(cents, 'USD');
