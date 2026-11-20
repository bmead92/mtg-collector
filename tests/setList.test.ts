import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { slimProduct, type SealedProduct } from '../src/lib/sealed';
import { buildSetList, productsFor, searchSets, slimSet, usualProducts, withCardSetsFirst, type ScrySet } from '../src/lib/setList';

const load = (f: string) =>
  (JSON.parse(readFileSync(new URL(`./fixtures/${f}`, import.meta.url), 'utf8')) as { data: Record<string, unknown>[] }).data;
const SETS = load('scryfall-sets.json').map(slimSet).filter((s): s is ScrySet => s != null);
const CATALOG = load('sealed-sample.json').map(slimProduct).filter((p): p is SealedProduct => p != null);
const TODAY = new Date('2026-11-18T12:00:00Z');
const LIST = buildSetList(SETS, CATALOG, TODAY);
const byCode = (c: string) => LIST.find((s) => s.code === c)!;

describe('the set list', () => {
  it('lists booster sets newest first, with symbols, and leaves out tokens, digital and far-off sets', () => {
    expect(LIST.length).toBeGreaterThan(150);
    for (let i = 1; i < LIST.length; i++) expect(LIST[i - 1].released >= LIST[i].released).toBe(true);
    expect(byCode('FDN')).toMatchObject({ name: 'Foundations', priced: true });
    expect(byCode('FDN').icon).toMatch(/^https:\/\/svgs\.scryfall\.io\/sets\/.+\.svg/);
    expect(LIST.some((s) => s.type === 'token' || s.type === 'alchemy')).toBe(false);
    expect(LIST.some((s) => s.released > '2027-01-02')).toBe(false); // > 45 days ahead
    expect(LIST.find((s) => s.code === 'MDC')).toBeUndefined(); // only commander decks: nothing to open
  });

  it('every set Mana Pool sells packs for is listed', () => {
    const codes = new Set(LIST.map((s) => s.code));
    for (const p of CATALOG) if (/booster|bundle|fat pack/i.test(p.name) && !/commander|case|sample|prerelease/i.test(p.name))
      expect(codes.has(p.set_code)).toBe(true);
  });

  it('names a set Scryfall does not have from its product', () => {
    const extra: SealedProduct = { product_id: 'x', set_code: 'MB1', name: 'Mystery Booster Booster Box (Convention Edition - 2019)', low_price: 1, price_market: null, url: null };
    const list = buildSetList(SETS, [...CATALOG, extra], TODAY);
    expect(list.find((s) => s.code === 'MB1')).toMatchObject({ name: 'Mystery Booster', priced: true, icon: null });
  });
});

describe('searching sets', () => {
  const names = (q: string) => searchSets(LIST, q).map((s) => s.name);
  it('by name, word starts, any case or accent', () => {
    expect(names('foundations')[0]).toBe('Foundations');
    expect(names('edge et')[0]).toBe('Edge of Eternities');
    expect(names('spider')).toContain("Marvel's Spider-Man");
    expect(names('BLOOM')[0]).toBe('Bloomburrow');
  });
  it('by set code', () => {
    expect(names('dsk')[0]).toBe('Duskmourn: House of Horror');
    expect(names('10e')[0]).toBe('Tenth Edition');
  });
  it('nothing typed → everything; nonsense → nothing', () => {
    expect(searchSets(LIST, '  ')).toBe(LIST);
    expect(names('zzzqqq')).toEqual([]);
  });
});

describe("a set's products", () => {
  it('packs, boxes and bundles with prices; everyday booster first; no cases, kits or decks', () => {
    const all = productsFor(byCode('FDN'), CATALOG).map((p) => p.product.name);
    expect(all[0]).toBe('Foundations Play Booster Pack');
    expect(all).toContain('Foundations Collector Booster Box');
    expect(all.some((n) => /case|prerelease|sample|deck/i.test(n))).toBe(false);
    expect(productsFor(byCode('FDN'), CATALOG).every((p) => p.product.low_price != null || p.product.price_market != null)).toBe(true);
  });

  it('only packs / only boxes', () => {
    expect(productsFor(byCode('FIN'), CATALOG, 'pack').every((p) => p.type.endsWith('-pack'))).toBe(true);
    const boxes = productsFor(byCode('FIN'), CATALOG, 'box').map((p) => p.type);
    expect(boxes).toEqual(expect.arrayContaining(['play-box', 'collector-box']));
    expect(boxes.every((t) => t.endsWith('-box') || t === 'bundle')).toBe(true);
  });

  it('a set Mana Pool has nothing for gets the usual products, unpriced', () => {
    const unpriced = LIST.find((s) => !s.priced && s.released >= '2024-02-01')!;
    const ps = productsFor(unpriced, CATALOG);
    expect(ps.map((p) => p.type)).toEqual(['play-pack', 'collector-pack', 'play-box', 'collector-box', 'bundle']);
    expect(ps.every((p) => p.product.low_price == null && p.product.product_id === '')).toBe(true);
    expect(usualProducts({ code: 'M19', name: 'Core Set 2019', released: '2018-07-13' })[0].name).toBe('Core Set 2019 Booster Pack');
  });
});

describe("the scanned cards' sets go first", () => {
  it('most common set first, unknown codes ignored, no duplicates below', () => {
    const { fromCards, rest } = withCardSetsFirst(LIST, ['spm', 'FDN', 'ZZZ']);
    expect(fromCards.map((s) => s.code)).toEqual(['SPM', 'FDN']);
    expect(rest.some((s) => s.code === 'SPM' || s.code === 'FDN')).toBe(false);
    expect(fromCards.length + rest.length).toBe(LIST.length);
  });
});
