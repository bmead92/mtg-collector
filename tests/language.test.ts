import './sim/mocks';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Text } from 'react-native-vision-camera-ocr-plus';
import { cardKey, isCompleteRead, mergeReads, sameCard } from '../src/lib/autoScan';
import { langLabel } from '../src/lib/language';
import { matchSetLang, parseCardText, parseCollectorStrip, type CardGuess } from '../src/lib/ocr';

function ocr(lines: string[]): Text {
  const step = 880 / lines.length;
  const toLine = (text: string, i: number) => {
    const y = i * step;
    return {
      lineText: text,
      lineCornerPoints: [
        { x: 20, y },
        { x: 600, y },
        { x: 600, y: y + 30 },
        { x: 20, y: y + 30 },
      ],
      lineFrame: { x: 20, y, width: 580, height: 30, boundingCenterX: 310, boundingCenterY: y + 15 },
      lineLanguages: [],
      elements: [],
    };
  };
  return {
    resultText: lines.join('\n'),
    blocks: [{ blockText: lines.join('\n'), blockCornerPoints: [], blockFrame: {}, lines: lines.map(toLine) }],
  } as unknown as Text;
}

describe('collector line in any language', () => {
  it.each([
    ['MOM • EN', 'MOM', 'en'],
    ['mom • en', 'MOM', 'en'],
    ['MOM • JP', 'MOM', 'ja'],
    ['ONE • SP', 'ONE', 'es'],
    ['DMU ★ DE', 'DMU', 'de'],
    ['WOE • FR', 'WOE', 'fr'],
    ['LCI • KR', 'LCI', 'ko'],
    ['MKM • CS', 'MKM', 'zhs'],
    ['MKM • CT', 'MKM', 'zht'],
    ['BRO • RU', 'BRO', 'ru'],
    ['SNC • PT', 'SNC', 'pt'],
    ['FDN • IT', 'FDN', 'it'],
  ])('%s → %s / %s', (text, setCode, lang) => {
    expect(matchSetLang(text)).toMatchObject({ setCode, lang });
  });

  it("doesn't mistake rules text for a collector line", () => {
    expect(matchSetLang('return it to your hand it')).toBeNull();
    expect(matchSetLang('Put the card into your hand de')).toBeNull();
    expect(matchSetLang('BETWEEN')).toBeNull();
  });

  it('parses a Japanese card: no readable name, set + number + language from the collector line', () => {
    const g = parseCardText(
      ocr(['', 'クリーチャー', '', '', '', '', '', '', '0001 M', 'MOM • JP  Artist Name']),
    );
    expect(g).toMatchObject({ setCode: 'MOM', collectorNumber: '1', lang: 'ja' });
  });

  it('labels', () => {
    expect(langLabel('ja')).toBe('JP');
    expect(langLabel('es')).toBe('SP');
    expect(langLabel('en')).toBe('');
    expect(langLabel(null)).toBe('');
  });
});

const read = (p: Partial<CardGuess>): CardGuess => ({ name: null, setCode: null, collectorNumber: null, foil: false, rawText: 'a\nb\nc\nd', ...p });

describe('Auto mode with unreadable names', () => {
  it('tracks a foreign card by its collector line', () => {
    const k = cardKey(read({ setCode: 'MOM', collectorNumber: '1', lang: 'ja' }));
    expect(k).toBe('#MOM#1');
    expect(sameCard(k, '#MOM#1')).toBe(true);
    expect(sameCard(k, '#MOM#7')).toBe(false); // one digit apart is a different card
  });

  it('an English read without a name is still ignored (could be anything)', () => {
    expect(cardKey(read({ setCode: 'MOM', collectorNumber: '1', lang: 'en' }))).toBeNull();
  });

  it('two agreeing collector lines are enough to skip the photo for a foreign card', () => {
    const m = mergeReads([read({ setCode: 'MOM', collectorNumber: '1', lang: 'ja' }), read({ setCode: 'MOM', collectorNumber: '1', lang: 'ja' })]);
    expect(m).toMatchObject({ lang: 'ja', numberVotes: 2 });
    expect(isCompleteRead(m)).toBe(true);
  });
});

describe('identify and price a foreign card (real Scryfall request shapes)', () => {
  beforeEach(() => vi.unstubAllGlobals());

  it('asks Scryfall for the language printing, prices it from the English one', async () => {
    const calls: string[] = [];
    const cards: Record<string, object> = {
      '/cards/mom/1/ja': { id: 'ja-1', name: 'Invasion of Ravnica // Guildpact Paragon', lang: 'ja', set: 'mom', collector_number: '1', finishes: ['nonfoil'], prices: { usd: null } },
      '/cards/mom/1': { id: 'en-1', name: 'Invasion of Ravnica // Guildpact Paragon', lang: 'en', set: 'mom', collector_number: '1', finishes: ['nonfoil'], prices: { usd: '0.22' } },
    };
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        const path = new URL(url).pathname;
        calls.push(path);
        const body = cards[path];
        return new Response(JSON.stringify(body ?? { object: 'error' }), { status: body ? 200 : 404 });
      }),
    );
    const real = await vi.importActual<typeof import('../src/lib/identify')>('../src/lib/identify');
    const { pricingPrinting } = await import('../src/lib/language');
    const r = await real.identify({ name: null, setCode: 'MOM', collectorNumber: '1', lang: 'ja', foil: false, rawText: '' });
    expect(r).toMatchObject({ method: 'set+number' });
    expect(r.card?.id).toBe('ja-1');
    const pc = await pricingPrinting(r.card!);
    expect(pc.id).toBe('en-1');
    expect(calls).toEqual(['/cards/mom/1/ja', '/cards/mom/1']);
  });
});

describe('collector strip read', () => {
  it('reads the set and number from the enlarged bottom strip', () => {
    expect(parseCollectorStrip(ocr(['0158 R', 'FIN • EN  Artist Name', '™ & © 2025 Wizards of the Coast']))).toMatchObject({
      setCode: 'FIN',
      collectorNumber: '158',
      lang: 'en',
      foil: false,
    });
  });

  it('finds nothing in a strip without a collector line', () => {
    expect(parseCollectorStrip(ocr(['Flying', 'When this enters']))).toMatchObject({ setCode: null, collectorNumber: null });
  });
});
