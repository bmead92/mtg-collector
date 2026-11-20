import type { CardGuess } from './ocr';
import { cardByFuzzyName, cardByNameInSet, cardBySetAndNumber, type Finish, type ScryfallCard } from './scryfall';

export type MatchMethod = 'set+number' | 'name+set' | 'name' | 'none';

export interface Identification {
  card: ScryfallCard | null;
  method: MatchMethod;
  foil: boolean;
}

export function defaultFinish(card: ScryfallCard, foil = false): Finish {
  if (foil && card.finishes.includes('foil')) return 'foil';
  return card.finishes.includes('nonfoil') ? 'nonfoil' : card.finishes[0];
}

const TOKEN_TYPE_LINE = /\btoken (legendary |snow )?(creature|artifact|enchantment|land)\b/i;
const isToken = (c: ScryfallCard) => c.layout === 'token' || TOKEN_TYPE_LINE.test(c.type_line ?? '');

const letters = (s: string) => s.toLowerCase().replace(/[^a-z]/g, '');

export function nameAppearsIn(cardName: string, rawText: string): boolean {
  const haystack = letters(rawText);
  return cardName
    .split(' // ')
    .map(letters)
    .some((face) => face.length >= 4 && haystack.includes(face));
}

export async function identify(guess: CardGuess): Promise<Identification> {
  let setCode = guess.setCode;
  let foil = guess.foil;

  if (guess.lang && guess.lang !== 'en' && setCode && guess.collectorNumber) {
    const foreign =
      (await cardBySetAndNumber(setCode, guess.collectorNumber, guess.lang)) ??
      (await cardBySetAndNumber(setCode, guess.collectorNumber));
    if (foreign) return { card: foreign, method: 'set+number', foil };
  }

  let exact = setCode && guess.collectorNumber ? await cardBySetAndNumber(setCode, guess.collectorNumber) : null;

  if (!exact && setCode && setCode.length >= 4 && guess.collectorNumber) {
    const trimmed = setCode.slice(0, -1);
    const retry = await cardBySetAndNumber(trimmed, guess.collectorNumber);
    if (retry) {
      exact = retry;
      setCode = trimmed;
      foil = true;
    }
  }

  if (exact && setCode && guess.collectorNumber && TOKEN_TYPE_LINE.test(guess.rawText) && !isToken(exact)) {
    const token = await cardBySetAndNumber(`t${setCode}`, guess.collectorNumber);
    if (token) exact = token;
  }

  const byName = guess.name ? await cardByFuzzyName(guess.name) : null;

  if (exact && (!byName || byName.name === exact.name)) return { card: exact, method: 'set+number', foil };

  if (exact && byName) {
    const exactSeen = nameAppearsIn(exact.name, guess.rawText);
    const nameSeen = nameAppearsIn(byName.name, guess.rawText);
    if (exactSeen && !nameSeen) return { card: exact, method: 'set+number', foil };
  }

  if (setCode && guess.collectorNumber) {
    const token = await cardBySetAndNumber(`t${setCode}`, guess.collectorNumber);
    if (token && (!byName || byName.name === token.name || nameAppearsIn(token.name, guess.rawText))) {
      return { card: token, method: 'set+number', foil };
    }
  }

  if (byName && setCode) {
    const inSet = await cardByNameInSet(byName.name, setCode, guess.collectorNumber);
    if (inSet) return { card: inSet, method: 'name+set', foil };
  }
  if (byName) return { card: byName, method: 'name', foil };
  if (exact) return { card: exact, method: 'set+number', foil };
  return { card: null, method: 'none', foil };
}
