import type { Identification } from '../../src/lib/identify';
import type { ManaPoolSingle } from '../../src/lib/manapool';
import type { CardGuess } from '../../src/lib/ocr';
import type { SimSet } from './catalog';

const letters = (s: string) => s.toLowerCase().replace(/[^a-z]/g, '');

function distance(a: string, b: string): number {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array<number>(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++)
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length][b.length];
}

export function fakeIdentify(sets: SimSet[]) {
  return async (g: CardGuess): Promise<Identification> => {
    const set = sets.find((s) => s.code === g.setCode?.toUpperCase());
    const exact = set && g.collectorNumber ? set.byNumber(g.collectorNumber) : undefined;
    if (exact) return { card: exact, method: 'set+number', foil: g.foil };
    const want = letters(g.name ?? '');
    for (const s of sets) {
      const byName = s.cards.find((c) => !c.boosterFun && distance(letters(c.name), want) <= 2);
      if (byName) return { card: byName, method: 'name', foil: g.foil };
    }
    return { card: null, method: 'none', foil: false };
  };
}

const cents = (usd: string | null | undefined) => (usd ? Math.round(parseFloat(usd) * 100) : null);

export function fakeSingles(sets: SimSet[]) {
  const all = new Map(sets.flatMap((s) => s.cards).map((c) => [c.id, c]));
  return async (ids: string[]): Promise<Map<string, ManaPoolSingle>> => {
    const out = new Map<string, ManaPoolSingle>();
    for (const id of ids) {
      const c = all.get(id);
      if (!c) continue;
      out.set(id, {
        url: `https://manapool.test/${id}`,
        name: c.name,
        set_code: c.set,
        number: c.collector_number,
        scryfall_id: id,
        scryfall_ids: [id],
        available_quantity: 5,
        price_cents_nm: cents(c.prices?.usd),
        price_cents_nm_foil: cents(c.prices?.usd_foil),
        price_cents_nm_etched: null,
        price_market: cents(c.prices?.usd),
        price_market_foil: cents(c.prices?.usd_foil),
        variants: [],
      });
    }
    return out;
  };
}
