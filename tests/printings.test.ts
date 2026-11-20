import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { printingTags, searchPrintings } from '../src/lib/printings';
import type { ScryfallCard } from '../src/lib/scryfall';

const PRINTS = (JSON.parse(readFileSync(new URL('./fixtures/sol-ring-printings.json', import.meta.url), 'utf8')) as { data: ScryfallCard[] }).data;
const find = (q: string) => searchPrintings(PRINTS, q);

describe('searching printings', () => {
  it('nothing typed → all of them, in order', () => {
    expect(find('  ')).toBe(PRINTS);
    expect(PRINTS.length).toBeGreaterThan(100);
  });

  it('by set name (word starts), set code or collector number', () => {
    expect(find('commander legends').every((c) => /commander legends/i.test(c.set_name))).toBe(true);
    expect(find('commander legends').length).toBeGreaterThan(0);
    expect(find('cmr').every((c) => c.set === 'cmr')).toBe(true);
    expect(find('cmr 472').map((c) => `${c.set} ${c.collector_number}`)).toEqual(['cmr 472']);
  });

  it('by year and by treatment', () => {
    const y = find('2021');
    expect(y.length).toBeGreaterThan(0);
    expect(y.every((c) => c.released_at.startsWith('2021') || c.collector_number === '2021')).toBe(true);
    const bl = find('borderless');
    expect(bl.length).toBeGreaterThan(10);
    expect(bl.every((c) => c.border_color === 'borderless')).toBe(true);
    expect(find('surge').every((c) => c.promo_types?.includes('surgefoil'))).toBe(true);
  });

  it('every word has to match; nonsense matches nothing', () => {
    const both = find('secret borderless');
    expect(both.length).toBeGreaterThan(0);
    expect(both.every((c) => /secret/i.test(c.set_name) && c.border_color === 'borderless')).toBe(true);
    expect(find('zzzqqq')).toEqual([]);
  });
});

describe('printing tags', () => {
  const base = { set: 'x', set_name: 'X', collector_number: '1', released_at: '2024-01-01', finishes: ['nonfoil'] } as unknown as ScryfallCard;
  it('names the treatments that make a printing look different', () => {
    expect(printingTags({ ...base, border_color: 'borderless', frame_effects: ['showcase'] })).toEqual(['Borderless', 'Showcase']);
    expect(printingTags({ ...base, frame: '1997' })).toEqual(['Retro frame']);
    expect(printingTags({ ...base, frame: '1997', released_at: '1999-01-01' })).toEqual([]); // just old
    expect(printingTags({ ...base, frame_effects: ['extendedart'], promo_types: ['boosterfun', 'surgefoil'] })).toEqual(['Extended art', 'Surge foil']);
    expect(printingTags(base)).toEqual([]);
  });
});
