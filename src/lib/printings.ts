import type { ScryfallCard } from './scryfall';
import { fold } from './setList';

const EFFECTS: Record<string, string> = {
  showcase: 'Showcase',
  extendedart: 'Extended art',
  etched: 'Etched',
  shatteredglass: 'Shattered glass',
};
const PROMOS: Record<string, string> = {
  serialized: 'Serialized',
  surgefoil: 'Surge foil',
  galaxyfoil: 'Galaxy foil',
  textured: 'Textured foil',
  confettifoil: 'Confetti foil',
  halofoil: 'Halo foil',
  stepandcompleat: 'Step-and-compleat foil',
  oilslick: 'Oil slick',
  rainbowfoil: 'Rainbow foil',
  doublerainbow: 'Double rainbow',
  fracturefoil: 'Fracture foil',
  ripplefoil: 'Ripple foil',
  manafoil: 'Mana foil',
  prerelease: 'Prerelease',
  buyabox: 'Buy-a-box',
  bundle: 'Bundle promo',
  boosterfun: '',
};

export function printingTags(c: ScryfallCard): string[] {
  const tags: string[] = [];
  if (c.border_color === 'borderless') tags.push('Borderless');
  for (const e of c.frame_effects ?? []) if (EFFECTS[e]) tags.push(EFFECTS[e]);
  if (c.full_art && c.border_color !== 'borderless') tags.push('Full art');
  if ((c.frame === '1993' || c.frame === '1997') && (c.released_at ?? '') >= '2020') tags.push('Retro frame');
  for (const p of c.promo_types ?? []) if (PROMOS[p]) tags.push(PROMOS[p]);
  if (c.flavor_name) tags.push(c.flavor_name);
  return [...new Set(tags)];
}

export function searchPrintings(prints: ScryfallCard[], query: string): ScryfallCard[] {
  const words = fold(query).trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return prints;
  return prints.filter((c) => {
    const text = fold([c.set_name, ...printingTags(c), ...c.finishes].join(' ')).split(/\s+/).filter(Boolean);
    const exact = [c.set.toLowerCase(), c.collector_number.toLowerCase(), (c.released_at ?? '').slice(0, 4)];
    return words.every((w) => exact.includes(w) || text.some((t) => t.startsWith(w)));
  });
}
