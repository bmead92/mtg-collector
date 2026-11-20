import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { packsIn, productType, setCodesByCount, slimProduct, suggestProducts, type SealedProduct } from '../src/lib/sealed';

const raw = JSON.parse(readFileSync(new URL('./fixtures/sealed-sample.json', import.meta.url), 'utf8')) as {
  data: Record<string, unknown>[];
};
const CATALOG = raw.data.map(slimProduct).filter((p): p is SealedProduct => p != null);
const names = (s: { product: SealedProduct }[]) => s.map((x) => x.product.name);

describe('product types', () => {
  it.each([
    ['Foundations Play Booster Pack', 'play-pack'],
    ['Foundations Collector Booster Box', 'collector-box'],
    ["Marvel's Spider-Man Collector Booster Pack", 'collector-pack'],
    ['Foundations Jumpstart Booster Pack', 'jumpstart-pack'],
    ['Aetherdrift Bundle', 'bundle'],
    ["Marvel's Spider-Man Gift Bundle", 'bundle'],
    ['Tenth Edition Booster Pack', 'booster-pack'],
    ['Tenth Edition Fat Pack', 'bundle'],
    ['Foundations Play Booster Box Case', 'other'],
    ['Edge of Eternities Collector Booster Sample Pack', 'other'],
    ['Foundations Prerelease Pack', 'other'],
    ['Marvel Darkhold Destiny Commander Deck Gods of Asgard', 'other'],
  ])('%s → %s', (name, type) => expect(productType(name)).toBe(type));

  it('has sensible pack counts', () => {
    expect(packsIn('collector-box')).toBe(12);
    expect(packsIn('play-box')).toBe(30);
    expect(packsIn('bundle')).toBe(9);
  });
});

describe('suggesting the product being opened', () => {
  it('from the cards alone: that set’s packs, everyday booster first, no cases or decks', () => {
    const s = suggestProducts(CATALOG, { setCodes: ['SPM'], want: 'pack' });
    expect(names(s).slice(0, 2)).toEqual(["Marvel's Spider-Man Play Booster Pack", "Marvel's Spider-Man Collector Booster Pack"]);
    expect(s.every((x) => x.product.set_code === 'SPM')).toBe(true);
  });

  it('boxes: box and bundle products only', () => {
    const s = suggestProducts(CATALOG, { setCodes: ['FIN'], want: 'box' });
    expect(names(s)).toContain('Final Fantasy Play Booster Box');
    expect(names(s)).toContain('Final Fantasy Collector Booster Box');
    expect(names(s).some((n) => /case|deck|scene/i.test(n))).toBe(false);
  });

  it('cards from a bonus sheet do not outvote the main set', () => {
    const codes = setCodesByCount(['spm', 'spm', 'spm', 'spe', 'spm', 'spm', 'mar']);
    expect(codes[0]).toBe('SPM');
    expect(suggestProducts(CATALOG, { setCodes: codes, want: 'pack' })[0].product.set_code).toBe('SPM');
  });

  it('nothing to go on → no suggestions', () => {
    expect(suggestProducts(CATALOG, {})).toEqual([]);
    expect(suggestProducts(CATALOG, { setCodes: ['ZZZ'], want: 'pack' })).toEqual([]);
  });
});
