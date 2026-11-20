import { USER_AGENT } from './appInfo';
import { createSource, getSetting, insertScans, listScans, setSetting, type NewScan } from './db';
import type { DeckLine } from './deckText';
import { getSinglesByScryfallId, headlinePrice, quoteFor } from './manapool';
import { preconCards, slimDeckList, type PreconEntry } from './precons';
import { serializePrices } from './prices';
import { cardImage, cardMeta, cardsByIdentifiers, type CardIdentifier, type Finish, type ScryfallCard } from './scryfall';
import type { NewSource } from './sources';

const MTGJSON = 'https://mtgjson.com/api/v5';
const LIST_KEY = 'mtgjson.decklist';
const WEEK = 7 * 86_400_000;

export interface ImportItem {
  card: ScryfallCard;
  quantity: number;
  finish: Finish;
  priceCents: number | null;
  marketCents: number | null;
  lowCents: number | null;
  url: string | null;
  owned: number;
}

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' } });
  if (!res.ok) throw new Error(`Request failed (${res.status})`);
  return (await res.json()) as T;
}

export async function getPreconList(): Promise<PreconEntry[]> {
  const cached = await getSetting<{ at: number; list: PreconEntry[] }>(LIST_KEY);
  if (cached && Date.now() - cached.at < WEEK) return slimDeckList(cached.list);
  try {
    const body = await getJson<{ data: unknown[] }>(`${MTGJSON}/DeckList.json`);
    const list = slimDeckList(body.data);
    await setSetting(LIST_KEY, { at: Date.now(), list });
    return list;
  } catch (e) {
    if (cached) return slimDeckList(cached.list);
    throw e;
  }
}

export async function loadPrecon(p: PreconEntry): Promise<ImportItem[]> {
  const body = await getJson<{ data: Record<string, unknown> }>(`${MTGJSON}/decks/${encodeURIComponent(p.fileName)}.json`);
  const cards = preconCards(body.data);
  const { found } = await cardsByIdentifiers(cards.map((c) => ({ id: c.scryfallId })));
  const byId = new Map(found.map((c) => [c.id, c]));
  return priceItems(
    cards.flatMap((c) => {
      const card = byId.get(c.scryfallId);
      return card ? [{ card, quantity: c.quantity, finish: finishFor(card, c.foil ? 'foil' : null) }] : [];
    }),
  );
}

const lower = (s: string) => s.toLowerCase();
const faceNames = (c: ScryfallCard) => [c.name, ...(c.card_faces ?? []).map((f) => f.name)].map(lower);

function identifierFor(l: DeckLine): CardIdentifier {
  if (l.set && l.number) return { set: l.set, collector_number: l.number };
  if (l.set) return { name: l.name, set: l.set };
  return { name: l.name };
}

function matches(card: ScryfallCard, l: DeckLine, useSet: boolean): boolean {
  if (useSet && l.set && l.number) return card.set === l.set && card.collector_number === l.number;
  if (useSet && l.set && card.set !== l.set) return false;
  return faceNames(card).includes(lower(l.name)) || lower(card.name).startsWith(`${lower(l.name)} //`);
}

export async function resolveDeckLines(lines: DeckLine[]): Promise<{ items: ImportItem[]; missing: DeckLine[] }> {
  const first = await cardsByIdentifiers(lines.map(identifierFor));
  const resolved = new Map<DeckLine, ScryfallCard>();
  for (const l of lines) {
    const card = first.found.find((c) => matches(c, l, true));
    if (card) resolved.set(l, card);
  }
  const retry = lines.filter((l) => !resolved.has(l) && l.set);
  if (retry.length) {
    const second = await cardsByIdentifiers(retry.map((l) => ({ name: l.name })));
    for (const l of retry) {
      const card = second.found.find((c) => matches(c, l, false));
      if (card) resolved.set(l, card);
    }
  }
  const items = await priceItems(
    lines.flatMap((l) => {
      const card = resolved.get(l);
      return card ? [{ card, quantity: l.quantity, finish: finishFor(card, l.finish) }] : [];
    }),
  );
  return { items, missing: lines.filter((l) => !resolved.has(l)) };
}

function finishFor(card: ScryfallCard, wanted: Finish | null): Finish {
  if (wanted && card.finishes.includes(wanted)) return wanted;
  if (wanted === 'foil' && card.finishes.includes('etched')) return 'etched';
  return card.finishes.includes('nonfoil') ? 'nonfoil' : card.finishes[0];
}

async function priceItems(list: { card: ScryfallCard; quantity: number; finish: Finish }[]): Promise<ImportItem[]> {
  const merged = new Map<string, { card: ScryfallCard; quantity: number; finish: Finish }>();
  for (const x of list) {
    const key = `${x.card.id}|${x.finish}`;
    const prev = merged.get(key);
    if (prev) prev.quantity += x.quantity;
    else merged.set(key, { ...x });
  }
  const [singles, scans] = await Promise.all([
    getSinglesByScryfallId([...merged.values()].map((x) => x.card.id)),
    listScans(),
  ]);
  const owned = new Map<string, number>();
  for (const s of scans) owned.set(`${s.scryfall_id}|${s.finish}`, (owned.get(`${s.scryfall_id}|${s.finish}`) ?? 0) + s.quantity);
  const items = [...merged.entries()].map(([key, x]) => {
    const single = singles.get(x.card.id);
    const q = single ? quoteFor(single, x.finish, 'NM') : null;
    return {
      ...x,
      priceCents: q ? headlinePrice(q) : null,
      marketCents: q?.marketCents ?? null,
      lowCents: q?.lowCents ?? null,
      url: q?.url ?? null,
      owned: owned.get(key) ?? 0,
    };
  });
  return items.sort((a, b) => (b.priceCents ?? -1) * b.quantity - (a.priceCents ?? -1) * a.quantity);
}

export function importTotals(items: ImportItem[]) {
  return items.reduce(
    (t, i) => ({
      copies: t.copies + i.quantity,
      valueCents: t.valueCents + (i.priceCents ?? 0) * i.quantity,
      owned: t.owned + Math.min(i.owned, i.quantity),
    }),
    { copies: 0, valueCents: 0, owned: 0 },
  );
}

export async function saveImport(items: ImportItem[], onlyMissing: boolean, source: NewSource | null): Promise<number> {
  const now = new Date().toISOString();
  const scans: NewScan[] = items.flatMap((i) => {
    const quantity = onlyMissing ? Math.max(0, i.quantity - i.owned) : i.quantity;
    if (quantity === 0) return [];
    return [
      {
        photo_uri: '',
        scryfall_id: i.card.id,
        name: i.card.name,
        set_code: i.card.set,
        set_name: i.card.set_name,
        collector_number: i.card.collector_number,
        image_uri: cardImage(i.card, 'normal'),
        ...cardMeta(i.card),
        sf_prices: serializePrices(i.card.prices),
        finish: i.finish,
        condition: 'NM',
        quantity,
        price_cents: i.priceCents,
        market_cents: i.marketCents,
        low_cents: i.lowCents,
        manapool_url: i.url,
        price_updated_at: i.priceCents != null ? now : null,
      },
    ];
  });
  const sourceId = source ? await createSource(source) : null;
  await insertScans(scans, sourceId);
  return scans.reduce((n, s) => n + (s.quantity ?? 1), 0);
}
