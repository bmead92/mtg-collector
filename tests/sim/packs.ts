import type { Finish } from '../../src/lib/scryfall';
import type { Rarity, SimCard, SimSet } from './catalog';
import { pick, type Rng } from './rng';

export interface Pull {
  card: SimCard;
  finish: Finish;
}
export type Pack = Pull[];
export type PackKind = 'play' | 'collector';

const rareOrMythic = (rng: Rng): Rarity => (rng() < 1 / 7 ? 'mythic' : 'rare');
const anyRarity = (rng: Rng): Rarity => {
  const x = rng();
  return x < 0.55 ? 'common' : x < 0.85 ? 'uncommon' : x < 0.97 ? 'rare' : 'mythic';
};
const one = (set: SimSet, rng: Rng, r: Rarity, finish: Finish = 'nonfoil', boosterFun = false): Pull => {
  const pool = set.byRarity(r, { boosterFun });
  return { card: pick(rng, pool.length ? pool : set.byRarity(r)), finish };
};

export function playBooster(set: SimSet, rng: Rng): Pack {
  const pack: Pack = [];
  for (let i = 0; i < 7; i++) pack.push(one(set, rng, 'common'));
  for (let i = 0; i < 3; i++) pack.push(one(set, rng, 'uncommon'));
  pack.push(one(set, rng, rareOrMythic(rng)));
  pack.push(one(set, rng, anyRarity(rng)));
  pack.push(one(set, rng, anyRarity(rng), 'foil'));
  pack.push({ card: pick(rng, set.basics), finish: rng() < 0.2 ? 'foil' : 'nonfoil' });
  return pack;
}

export function collectorBooster(set: SimSet, rng: Rng): Pack {
  const pack: Pack = [];
  for (let i = 0; i < 5; i++) pack.push(one(set, rng, 'common', 'foil'));
  for (let i = 0; i < 3; i++) pack.push(one(set, rng, 'uncommon', 'foil'));
  pack.push({ card: pick(rng, set.basics), finish: 'foil' });
  for (let i = 0; i < 2; i++) pack.push(one(set, rng, 'uncommon', rng() < 0.5 ? 'foil' : 'nonfoil', true));
  pack.push(one(set, rng, rareOrMythic(rng), 'nonfoil', true));
  pack.push(one(set, rng, rareOrMythic(rng), 'nonfoil', true));
  pack.push(one(set, rng, rareOrMythic(rng), 'foil'));
  pack.push(one(set, rng, rareOrMythic(rng), 'foil', true));
  return pack;
}

export const PACKS_PER_BOX: Record<PackKind, number> = { play: 30, collector: 12 };

export function openPack(set: SimSet, rng: Rng, kind: PackKind): Pack {
  return kind === 'play' ? playBooster(set, rng) : collectorBooster(set, rng);
}

export function openBox(set: SimSet, rng: Rng, kind: PackKind, packs = PACKS_PER_BOX[kind]): Pack[] {
  return Array.from({ length: packs }, () => openPack(set, rng, kind));
}

export function packValue(pack: Pack): number {
  return pack.reduce((sum, { card, finish }) => {
    const p = finish === 'foil' ? card.prices?.usd_foil : card.prices?.usd;
    return sum + (p ? Math.round(parseFloat(p) * 100) : 0);
  }, 0);
}
