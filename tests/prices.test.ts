import { describe, expect, it } from 'vitest';
import { cachedPrice, formatMoney, parsePrices, priceFrom, scryfallCents, serializePrices, toCents } from '../src/lib/prices';

describe('prices', () => {
  it('converts Scryfall price strings to cents', () => {
    expect(toCents('1.23')).toBe(123);
    expect(toCents('0.10')).toBe(10);
    expect(toCents('19.99')).toBe(1999);
    for (const bad of [null, '', 'abc', '-1']) expect(toCents(bad)).toBeNull();
  });

  const ser = serializePrices({ usd: '1.50', usd_foil: '4.00', usd_etched: null, eur: '1.20', eur_foil: '3.10', tix: '0.02' } as never)!;

  it('serializes only the price keys it uses', () => {
    expect(Object.keys(JSON.parse(ser)).sort()).toEqual(['eur', 'eur_etched', 'eur_foil', 'usd', 'usd_etched', 'usd_foil']);
    expect(serializePrices(null)).toBeNull();
    expect(parsePrices(ser)?.usd).toBe('1.50');
    expect(parsePrices('{oops')).toBeNull();
    expect(parsePrices('{}')).toEqual({});
  });

  it('picks the right finish, with etched → foil fallback but never foil → nonfoil', () => {
    const p = parsePrices(ser);
    expect(scryfallCents(p, 'tcgplayer', 'nonfoil')).toBe(150);
    expect(scryfallCents(p, 'tcgplayer', 'foil')).toBe(400);
    expect(scryfallCents(p, 'tcgplayer', 'etched')).toBe(400);
    expect(scryfallCents(p, 'cardmarket', 'nonfoil')).toBe(120);
    expect(scryfallCents(p, 'cardmarket', 'foil')).toBe(310);
    expect(scryfallCents({ usd: '5.00', usd_foil: null }, 'tcgplayer', 'foil')).toBeNull();
    expect(scryfallCents(null, 'tcgplayer', 'nonfoil')).toBeNull();
  });

  it('reads a saved card price from the chosen source', () => {
    const card = { finish: 'foil' as const, price_cents: 333, sf_prices: ser };
    expect(priceFrom(card, 'manapool')).toBe(333);
    expect(priceFrom(card, 'tcgplayer')).toBe(400);
    expect(priceFrom(card, 'cardmarket')).toBe(310);
    expect(priceFrom({ finish: 'nonfoil', price_cents: null, sf_prices: null }, 'tcgplayer')).toBeNull();
    expect(cachedPrice(card, 'tcgplayer')).toBe(400);
    expect(cachedPrice(card, 'tcgplayer')).toBe(400);
    expect(cachedPrice(card, 'manapool')).toBe(333);
  });

  it('formats money', () => {
    expect(formatMoney(1234)).toBe('$12.34');
    expect(formatMoney(5, 'EUR')).toBe('€0.05');
    expect(formatMoney(null, 'EUR')).toBe('—');
  });
});

describe('thousands', () => {
  it('groups dollars', async () => {
    const { formatMoney, groupThousands } = await import('../src/lib/prices');
    expect(formatMoney(2878765)).toBe('$28,787.65');
    expect(formatMoney(100000000)).toBe('$1,000,000.00');
    expect(formatMoney(99999)).toBe('$999.99');
    expect(groupThousands('-1234.50')).toBe('-1,234.50');
  });
});
