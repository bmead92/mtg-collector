import type { Finish } from './scryfall';

export interface DeckLine {
  quantity: number;
  name: string;
  set: string | null;
  number: string | null;
  finish: Finish | null;
}

const SECTION = /^(?:\/\/\s*)?(deck|main\s*deck|mainboard|main|commanders?|companions?|sideboard|side\s*board|maybeboard|maybe|considering|tokens?|attractions|stickers|planes|schemes)\s*:?\s*(?:\(\d+\))?$/i;
const SKIPPED_SECTIONS = /^(maybeboard|maybe|considering|tokens?)$/i;
const SKIPPED_CATEGORIES = /maybeboard|considering|\{nodeck\}|tokens?/i;

export function parseDeckText(text: string): { lines: DeckLine[]; unreadable: string[] } {
  const merged = new Map<string, DeckLine>();
  const unreadable: string[] = [];
  let skipSection = false;
  for (const raw of text.split(/\r?\n/)) {
    let line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const section = line.match(SECTION);
    if (section) {
      skipSection = SKIPPED_SECTIONS.test(section[1].replace(/\s+/g, ''));
      continue;
    }
    if (line.startsWith('//')) continue;
    if (skipSection) continue;

    line = line.replace(/\^[^^]*\^/g, ' ');
    const categories = [...line.matchAll(/\[([^\]]*)\]/g)].map((m) => m[1]).join(' ');
    if (categories && SKIPPED_CATEGORIES.test(categories)) continue;
    line = line.replace(/\[[^\]]*\]/g, ' ');
    const flags = [...line.matchAll(/\*([A-Za-z]+)\*/g)].map((m) => m[1].toUpperCase());
    line = line.replace(/\*[A-Za-z]+\*/g, ' ').replace(/\s+/g, ' ').trim();

    const qty = line.match(/^(\d+)\s*x?\s+(.+)$/i);
    const quantity = qty ? Number(qty[1]) : 1;
    let rest = qty ? qty[2] : line;
    let set: string | null = null;
    let number: string | null = null;
    const printing = rest.match(/^(.+?)\s+\(([A-Za-z0-9]{2,6})\)(?:\s+(\S+))?$/);
    if (printing) {
      rest = printing[1];
      set = printing[2].toLowerCase();
      number = printing[3] ?? null;
    }
    const name = rest.replace(/\s+\/\s+/g, ' // ').trim();
    if (!name || quantity < 1 || /^\d+$/.test(name)) {
      unreadable.push(raw.trim());
      continue;
    }
    const finish: Finish | null = flags.includes('E') ? 'etched' : flags.includes('F') ? 'foil' : null;
    const key = [name.toLowerCase(), set, number, finish].join('|');
    const prev = merged.get(key);
    if (prev) prev.quantity += quantity;
    else merged.set(key, { quantity: Math.min(quantity, 999), name, set, number, finish });
  }
  return { lines: [...merged.values()], unreadable };
}
