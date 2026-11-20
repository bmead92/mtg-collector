import type { SealedProduct } from './sealed';
import { fold } from './setList';

export interface PreconEntry {
  code: string;
  fileName: string;
  name: string;
  releaseDate: string;
  type: string;
}

export interface PreconCard {
  scryfallId: string;
  name: string;
  quantity: number;
  foil: boolean;
}

const DIGITAL = /mtgo|arena|shandalar|duel of the planeswalkers|historic brawl|halfdeck|dandan|^enemy deck$/i;

export function slimDeckList(rows: unknown[]): PreconEntry[] {
  const out: PreconEntry[] = [];
  for (const r of rows) {
    if (!r || typeof r !== 'object') continue;
    const x = r as Record<string, unknown>;
    if (typeof x.fileName !== 'string' || typeof x.name !== 'string' || typeof x.type !== 'string') continue;
    if (DIGITAL.test(x.type)) continue;
    out.push({
      code: typeof x.code === 'string' ? x.code : '',
      fileName: x.fileName,
      name: x.name,
      releaseDate: typeof x.releaseDate === 'string' ? x.releaseDate : '',
      type: x.type,
    });
  }
  const rank = (p: PreconEntry) => (p.type === 'Commander Deck' ? 0 : 1);
  return out.sort((a, b) => rank(a) - rank(b) || b.releaseDate.localeCompare(a.releaseDate) || a.name.localeCompare(b.name));
}

export function searchPrecons(list: PreconEntry[], query: string): PreconEntry[] {
  const words = fold(query).trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return list;
  return list.filter((p) => {
    const text = fold(`${p.name} ${p.type}`).split(/\s+/).filter(Boolean);
    return words.every(
      (w) => p.code.toLowerCase() === w || p.releaseDate.startsWith(w) || text.some((t) => t.startsWith(w)),
    );
  });
}

const BOARDS = ['commander', 'mainBoard', 'sideBoard'];

export function preconCards(deck: Record<string, unknown>): PreconCard[] {
  const merged = new Map<string, PreconCard>();
  for (const board of BOARDS) {
    const list = deck[board];
    if (!Array.isArray(list)) continue;
    for (const c of list as Record<string, unknown>[]) {
      const id = (c.identifiers as Record<string, unknown> | undefined)?.scryfallId;
      if (typeof id !== 'string' || typeof c.name !== 'string') continue;
      const foil = c.isFoil === true;
      const quantity = typeof c.count === 'number' && c.count > 0 ? c.count : 1;
      const key = `${id}|${foil}`;
      const prev = merged.get(key);
      if (prev) prev.quantity += quantity;
      else merged.set(key, { scryfallId: id, name: c.name, quantity, foil });
    }
  }
  return [...merged.values()];
}

export function preconProduct(catalog: SealedProduct[], precon: Pick<PreconEntry, 'name' | 'code'>): SealedProduct | null {
  const want = fold(precon.name).trim();
  if (!want) return null;
  const matches = catalog.filter((p) => {
    const name = fold(p.name);
    return ` ${name} `.includes(` ${want} `) && !/collector s edition|set of|case/.test(name);
  });
  matches.sort(
    (a, b) =>
      Number(b.set_code.toUpperCase() === precon.code.toUpperCase()) - Number(a.set_code.toUpperCase() === precon.code.toUpperCase()) ||
      a.name.length - b.name.length,
  );
  return matches[0] ?? null;
}
