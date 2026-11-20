export interface SealedProduct {
  product_id: string;
  set_code: string;
  name: string;
  low_price: number | null;
  price_market: number | null;
  url: string | null;
}

export type ProductType =
  | 'play-pack'
  | 'collector-pack'
  | 'set-pack'
  | 'draft-pack'
  | 'jumpstart-pack'
  | 'booster-pack'
  | 'play-box'
  | 'collector-box'
  | 'set-box'
  | 'draft-box'
  | 'jumpstart-box'
  | 'booster-box'
  | 'bundle'
  | 'other';

export function productType(name: string): ProductType {
  const n = name.toLowerCase();
  if (/\bcase\b|sample|prerelease|topper|display|commander|deck|starter|beginner|scene box|figure|gift box/.test(n))
    return 'other';
  if (/\bbundle\b|fat pack/.test(n)) return 'bundle';
  const flavor = /collector/.test(n)
    ? 'collector'
    : /\bplay booster/.test(n)
      ? 'play'
      : /\bset booster/.test(n)
        ? 'set'
        : /\bdraft booster/.test(n)
          ? 'draft'
          : /jumpstart/.test(n)
            ? 'jumpstart'
            : /booster/.test(n)
              ? 'booster'
              : null;
  if (!flavor) return 'other';
  if (/\bbox\b/.test(n)) return `${flavor}-box` as ProductType;
  if (/\bpack\b/.test(n) || /booster$/.test(n)) return `${flavor}-pack` as ProductType;
  return 'other';
}

export const isPackType = (t: ProductType) => t.endsWith('-pack');
export const isBoxType = (t: ProductType) => t.endsWith('-box') || t === 'bundle';

export function packsIn(t: ProductType): number {
  switch (t) {
    case 'collector-box':
      return 12;
    case 'play-box':
    case 'set-box':
      return 30;
    case 'draft-box':
    case 'booster-box':
      return 36;
    case 'jumpstart-box':
      return 24;
    case 'bundle':
      return 9;
    default:
      return 1;
  }
}

export function cardsPerPack(t: ProductType): number {
  return t.startsWith('collector') ? 15 : t.startsWith('jumpstart') ? 20 : 14;
}

export const productPrice = (p: SealedProduct) => p.low_price ?? p.price_market;

export interface MatchInput {
  setCodes?: string[];
  want?: 'pack' | 'box' | 'any';
}

export interface Suggestion {
  product: SealedProduct;
  type: ProductType;
}

const TYPE_ORDER: ProductType[] = [
  'play-pack', 'draft-pack', 'set-pack', 'booster-pack', 'collector-pack', 'jumpstart-pack',
  'play-box', 'draft-box', 'set-box', 'booster-box', 'collector-box', 'jumpstart-box', 'bundle',
];

export function productsForSet(catalog: SealedProduct[], setCode: string, want: MatchInput['want'] = 'any'): Suggestion[] {
  const code = setCode.toUpperCase();
  const out: Suggestion[] = [];
  for (const product of catalog) {
    if (product.set_code.toUpperCase() !== code) continue;
    const type = productType(product.name);
    if (type === 'other') continue;
    if (want === 'pack' && !isPackType(type)) continue;
    if (want === 'box' && !isBoxType(type)) continue;
    out.push({ product, type });
  }
  return out.sort(
    (a, b) => TYPE_ORDER.indexOf(a.type) - TYPE_ORDER.indexOf(b.type) || a.product.name.localeCompare(b.product.name),
  );
}

export function suggestProducts(catalog: SealedProduct[], input: MatchInput, limit = 5): Suggestion[] {
  const out: Suggestion[] = [];
  for (const code of input.setCodes ?? []) out.push(...productsForSet(catalog, code, input.want));
  return out.slice(0, limit);
}

export function setCodesByCount(codes: string[]): string[] {
  const n = new Map<string, number>();
  for (const c of codes) n.set(c.toUpperCase(), (n.get(c.toUpperCase()) ?? 0) + 1);
  return [...n.entries()].sort((a, b) => b[1] - a[1]).map(([c]) => c);
}

export function slimProduct(row: Record<string, unknown>): SealedProduct | null {
  const id = row.product_id;
  const name = row.name;
  const set = row.set_code;
  if (typeof id !== 'string' || typeof name !== 'string' || typeof set !== 'string') return null;
  const cents = (v: unknown) => (typeof v === 'number' && v > 0 ? Math.round(v) : null);
  return {
    product_id: id,
    set_code: set,
    name,
    low_price: cents(row.low_price),
    price_market: cents(row.price_market),
    url: typeof row.url === 'string' ? row.url : null,
  };
}
