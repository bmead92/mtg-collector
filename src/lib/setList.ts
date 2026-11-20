import { productsForSet, productType, type MatchInput, type SealedProduct, type Suggestion } from './sealed';

export interface ScrySet {
  code: string; // upper case, as Mana Pool has it
  name: string;
  released: string; // YYYY-MM-DD ('' when unknown)
  icon: string | null;
  type: string;
}

export interface SetEntry extends ScrySet {
  priced: boolean;
}

const BOOSTER_TYPES = new Set(['expansion', 'core', 'masters', 'draft_innovation', 'funny']);
const AHEAD_DAYS = 45;

export function slimSet(row: Record<string, unknown>): ScrySet | null {
  if (typeof row.code !== 'string' || typeof row.name !== 'string' || row.digital === true) return null;
  return {
    code: row.code.toUpperCase(),
    name: row.name,
    released: typeof row.released_at === 'string' ? row.released_at : '',
    icon: typeof row.icon_svg_uri === 'string' ? row.icon_svg_uri : null,
    type: typeof row.set_type === 'string' ? row.set_type : '',
  };
}

function nameFromProduct(name: string): string {
  const base = name.replace(/\s*\(.*\)\s*$/, '');
  const short = base.replace(/\s+(play |collector |set |draft |jumpstart )?(booster( pack| box)?|bundle|fat pack)$/i, '');
  return (short || base).trim();
}

export function buildSetList(sets: ScrySet[], catalog: SealedProduct[], today: Date = new Date()): SetEntry[] {
  const priced = new Map<string, string>(); // code → a product name
  for (const p of catalog) if (productType(p.name) !== 'other') priced.set(p.set_code.toUpperCase(), p.name);

  const limit = new Date(today.getTime() + AHEAD_DAYS * 86_400_000).toISOString().slice(0, 10);
  const out: SetEntry[] = [];
  const seen = new Set<string>();
  for (const s of sets) {
    if (seen.has(s.code)) continue;
    const has = priced.has(s.code);
    if (!has && !(BOOSTER_TYPES.has(s.type) && s.released && s.released <= limit)) continue;
    seen.add(s.code);
    out.push({ ...s, priced: has });
  }
  for (const [code, productName] of priced) {
    if (seen.has(code)) continue;
    out.push({ code, name: nameFromProduct(productName), released: '', icon: null, type: '', priced: true });
  }
  return out.sort((a, b) => b.released.localeCompare(a.released) || a.name.localeCompare(b.name));
}

export const fold = (t: string) =>
  t
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ');

export function searchSets(list: SetEntry[], query: string): SetEntry[] {
  const q = fold(query).trim();
  if (!q) return list;
  const qWords = q.split(/\s+/);
  const scored: { s: SetEntry; rank: number }[] = [];
  list.forEach((s, i) => {
    const name = fold(s.name);
    const nameWords = name.split(/\s+/).filter(Boolean);
    let rank: number;
    if (s.code.toLowerCase() === q) rank = 0;
    else if (name.startsWith(q)) rank = 1;
    else if (qWords.every((w) => nameWords.some((n) => n.startsWith(w)))) rank = 2;
    else return;
    scored.push({ s, rank: rank * 1e6 + i });
  });
  return scored.sort((a, b) => a.rank - b.rank).map((x) => x.s);
}

export function usualProducts(set: Pick<ScrySet, 'code' | 'name' | 'released'>): SealedProduct[] {
  const kinds =
    !set.released || set.released >= '2024-02-01' // Play Boosters replaced Draft / Set Boosters
      ? ['Play Booster Pack', 'Collector Booster Pack', 'Play Booster Box', 'Collector Booster Box', 'Bundle']
      : ['Booster Pack', 'Collector Booster Pack', 'Booster Box', 'Collector Booster Box', 'Bundle'];
  return kinds.map((k) => ({
    product_id: '',
    set_code: set.code,
    name: `${set.name} ${k}`,
    low_price: null,
    price_market: null,
    url: null,
  }));
}

export function productsFor(set: SetEntry, catalog: SealedProduct[], want: MatchInput['want'] = 'any'): Suggestion[] {
  const real = productsForSet(catalog, set.code, want);
  if (real.length > 0 || set.priced) return real;
  return productsForSet(usualProducts(set), set.code, want);
}

export function withCardSetsFirst(list: SetEntry[], setCodes: string[]): { fromCards: SetEntry[]; rest: SetEntry[] } {
  const want = setCodes.map((c) => c.toUpperCase());
  const fromCards = want.map((c) => list.find((s) => s.code === c)).filter((s): s is SetEntry => !!s);
  const picked = new Set(fromCards.map((s) => s.code));
  return { fromCards, rest: list.filter((s) => !picked.has(s.code)) };
}
