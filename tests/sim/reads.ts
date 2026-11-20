import type { CardGuess } from '../../src/lib/ocr';
import type { Pull } from './packs';
import type { Rng } from './rng';

export interface ReadNoise {
  typo: number;
  missLine: number;
  foilStarSeen: number;
}

export const TYPICAL_NOISE: ReadNoise = { typo: 0.15, missLine: 0.25, foilStarSeen: 0.3 };
export const CLEAN: ReadNoise = { typo: 0, missLine: 0, foilStarSeen: 1 };

const SWAPS: Record<string, string> = { l: '1', o: '0', i: 'l', e: 'c', n: 'm', S: '5', a: 'o' };

function garble(name: string, rng: Rng): string {
  const idx = [...name].map((ch, i) => (SWAPS[ch] ? i : -1)).filter((i) => i >= 0);
  if (!idx.length) return name;
  const i = idx[Math.floor(rng() * idx.length)];
  return name.slice(0, i) + SWAPS[name[i]] + name.slice(i + 1);
}

export function frameRead({ card, finish }: Pull, rng: Rng, noise: ReadNoise = TYPICAL_NOISE): CardGuess {
  const name = rng() < noise.typo ? garble(card.name, rng) : card.name;
  const line = rng() >= noise.missLine;
  const star = finish === 'foil' && rng() < noise.foilStarSeen;
  const set = card.set.toUpperCase();
  const rarity = card.rarity[0].toUpperCase();
  const lineText = line ? `${card.collector_number.padStart(4, '0')} ${rarity}\n${set} ${star ? '★' : '•'} EN` : '';
  return {
    name,
    setCode: line ? set : null,
    collectorNumber: line ? card.collector_number : null,
    foil: star,
    rawText: [name, card.type_line ?? '', 'Some rules text.', lineText].filter(Boolean).join('\n'),
  };
}

export function frameReads(pull: Pull, rng: Rng, noise: ReadNoise = TYPICAL_NOISE): CardGuess[] {
  const n = 2 + Math.floor(rng() * 3);
  return Array.from({ length: n }, () => frameRead(pull, rng, noise));
}
