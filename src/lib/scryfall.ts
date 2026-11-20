import { USER_AGENT } from './appInfo';
import type { ScryfallPrices } from './prices';

const BASE = 'https://api.scryfall.com';
const HEADERS = {
  'User-Agent': USER_AGENT,
  Accept: 'application/json',
};
const MIN_GAP_MS = 100;

export type Finish = 'nonfoil' | 'foil' | 'etched';

type ImageUris = { small: string; normal: string; large: string };

export interface ScryfallCard {
  id: string;
  name: string;
  lang: string;
  set: string;
  set_name: string;
  collector_number: string;
  released_at: string;
  digital: boolean;
  finishes: Finish[];
  image_uris?: ImageUris;
  card_faces?: { name: string; type_line?: string; colors?: string[]; image_uris?: ImageUris }[];
  prints_search_uri: string;
  type_line?: string;
  color_identity: string[];
  colors?: string[];
  rarity: string;
  cmc?: number;
  layout?: string;
  prices?: ScryfallPrices;
  flavor_name?: string; // alternate printed name (e.g. Final Fantasy / Godzilla variants)
  printed_name?: string; // name as printed, for non-English cards
  purchase_uris?: { tcgplayer?: string; cardmarket?: string };
  border_color?: string;
  frame?: string;
  frame_effects?: string[];
  full_art?: boolean;
  promo_types?: string[];
}

export interface CardMeta {
  type_line: string | null;
  color_identity: string; // e.g. "GW"; "" = colorless
  rarity: string | null;
  released_at: string | null;
  layout: string | null;
  lang: string | null;
}

export function cardMeta(c: ScryfallCard): CardMeta {
  const type =
    c.type_line ??
    c.card_faces
      ?.map((f) => f.type_line)
      .filter(Boolean)
      .join(' // ') ??
    null;
  const order = 'WUBRG';
  return {
    type_line: type || null,
    color_identity: [...(c.color_identity ?? [])].sort((a, b) => order.indexOf(a) - order.indexOf(b)).join(''),
    rarity: c.rarity ?? null,
    lang: c.lang ?? null,
    released_at: c.released_at ?? null,
    layout: c.layout ?? null,
  };
}

interface ScryfallList<T> {
  data: T[];
  has_more: boolean;
  next_page?: string;
}

let lastRequestAt = 0;
let gate: Promise<void> = Promise.resolve();

function throttle(): Promise<void> {
  const slot = gate.then(async () => {
    const wait = lastRequestAt + MIN_GAP_MS - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    lastRequestAt = Date.now();
  });
  gate = slot.catch(() => {});
  return slot;
}

async function sfRequest(url: string, init: RequestInit = { headers: HEADERS }): Promise<Response> {
  for (let attempt = 0; ; attempt++) {
    await throttle();
    const res = await fetch(url, init);
    if (res.status !== 429 || attempt === 3) return res;
    const retryAfter = Number(res.headers.get('Retry-After')) || 0;
    await new Promise((r) => setTimeout(r, Math.max(retryAfter * 1000, 1000 * 2 ** attempt)));
  }
}

async function sfFetch<T>(url: string): Promise<T | null> {
  const res = await sfRequest(url);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Scryfall request failed (${res.status})`);
  return (await res.json()) as T;
}

export async function cardsByIds(ids: string[]): Promise<ScryfallCard[]> {
  const out: ScryfallCard[] = [];
  for (let i = 0; i < ids.length; i += 75) {
    const res = await sfRequest(`${BASE}/cards/collection`, {
      method: 'POST',
      headers: { ...HEADERS, 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifiers: ids.slice(i, i + 75).map((id) => ({ id })) }),
    });
    if (!res.ok) throw new Error(`Scryfall request failed (${res.status})`);
    out.push(...((await res.json()) as { data: ScryfallCard[] }).data);
  }
  return out;
}

export type CardIdentifier = { id: string } | { set: string; collector_number: string } | { name: string; set?: string };

export async function cardsByIdentifiers(
  identifiers: CardIdentifier[],
): Promise<{ found: ScryfallCard[]; notFound: CardIdentifier[] }> {
  const found: ScryfallCard[] = [];
  const notFound: CardIdentifier[] = [];
  for (let i = 0; i < identifiers.length; i += 75) {
    const res = await sfRequest(`${BASE}/cards/collection`, {
      method: 'POST',
      headers: { ...HEADERS, 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifiers: identifiers.slice(i, i + 75) }),
    });
    if (!res.ok) throw new Error(`Scryfall request failed (${res.status})`);
    const body = (await res.json()) as { data: ScryfallCard[]; not_found?: CardIdentifier[] };
    found.push(...body.data);
    notFound.push(...(body.not_found ?? []));
  }
  return { found, notFound };
}

export function cardById(id: string) {
  return sfFetch<ScryfallCard>(`${BASE}/cards/${encodeURIComponent(id)}`);
}

export function cardBySetAndNumber(setCode: string, collectorNumber: string, lang?: string | null) {
  const langPart = lang && lang !== 'en' ? `/${encodeURIComponent(lang)}` : '';
  return sfFetch<ScryfallCard>(
    `${BASE}/cards/${encodeURIComponent(setCode.toLowerCase())}/${encodeURIComponent(collectorNumber)}${langPart}`,
  );
}

export function cardByFuzzyName(name: string) {
  return sfFetch<ScryfallCard>(`${BASE}/cards/named?fuzzy=${encodeURIComponent(name)}`);
}

export async function cardByNameInSet(name: string, setCode: string, approxNumber?: string | null) {
  const set = setCode.toLowerCase();
  const q = `!"${name}" (set:${set} OR set:t${set}) include:extras`;
  const list = await sfFetch<ScryfallList<ScryfallCard>>(
    `${BASE}/cards/search?unique=prints&q=${encodeURIComponent(q)}`,
  );
  const prints = list?.data ?? [];
  if (prints.length <= 1 || !approxNumber) return prints[0] ?? null;
  return prints.reduce((best, c) =>
    numberDistance(c.collector_number, approxNumber) < numberDistance(best.collector_number, approxNumber) ? c : best,
  );
}

function numberDistance(a: string, b: string): number {
  const x = a.toLowerCase();
  const y = b.toLowerCase();
  const d = Array.from({ length: x.length + 1 }, (_, i) => [i, ...Array(y.length).fill(0)]);
  for (let j = 1; j <= y.length; j++) d[0][j] = j;
  for (let i = 1; i <= x.length; i++)
    for (let j = 1; j <= y.length; j++)
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (x[i - 1] === y[j - 1] ? 0 : 1));
  return d[x.length][y.length];
}

export async function allPrintings(card: ScryfallCard): Promise<ScryfallCard[]> {
  const out: ScryfallCard[] = [];
  let url: string | undefined = card.prints_search_uri;
  while (url) {
    const page: ScryfallList<ScryfallCard> | null = await sfFetch<ScryfallList<ScryfallCard>>(url);
    if (!page) break;
    out.push(...page.data);
    url = page.has_more ? page.next_page : undefined;
  }
  return out.filter((c) => !c.digital);
}

export function faceImages(card: ScryfallCard, size: keyof ImageUris = 'normal'): { name: string; uri: string }[] {
  const faces = card.card_faces?.filter((f) => f.image_uris) ?? [];
  if (!card.image_uris && faces.length >= 2) return faces.map((f) => ({ name: f.name, uri: f.image_uris![size] }));
  const uri = cardImage(card, size);
  return uri ? [{ name: card.name, uri }] : [];
}

export const frontName = (name: string) => name.split(' // ')[0];

const DOUBLE_FACED_LAYOUTS = new Set(['transform', 'modal_dfc', 'reversible_card', 'double_faced_token']);
export const isDoubleFacedLayout = (layout: string | null | undefined) => !!layout && DOUBLE_FACED_LAYOUTS.has(layout);

export function cardImage(card: ScryfallCard, size: keyof ImageUris = 'normal'): string | null {
  return card.image_uris?.[size] ?? card.card_faces?.[0]?.image_uris?.[size] ?? null;
}
