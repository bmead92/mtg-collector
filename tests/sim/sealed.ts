import type { SealedProduct } from '../../src/lib/sealed';
import type { SimSet } from './catalog';

export function simCatalog(set: SimSet): SealedProduct[] {
  const row = (suffix: string, low: number): SealedProduct => ({
    product_id: `sealed-${set.code.toLowerCase()}-${suffix.toLowerCase().replace(/\s+/g, '-')}`,
    set_code: set.code,
    name: `${set.name} ${suffix}`,
    low_price: low,
    price_market: low + 50,
    url: null,
  });
  return [
    row('Play Booster Pack', 449),
    row('Collector Booster Pack', 2500),
    row('Play Booster Box', 13999),
    row('Collector Booster Box', 28999),
    row('Play Booster Box Case', 79999),
    row('Bundle', 4999),
    row('Prerelease Pack', 3999),
  ];
}
