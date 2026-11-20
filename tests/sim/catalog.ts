import type { ScryfallCard } from '../../src/lib/scryfall';
import { between, seeded, type Rng } from './rng';

export type Rarity = 'common' | 'uncommon' | 'rare' | 'mythic';

export interface SimCard extends ScryfallCard {
  rarity: Rarity;
  boosterFun: boolean;
  basic: boolean;
}

export interface SimSet {
  code: string;
  name: string;
  cards: SimCard[];
  byRarity(r: Rarity, opts?: { boosterFun?: boolean }): SimCard[];
  basics: SimCard[];
  byNumber(n: string): SimCard | undefined;
}

const ADJ = ['Ember', 'Gloom', 'Verdant', 'Tidal', 'Iron', 'Hollow', 'Radiant', 'Feral', 'Ashen', 'Storm', 'Silent', 'Gilded'];
const NOUN = ['Sentinel', 'Drake', 'Oracle', 'Rogue', 'Colossus', 'Wisp', 'Warden', 'Shaman', 'Hydra', 'Knight', 'Specter', 'Golem'];
const SPELL = ['Rebuke', 'Surge', 'Pact', 'Reckoning', 'Bloom', 'Insight', 'Ambush', 'Cascade'];
const BASICS = ['Plains', 'Island', 'Swamp', 'Mountain', 'Forest'];

const PRICE: Record<Rarity, [number, number]> = {
  common: [3, 25],
  uncommon: [8, 60],
  rare: [20, 1500],
  mythic: [100, 6000],
};

const usd = (cents: number) => (cents / 100).toFixed(2);

function makeCard(
  set: { code: string; name: string },
  n: number,
  name: string,
  rarity: Rarity,
  rng: Rng,
  extra: Partial<SimCard> = {},
): SimCard {
  const [lo, hi] = PRICE[rarity];
  const base = Math.max(lo, Math.round(lo + (hi - lo) * rng() ** 3));
  const fun = extra.boosterFun ? between(rng, 15, 30) / 10 : 1;
  const nonfoil = Math.round(base * fun);
  const foil = Math.round(nonfoil * (between(rng, 12, 30) / 10));
  const id = `sim-${set.code.toLowerCase()}-${n}`;
  return {
    id,
    name,
    lang: 'en',
    set: set.code.toLowerCase(),
    set_name: set.name,
    collector_number: String(n),
    released_at: '2026-10-03',
    digital: false,
    finishes: ['nonfoil', 'foil'],
    image_uris: { small: `https://img.test/${id}-s.jpg`, normal: `https://img.test/${id}.jpg` } as never,
    prints_search_uri: `https://api.test/prints/${id}`,
    type_line: extra.basic ? `Basic Land — ${name}` : rarity === 'common' ? 'Instant' : 'Creature — Simulant',
    color_identity: [],
    rarity,
    layout: 'normal',
    prices: {
      usd: usd(nonfoil),
      usd_foil: usd(foil),
      usd_etched: null,
      eur: usd(nonfoil * 0.9),
      eur_foil: usd(foil * 0.9),
      eur_etched: null,
    },
    boosterFun: false,
    basic: false,
    ...extra,
  };
}

export function makeSet(code = 'SIM', name = 'Simulated Expansion', seed = 1): SimSet {
  const rng = seeded(seed);
  const set = { code, name };
  const cards: SimCard[] = [];
  let n = 0;
  const names = new Set<string>();
  const freshName = (spell: boolean) => {
    for (;;) {
      const a = ADJ[Math.floor(rng() * ADJ.length)];
      const b = spell ? SPELL[Math.floor(rng() * SPELL.length)] : NOUN[Math.floor(rng() * NOUN.length)];
      const nm = rng() < 0.4 ? `${a} ${b}` : `${a} ${b} of ${ADJ[Math.floor(rng() * ADJ.length)]}`;
      if (!names.has(nm)) {
        names.add(nm);
        return nm;
      }
    }
  };
  const counts: [Rarity, number][] = [
    ['common', 100],
    ['uncommon', 80],
    ['rare', 60],
    ['mythic', 20],
  ];
  for (const [r, count] of counts)
    for (let i = 0; i < count; i++) cards.push(makeCard(set, ++n, freshName(r === 'common'), r, rng));
  for (let i = 0; i < 10; i++) cards.push(makeCard(set, ++n, BASICS[i % 5], 'common', rng, { basic: true }));
  const funFrom = cards.filter((c) => !c.basic && c.rarity !== 'common' && rng() < 0.5);
  for (const c of funFrom) cards.push(makeCard(set, ++n, c.name, c.rarity, rng, { boosterFun: true }));

  return {
    code,
    name,
    cards,
    byRarity: (r, opts = {}) => cards.filter((c) => c.rarity === r && !c.basic && c.boosterFun === !!opts.boosterFun),
    basics: cards.filter((c) => c.basic),
    byNumber: (num) => cards.find((c) => c.collector_number === num),
  };
}
