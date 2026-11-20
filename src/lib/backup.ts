import type { Addition, Scan } from './db';
import type { Condition } from './manapool';
import type { Finish } from './scryfall';
import type { Sale } from './sales';
import type { Source, SourceKind } from './sources';

export const BACKUP_FORMAT = 'mtg-price-checker-backup';
export const BACKUP_VERSION = 2;

export interface BackupAddition {
  source: number | null;
  quantity: number;
  price_cents: number | null;
  added_at: string;
}

export type BackupCard = Omit<Scan, 'id' | 'photo_uri'> & { from?: BackupAddition[] };

export type BackupSource = Omit<Source, 'id'> & { ref: number };

export interface BackupFile {
  format: typeof BACKUP_FORMAT;
  version: number;
  exportedAt: string;
  appVersion: string | null;
  prefs: unknown;
  cards: BackupCard[];
  sources?: BackupSource[];
  snapshots?: BackupSnapshot[];
  sales?: BackupSale[];
}

export interface BackupSale {
  sold_at: string;
  quantity: number;
  sold_cents: number;
  card: Omit<BackupCard, 'quantity' | 'from'>;
  from: BackupAddition[];
}

export interface BackupSnapshot {
  day: string;
  value_cents: number;
  tcg_cents: number | null;
  copies: number;
}

const FINISHES: Finish[] = ['nonfoil', 'foil', 'etched'];
const CONDITIONS: Condition[] = ['NM', 'LP', 'MP', 'HP', 'DMG'];

export function buildBackup(
  scans: Scan[],
  prefs: unknown,
  appVersion: string | null,
  now = new Date(),
  history: { sources: Source[]; additions: Addition[]; snapshots?: BackupSnapshot[]; sales?: Sale[] } = {
    sources: [],
    additions: [],
  },
): BackupFile {
  const byScan = new Map<number, BackupAddition[]>();
  for (const a of history.additions) {
    const list = byScan.get(a.scan_id) ?? [];
    list.push({ source: a.source_id, quantity: a.quantity, price_cents: a.price_cents, added_at: a.added_at });
    byScan.set(a.scan_id, list);
  }
  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    exportedAt: now.toISOString(),
    appVersion,
    prefs: prefs ?? null,
    cards: scans.map(({ id, photo_uri: _photo, ...card }) => ({
      ...card,
      quantity: card.quantity ?? 1,
      ...(byScan.has(id) ? { from: byScan.get(id) } : {}),
    })),
    sources: history.sources.map(({ id, ...s }) => ({ ...s, ref: id })),
    snapshots: history.snapshots ?? [],
    sales: (history.sales ?? []).map((s) => ({
      sold_at: s.sold_at,
      quantity: s.quantity,
      sold_cents: s.sold_cents,
      card: s.card,
      from: s.from.map((f) => ({
        source: f.source_id,
        quantity: f.quantity,
        price_cents: f.price_cents,
        added_at: f.added_at,
      })),
    })),
  };
}

export function backupFileName(date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `mtg-collector-backup-${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}.json`;
}

export interface ParsedBackup {
  backup: BackupFile;
  skipped: number;
}

const str = (v: unknown) => (typeof v === 'string' && v.trim() !== '' ? v : null);
const optStr = (v: unknown) => (typeof v === 'string' ? v : null);
const optInt = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? Math.round(v) : null);

function normalizeCard(raw: unknown): BackupCard | null {
  if (!raw || typeof raw !== 'object') return null;
  const c = raw as Record<string, unknown>;
  const scryfall_id = str(c.scryfall_id);
  const name = str(c.name);
  const set_code = str(c.set_code);
  const collector_number = str(c.collector_number);
  const finish = FINISHES.includes(c.finish as Finish) ? (c.finish as Finish) : null;
  const condition = CONDITIONS.includes(c.condition as Condition) ? (c.condition as Condition) : null;
  if (!scryfall_id || !name || !set_code || !collector_number || !finish || !condition) return null;
  const qty = optInt(c.quantity);
  const from = Array.isArray(c.from) ? c.from.map(normalizeAddition).filter((a) => a != null) : undefined;
  return {
    ...(from && from.length ? { from } : {}),
    scryfall_id,
    name,
    set_code,
    set_name: optStr(c.set_name) ?? set_code.toUpperCase(),
    collector_number,
    image_uri: optStr(c.image_uri),
    finish,
    condition,
    quantity: qty && qty > 0 ? Math.min(qty, 9999) : 1,
    price_cents: optInt(c.price_cents),
    market_cents: optInt(c.market_cents),
    low_cents: optInt(c.low_cents),
    manapool_url: optStr(c.manapool_url),
    price_updated_at: optStr(c.price_updated_at),
    sf_prices: optStr(c.sf_prices),
    created_at: optStr(c.created_at) ?? new Date().toISOString(),
    type_line: optStr(c.type_line),
    color_identity: optStr(c.color_identity) ?? '',
    rarity: optStr(c.rarity),
    released_at: optStr(c.released_at),
    layout: optStr(c.layout),
    lang: optStr(c.lang),
    price_id: optStr(c.price_id),
  };
}

function normalizeAddition(raw: unknown): BackupAddition | null {
  if (!raw || typeof raw !== 'object') return null;
  const a = raw as Record<string, unknown>;
  const quantity = optInt(a.quantity);
  if (!quantity || quantity < 1) return null;
  return {
    source: optInt(a.source),
    quantity: Math.min(quantity, 9999),
    price_cents: optInt(a.price_cents),
    added_at: optStr(a.added_at) ?? new Date().toISOString(),
  };
}

function normalizeSnapshot(raw: unknown): BackupSnapshot | null {
  if (!raw || typeof raw !== 'object') return null;
  const s = raw as Record<string, unknown>;
  const day = typeof s.day === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s.day) ? s.day : null;
  const value = optInt(s.value_cents);
  if (!day || value == null) return null;
  return { day, value_cents: value, tcg_cents: optInt(s.tcg_cents), copies: Math.max(0, optInt(s.copies) ?? 0) };
}

function normalizeSale(raw: unknown): BackupSale | null {
  if (!raw || typeof raw !== 'object') return null;
  const s = raw as Record<string, unknown>;
  const card = normalizeCard({ ...(s.card as object), quantity: 1 });
  const quantity = optInt(s.quantity);
  const sold_at = str(s.sold_at);
  if (!card || !quantity || quantity < 1 || !sold_at) return null;
  const { quantity: _q, from: _f, ...rest } = card;
  const from = Array.isArray(s.from) ? s.from.map(normalizeAddition).filter((a) => a != null) : [];
  return { sold_at, quantity, sold_cents: Math.max(0, optInt(s.sold_cents) ?? 0), card: rest, from };
}

const KINDS: SourceKind[] = ['pack', 'box', 'precon'];

function normalizeSource(raw: unknown): BackupSource | null {
  if (!raw || typeof raw !== 'object') return null;
  const s = raw as Record<string, unknown>;
  const ref = optInt(s.ref);
  const name = str(s.name);
  const kind = KINDS.includes(s.kind as SourceKind) ? (s.kind as SourceKind) : null;
  if (ref == null || !name || !kind) return null;
  const packs = optInt(s.packs);
  return {
    ref,
    kind,
    name,
    cost_cents: optInt(s.cost_cents),
    packs: packs && packs > 0 ? packs : 1,
    packs_opened: Math.max(0, optInt(s.packs_opened) ?? 0),
    set_code: optStr(s.set_code),
    product_id: optStr(s.product_id),
    finished: s.finished ? 1 : 0,
    created_at: optStr(s.created_at) ?? new Date().toISOString(),
  };
}

export function parseBackup(text: string): ParsedBackup {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error("This file isn't a backup (it isn't valid JSON).");
  }
  const d = data as Partial<BackupFile> | null;
  if (!d || typeof d !== 'object' || d.format !== BACKUP_FORMAT) {
    throw new Error("This file isn't an MTG Collector backup.");
  }
  if (typeof d.version !== 'number' || d.version > BACKUP_VERSION) {
    throw new Error('This backup was made by a newer version of the app. Update the app, then try again.');
  }
  if (!Array.isArray(d.cards)) throw new Error('This backup is damaged (no card list).');
  const cards: BackupCard[] = [];
  let skipped = 0;
  for (const raw of d.cards) {
    const card = normalizeCard(raw);
    if (card) cards.push(card);
    else skipped++;
  }
  const merged = new Map<string, BackupCard>();
  for (const c of cards) {
    const k = cardKey(c);
    const prev = merged.get(k);
    if (prev) {
      prev.quantity += c.quantity;
      if (c.from) prev.from = [...(prev.from ?? []), ...c.from];
    } else merged.set(k, { ...c });
  }
  const sources = Array.isArray(d.sources) ? d.sources.map(normalizeSource).filter((s) => s != null) : [];
  const snapshots = Array.isArray(d.snapshots) ? d.snapshots.map(normalizeSnapshot).filter((s) => s != null) : [];
  const sales = Array.isArray(d.sales) ? d.sales.map(normalizeSale).filter((s) => s != null) : [];
  return {
    backup: {
      format: BACKUP_FORMAT,
      version: d.version,
      exportedAt: typeof d.exportedAt === 'string' ? d.exportedAt : '',
      appVersion: typeof d.appVersion === 'string' ? d.appVersion : null,
      prefs: d.prefs ?? null,
      cards: [...merged.values()],
      sources,
      snapshots,
      sales,
    },
    skipped,
  };
}

export type RestoreMode = 'merge' | 'replace';

export const cardKey = (c: Pick<BackupCard, 'scryfall_id' | 'finish' | 'condition'>) =>
  `${c.scryfall_id}|${c.finish}|${c.condition}`;

export interface RestorePlan {
  mode: RestoreMode;
  insert: BackupCard[];
  raise: { id: number; quantity: number }[];
  unchanged: number;
  sources: BackupSource[];
  snapshots?: BackupSnapshot[];
  sales?: BackupSale[];
}

export function planRestore(
  existing: Pick<Scan, 'id' | 'scryfall_id' | 'finish' | 'condition' | 'quantity'>[],
  incoming: BackupCard[],
  mode: RestoreMode,
  sources: BackupSource[] = [],
  snapshots: BackupSnapshot[] = [],
  sales: BackupSale[] = [],
): RestorePlan {
  if (mode === 'replace') return { mode, insert: incoming, raise: [], unchanged: 0, sources, snapshots, sales };
  const byKey = new Map(existing.map((e) => [cardKey(e), e]));
  const plan: RestorePlan = { mode, insert: [], raise: [], unchanged: 0, sources, snapshots, sales };
  for (const card of incoming) {
    const have = byKey.get(cardKey(card));
    if (!have) plan.insert.push(card);
    else if (card.quantity > (have.quantity ?? 1)) plan.raise.push({ id: have.id, quantity: card.quantity });
    else plan.unchanged++;
  }
  return plan;
}

const DAILY_NAME = /^mtg-collect(?:ion|or)-backup-(\d{4}-\d{2}-\d{2})(?: \(\d+\))?\.json$/;

export function backupsToPrune<T extends { name: string; modified?: number }>(files: T[], keep: number): T[] {
  return files
    .filter((f) => DAILY_NAME.test(f.name))
    .sort(
      (a, b) =>
        b.name.match(DAILY_NAME)![1].localeCompare(a.name.match(DAILY_NAME)![1]) ||
        (b.modified ?? 0) - (a.modified ?? 0),
    )
    .slice(keep);
}
