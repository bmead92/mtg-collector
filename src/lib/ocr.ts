import { NitroModules } from 'react-native-nitro-modules';
import { PRINTED_LANG } from './language';
import type { Text, TextRecognizer } from 'react-native-vision-camera-ocr-plus';

export interface CardGuess {
  name: string | null;
  setCode: string | null;
  lang?: string | null;
  collectorNumber: string | null;
  foil: boolean;
  rawText: string;
  turns?: number;
  nameBox?: { x: number; y: number; h: number };
}

let recognizer: TextRecognizer | null = null;
function getRecognizer(): TextRecognizer {
  if (!recognizer) recognizer = NitroModules.createHybridObject<TextRecognizer>('TextRecognizer');
  return recognizer;
}

export async function recognizeText(photoUri: string): Promise<Text> {
  const uri = /^[a-z][a-z0-9+.-]*:\/\//i.test(photoUri) ? photoUri : `file://${photoUri}`;
  return (await getRecognizer().recognizePhoto(uri, 'portrait')) as Text;
}

export async function recognizeCard(photoUri: string): Promise<CardGuess> {
  return parseCardText(await recognizeText(photoUri));
}

export function isSetLangLine(text: string): boolean {
  return matchSetLang(text) != null;
}

export function matchSetLang(text: string): { setCode: string; sep: string | undefined; lang: string } | null {
  const en = text.toUpperCase().match(SET_LANG);
  if (en && /[A-Z]/.test(en[1])) return { setCode: en[1], sep: en[2], lang: 'en' };
  const other = text.match(SET_OTHER_LANG);
  if (other && /[A-Z]/.test(other[1])) return { setCode: other[1], sep: other[2], lang: PRINTED_LANG[other[3]] };
  return null;
}

interface Line {
  text: string;
  x: number;
  y: number;
  h: number;
}

const FOIL_STARS = '*★☆✩✪⋆✱✦';
const SET_LANG = /\b([A-Z0-9]{3,5})(?:\s*([•·*.,:\-+★☆✩✪⋆✱✦])\s*|\s+)EN\b/;
const SET_OTHER_LANG = /\b([A-Z0-9]{3,5})(?:\s*([•·*.,:\-+★☆✩✪⋆✱✦])\s*|\s+)(SP|FR|DE|IT|PT|JP|KR|RU|CS|CT|PH)\b/;
const NUM_THEN_RARITY = /(?:^|\s)([0-9OIl]{1,4})(?:\s*\/\s*[0-9OIl]{1,4})?\s*([CURMSLTP])\b/;
const RARITY_THEN_NUM = /(?:^|\s)([CURMSLTP])\s+([0-9OIl]{1,4})\b/;
const COPYRIGHT = /©|wizards|™/i;

function digits(token: string): string {
  return token.replace(/[Oo]/g, '0').replace(/[Il]/g, '1');
}

type RawLine = Text['blocks'][number]['lines'][number];

export function textTurns(raw: RawLine[]): number {
  let sx = 0;
  let sy = 0;
  for (const l of raw) {
    const p = l.lineCornerPoints;
    if (!p || p.length < 2 || l.lineText.trim().length < 4) continue;
    sx += p[1].x - p[0].x;
    sy += p[1].y - p[0].y;
  }
  if (sx === 0 && sy === 0) return 0;
  return (((Math.round(Math.atan2(sy, sx) / (Math.PI / 2)) % 4) + 4) % 4) as 0 | 1 | 2 | 3;
}

function unrotate(x: number, y: number, turns: number): [number, number] {
  switch (turns) {
    case 1:
      return [y, -x];
    case 2:
      return [-x, -y];
    case 3:
      return [-y, x];
    default:
      return [x, y];
  }
}

function uprightLines(raw: RawLine[], turns: number): Line[] {
  return raw
    .map((l) => {
      const text = l.lineText.trim();
      const pts =
        l.lineCornerPoints?.length === 4
          ? l.lineCornerPoints
          : [
              { x: l.lineFrame.x, y: l.lineFrame.y },
              { x: l.lineFrame.x + l.lineFrame.width, y: l.lineFrame.y + l.lineFrame.height },
            ];
      if (turns === 0 && !l.lineCornerPoints?.length)
        return { text, x: l.lineFrame.x, y: l.lineFrame.y, h: l.lineFrame.height };
      const r = pts.map((p) => unrotate(p.x, p.y, turns));
      const xs = r.map((p) => p[0]);
      const ys = r.map((p) => p[1]);
      return { text, x: Math.min(...xs), y: Math.min(...ys), h: Math.max(...ys) - Math.min(...ys) };
    })
    .filter((l) => l.text.length > 0);
}

export function parseCardText(result: Text): CardGuess {
  const raw = result.blocks.flatMap((b) => b.lines);
  const turns = textTurns(raw);
  const lines: Line[] = uprightLines(raw, turns);

  const guess: CardGuess = {
    name: null,
    setCode: null,
    collectorNumber: null,
    foil: false,
    rawText: result.resultText,
    turns,
  };
  if (lines.length === 0) return guess;

  const top = Math.min(...lines.map((l) => l.y));
  const bottom = Math.max(...lines.map((l) => l.y + l.h));
  const height = Math.max(bottom - top, 1);
  const rel = (l: Line) => (l.y - top) / height;

  const bottomLines = lines.filter((l) => rel(l) > 0.66 && !COPYRIGHT.test(l.text)).sort((a, b) => a.y - b.y);

  let setLineIndex = -1;
  for (let i = 0; i < bottomLines.length; i++) {
    const m = matchSetLang(bottomLines[i].text);
    if (m) {
      guess.setCode = m.setCode;
      guess.lang = m.lang;
      guess.foil = !!m.sep && FOIL_STARS.includes(m.sep);
      setLineIndex = i;
      break;
    }
  }

  const candidates =
    setLineIndex >= 0
      ? [bottomLines[setLineIndex - 1], bottomLines[setLineIndex], ...bottomLines].filter(Boolean)
      : bottomLines;
  for (const l of candidates) {
    const m1 = l.text.match(NUM_THEN_RARITY);
    if (m1 && /\d/.test(m1[1])) {
      guess.collectorNumber = stripLeadingZeros(digits(m1[1]));
      break;
    }
    const m2 = l.text.match(RARITY_THEN_NUM);
    if (m2 && /\d/.test(m2[2])) {
      guess.collectorNumber = stripLeadingZeros(digits(m2[2]));
      break;
    }
  }

  if (!guess.collectorNumber && setLineIndex > 0) {
    const above = bottomLines[setLineIndex - 1].text.trim();
    if (/^[0-9OIl]{1,4}$/.test(above) && /\d/.test(above)) guess.collectorNumber = stripLeadingZeros(digits(above));
  }

  const topLines = lines.filter((l) => rel(l) < 0.2).sort((a, b) => a.y - b.y || a.x - b.x);
  for (const l of topLines) {
    const cleaned = cleanName(l.text);
    if (cleaned) {
      guess.name = cleaned;
      guess.nameBox = { x: l.x, y: l.y, h: l.h };
      break;
    }
  }

  return guess;
}

function stripLeadingZeros(n: string): string {
  return n.replace(/^0+(?=\d)/, '');
}

function cleanName(raw: string): string | null {
  let s = raw
    .replace(/[^A-Za-z0-9 ,'\-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  s = s.replace(/(\s+([0-9WUBRGCX]{1,8}|[A-Za-z]))+$/, '').trim();
  const letters = (s.match(/[A-Za-z]/g) ?? []).length;
  if (letters < 3 || letters / s.length < 0.6) return null;
  return s;
}
