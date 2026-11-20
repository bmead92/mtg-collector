import { cardBySetAndNumber, type ScryfallCard } from './scryfall';

export const PRINTED_LANG: Record<string, string> = {
  EN: 'en',
  SP: 'es',
  FR: 'fr',
  DE: 'de',
  IT: 'it',
  PT: 'pt',
  JP: 'ja',
  KR: 'ko',
  RU: 'ru',
  CS: 'zhs',
  CT: 'zht',
  PH: 'ph',
};

const PRINTED_BY_LANG = Object.fromEntries(Object.entries(PRINTED_LANG).map(([k, v]) => [v, k]));

export function langLabel(lang: string | null | undefined): string {
  if (!lang || lang === 'en') return '';
  return PRINTED_BY_LANG[lang] ?? lang.toUpperCase();
}

export const isForeign = (c: { lang?: string | null } | null | undefined) => !!c?.lang && c.lang !== 'en';

export async function pricingPrinting(card: ScryfallCard): Promise<ScryfallCard> {
  if (!isForeign(card)) return card;
  try {
    return (await cardBySetAndNumber(card.set, card.collector_number)) ?? card;
  } catch {
    return card;
  }
}
