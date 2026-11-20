import { openDatabaseAsync, type SQLiteDatabase } from 'expo-sqlite';
import type { RestorePlan } from './backup';
import type { NewSource, Source } from './sources';
import type { Condition } from './manapool';
import { dayKey } from './growth';
import { cachedPrice, serializePrices } from './prices';
import type { Sale, SaleCard, SaleFrom } from './sales';
import { cardMeta, cardsByIds, type CardMeta, type Finish } from './scryfall';

export interface Scan extends CardMeta {
  id: number;
  photo_uri: string;
  scryfall_id: string;
  name: string;
  set_code: string;
  set_name: string;
  collector_number: string;
  image_uri: string | null;
  finish: Finish;
  condition: Condition;
  price_cents: number | null;
  market_cents: number | null;
  low_cents: number | null;
  manapool_url: string | null;
  price_updated_at: string | null;
  sf_prices: string | null; // Scryfall's TCGplayer / Cardmarket prices (JSON), see prices.ts
  price_id: string | null;
  quantity: number; // copies owned of this exact printing + finish + condition
  created_at: string;
}

export type NewScan = Omit<Scan, 'id' | 'created_at' | 'quantity' | 'sf_prices' | 'price_id' | 'lang' | 'low_cents'> & {
  low_cents?: number | null;
  quantity?: number;
  sf_prices?: string | null;
  price_id?: string | null;
  lang?: string | null;
};

const ADDED_COLUMNS: Record<keyof CardMeta | 'quantity' | 'sf_prices' | 'price_id' | 'low_cents', string> = {
  type_line: 'TEXT',
  color_identity: 'TEXT',
  rarity: 'TEXT',
  released_at: 'TEXT',
  layout: 'TEXT',
  quantity: 'INTEGER NOT NULL DEFAULT 1',
  sf_prices: 'TEXT',
  lang: 'TEXT',
  price_id: 'TEXT',
  low_cents: 'INTEGER',
};

const SAME_CARD = 'scryfall_id = ? AND finish = ? AND condition = ?';

let dbPromise: Promise<SQLiteDatabase> | null = null;

let changeListener: () => void = () => {};
export const onCollectionChange = (listener: () => void) => {
  changeListener = listener;
};
const notifyChange = () => changeListener();

function db(): Promise<SQLiteDatabase> {
  if (!dbPromise) {
    dbPromise = (async () => {
      const conn = await openDatabaseAsync('scans.db');
      await conn.execAsync(`
        PRAGMA journal_mode = WAL;
        CREATE TABLE IF NOT EXISTS scans (
          id               INTEGER PRIMARY KEY AUTOINCREMENT,
          photo_uri        TEXT    NOT NULL,
          scryfall_id      TEXT    NOT NULL,
          name             TEXT    NOT NULL,
          set_code         TEXT    NOT NULL,
          set_name         TEXT    NOT NULL,
          collector_number TEXT    NOT NULL,
          image_uri        TEXT,
          finish           TEXT    NOT NULL DEFAULT 'nonfoil',
          condition        TEXT    NOT NULL DEFAULT 'NM',
          price_cents      INTEGER,
          market_cents     INTEGER,
          manapool_url     TEXT,
          price_updated_at TEXT,
          created_at       TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
        );
      `);
      await conn.execAsync('CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)');
      await conn.execAsync('CREATE TABLE IF NOT EXISTS stack_items (id TEXT PRIMARY KEY, data TEXT NOT NULL)');
      await conn.execAsync(`
        CREATE TABLE IF NOT EXISTS sources (
          id           INTEGER PRIMARY KEY AUTOINCREMENT,
          kind         TEXT    NOT NULL,
          name         TEXT    NOT NULL,
          cost_cents   INTEGER,
          packs        INTEGER NOT NULL DEFAULT 1,
          packs_opened INTEGER NOT NULL DEFAULT 0,
          set_code     TEXT,
          product_id   TEXT,
          finished     INTEGER NOT NULL DEFAULT 0,
          created_at   TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
        );
        CREATE TABLE IF NOT EXISTS additions (
          id          INTEGER PRIMARY KEY AUTOINCREMENT,
          scan_id     INTEGER NOT NULL,
          source_id   INTEGER,
          quantity    INTEGER NOT NULL,
          price_cents INTEGER,
          added_at    TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
        );
        CREATE INDEX IF NOT EXISTS additions_scan ON additions (scan_id);
        CREATE INDEX IF NOT EXISTS additions_source ON additions (source_id);
        -- What the whole collection was worth each day (one row per local day, last value of the day).
        CREATE TABLE IF NOT EXISTS value_snapshots (
          day         TEXT PRIMARY KEY,
          value_cents INTEGER NOT NULL,
          tcg_cents   INTEGER,
          copies      INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS sales (
          id         INTEGER PRIMARY KEY AUTOINCREMENT,
          sold_at    TEXT    NOT NULL,
          quantity   INTEGER NOT NULL,
          sold_cents INTEGER NOT NULL,
          card       TEXT    NOT NULL,
          from_json  TEXT    NOT NULL
        );
      `);
      const existing = new Set(
        (await conn.getAllAsync<{ name: string }>('PRAGMA table_info(scans)')).map((c) => c.name),
      );
      for (const [col, type] of Object.entries(ADDED_COLUMNS)) {
        if (!existing.has(col)) await conn.execAsync(`ALTER TABLE scans ADD COLUMN ${col} ${type}`);
      }
      await conn.withTransactionAsync(() => repairAdditions(conn));
      return conn;
    })();
  }
  return dbPromise;
}

async function repairAdditions(conn: SQLiteDatabase) {
  await conn.runAsync('DELETE FROM additions WHERE scan_id NOT IN (SELECT id FROM scans)');
  const off = await conn.getAllAsync<{
    id: number;
    quantity: number;
    price_cents: number | null;
    created_at: string;
    have: number;
    n: number;
  }>(
    `SELECT s.id, s.quantity, s.price_cents, s.created_at, COALESCE(SUM(a.quantity), 0) AS have, COUNT(a.id) AS n
     FROM scans s LEFT JOIN additions a ON a.scan_id = s.id
     GROUP BY s.id HAVING have <> s.quantity`,
  );
  for (const r of off) {
    if (r.have < r.quantity) {
      await conn.runAsync(
        'INSERT INTO additions (scan_id, source_id, quantity, price_cents, added_at) VALUES (?, NULL, ?, ?, ?)',
        r.id,
        r.quantity - r.have,
        r.price_cents,
        r.n === 0 ? r.created_at : new Date().toISOString(),
      );
      continue;
    }
    let extra = r.have - r.quantity;
    const adds = await conn.getAllAsync<{ id: number; quantity: number }>(
      'SELECT id, quantity FROM additions WHERE scan_id = ? ORDER BY added_at DESC, id DESC',
      r.id,
    );
    for (const a of adds) {
      if (extra <= 0) break;
      const take = Math.min(extra, a.quantity);
      if (take === a.quantity) await conn.runAsync('DELETE FROM additions WHERE id = ?', a.id);
      else await conn.runAsync('UPDATE additions SET quantity = quantity - ? WHERE id = ?', take, a.id);
      extra -= take;
    }
  }
}

export async function listScans(): Promise<Scan[]> {
  return (await db()).getAllAsync<Scan>('SELECT * FROM scans ORDER BY created_at DESC');
}

export async function getScan(id: number): Promise<Scan | null> {
  return (await db()).getFirstAsync<Scan>('SELECT * FROM scans WHERE id = ?', id);
}

export async function insertScan(s: NewScan, sourceId: number | null = null): Promise<number> {
  const conn = await db();
  let id = 0;
  await conn.withTransactionAsync(async () => {
    id = await insertOrRaise(conn, s);
    await conn.runAsync(
      'INSERT INTO additions (scan_id, source_id, quantity, price_cents, added_at) VALUES (?, ?, ?, ?, ?)',
      id,
      sourceId,
      Math.max(1, s.quantity ?? 1),
      s.price_cents,
      new Date().toISOString(), // the app's clock (SQLite's default would bypass it)
    );
  });
  notifyChange();
  return id;
}

export async function insertScans(list: NewScan[], sourceId: number | null = null) {
  if (list.length === 0) return;
  const conn = await db();
  const now = new Date().toISOString();
  await conn.withTransactionAsync(async () => {
    for (const s of list) {
      const id = await insertOrRaise(conn, s);
      await conn.runAsync(
        'INSERT INTO additions (scan_id, source_id, quantity, price_cents, added_at) VALUES (?, ?, ?, ?, ?)',
        id,
        sourceId,
        Math.max(1, s.quantity ?? 1),
        s.price_cents,
        now,
      );
    }
  });
  notifyChange();
}

async function insertOrRaise(conn: SQLiteDatabase, s: NewScan): Promise<number> {
  const add = Math.max(1, s.quantity ?? 1);
  const existing = await conn.getFirstAsync<{ id: number }>(
    `SELECT id FROM scans WHERE ${SAME_CARD} ORDER BY id LIMIT 1`,
    s.scryfall_id,
    s.finish,
    s.condition,
  );
  if (existing) {
    await conn.runAsync(
      `UPDATE scans SET quantity = quantity + ?,
                        price_cents = COALESCE(?, price_cents), market_cents = COALESCE(?, market_cents), low_cents = COALESCE(?, low_cents),
                        manapool_url = COALESCE(?, manapool_url), price_updated_at = COALESCE(?, price_updated_at),
                        sf_prices = COALESCE(?, sf_prices)
       WHERE id = ?`,
      add,
      s.price_cents,
      s.market_cents,
      s.low_cents ?? null,
      s.manapool_url,
      s.price_updated_at,
      s.sf_prices ?? null,
      existing.id,
    );
    return existing.id;
  }
  const r = await conn.runAsync(
    `INSERT INTO scans (photo_uri, scryfall_id, name, set_code, set_name, collector_number, image_uri,
                        finish, condition, price_cents, market_cents, manapool_url, price_updated_at,
                        type_line, color_identity, rarity, released_at, layout, quantity, sf_prices, created_at,
                        lang, price_id, low_cents)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    s.photo_uri,
    s.scryfall_id,
    s.name,
    s.set_code,
    s.set_name,
    s.collector_number,
    s.image_uri,
    s.finish,
    s.condition,
    s.price_cents,
    s.market_cents,
    s.manapool_url,
    s.price_updated_at,
    s.type_line,
    s.color_identity,
    s.rarity,
    s.released_at,
    s.layout,
    add,
    s.sf_prices ?? null,
    new Date().toISOString(),
    s.lang ?? 'en',
    s.price_id ?? null,
    s.low_cents ?? null,
  );
  return r.lastInsertRowId;
}

export async function quantityOwned(scryfallId: string, finish: string, condition: string): Promise<number> {
  const row = await (
    await db()
  ).getFirstAsync<{ n: number | null }>(
    `SELECT SUM(quantity) AS n FROM scans WHERE ${SAME_CARD}`,
    scryfallId,
    finish,
    condition,
  );
  return row?.n ?? 0;
}

export async function setQuantity(id: number, quantity: number) {
  const conn = await db();
  const next = Math.max(1, Math.round(quantity));
  await conn.withTransactionAsync(async () => {
    const scan = await conn.getFirstAsync<Scan>('SELECT * FROM scans WHERE id = ?', id);
    if (!scan) return;
    if (next < scan.quantity) {
      const taken = await takeCopies(conn, id, scan.quantity - next, 'newest');
      await eraseFromHistory(conn, scan, taken);
    }
    await conn.runAsync('UPDATE scans SET quantity = ? WHERE id = ?', next, id);
    await repairAdditions(conn);
  });
  notifyChange();
}

async function takeCopies(
  conn: SQLiteDatabase,
  scanId: number,
  count: number,
  order: 'oldest' | 'newest',
): Promise<SaleFrom[]> {
  const dir = order === 'oldest' ? 'ASC' : 'DESC';
  const adds = await conn.getAllAsync<SaleFrom & { id: number }>(
    `SELECT id, source_id, quantity, price_cents, added_at FROM additions WHERE scan_id = ?
     ORDER BY added_at ${dir}, id ${dir}`,
    scanId,
  );
  const taken: SaleFrom[] = [];
  let left = count;
  for (const a of adds) {
    if (left <= 0) break;
    const take = Math.min(left, a.quantity);
    if (take === a.quantity) await conn.runAsync('DELETE FROM additions WHERE id = ?', a.id);
    else await conn.runAsync('UPDATE additions SET quantity = quantity - ? WHERE id = ?', take, a.id);
    taken.push({ source_id: a.source_id, quantity: take, price_cents: a.price_cents, added_at: a.added_at });
    left -= take;
  }
  return taken;
}

// Copies that were never really owned: take them out of past daily values too (at today's price).
async function eraseFromHistory(conn: SQLiteDatabase, scan: Scan, taken: SaleFrom[]) {
  const mp = cachedPrice(scan, 'manapool') ?? 0;
  const tcg = cachedPrice(scan, 'tcgplayer') ?? 0;
  for (const t of taken)
    await conn.runAsync(
      `UPDATE value_snapshots SET copies = MAX(0, copies - ?), value_cents = MAX(0, value_cents - ?),
         tcg_cents = CASE WHEN tcg_cents IS NULL THEN NULL ELSE MAX(0, tcg_cents - ?) END
       WHERE day >= ?`,
      t.quantity,
      t.quantity * mp,
      t.quantity * tcg,
      dayKey(Date.parse(t.added_at)),
    );
}

const saleCard = ({ id: _id, photo_uri: _photo, quantity: _q, ...card }: Scan): SaleCard => card;

export async function sellScan(id: number, quantity: number, soldCents: number): Promise<'sold-all' | 'sold-some'> {
  const conn = await db();
  let result: 'sold-all' | 'sold-some' = 'sold-some';
  await conn.withTransactionAsync(async () => {
    const scan = await conn.getFirstAsync<Scan>('SELECT * FROM scans WHERE id = ?', id);
    if (!scan) throw new Error('Card not found');
    const n = Math.min(Math.max(1, Math.round(quantity)), scan.quantity);
    const taken = await takeCopies(conn, id, n, 'oldest');
    await conn.runAsync(
      'INSERT INTO sales (sold_at, quantity, sold_cents, card, from_json) VALUES (?, ?, ?, ?, ?)',
      new Date().toISOString(),
      n,
      Math.max(0, Math.round(soldCents)),
      JSON.stringify(saleCard(scan)),
      JSON.stringify(taken),
    );
    if (n >= scan.quantity) {
      await conn.runAsync('DELETE FROM additions WHERE scan_id = ?', id);
      await conn.runAsync('DELETE FROM scans WHERE id = ?', id);
      result = 'sold-all';
    } else {
      await conn.runAsync('UPDATE scans SET quantity = quantity - ? WHERE id = ?', n, id);
      await repairAdditions(conn);
    }
  });
  notifyChange();
  return result;
}

export async function undoSale(saleId: number) {
  const conn = await db();
  await conn.withTransactionAsync(async () => {
    const row = await conn.getFirstAsync<SaleRow>('SELECT * FROM sales WHERE id = ?', saleId);
    if (!row) return;
    const sale = toSale(row);
    const c = sale.card;
    const existing = await conn.getFirstAsync<{ id: number }>(
      `SELECT id FROM scans WHERE ${SAME_CARD} ORDER BY id LIMIT 1`,
      c.scryfall_id,
      c.finish,
      c.condition,
    );
    let scanId: number;
    if (existing) {
      scanId = existing.id;
      await conn.runAsync('UPDATE scans SET quantity = quantity + ? WHERE id = ?', sale.quantity, scanId);
    } else {
      scanId = await insertOrRaise(conn, { ...c, photo_uri: '', quantity: sale.quantity });
      await conn.runAsync('UPDATE scans SET created_at = ? WHERE id = ?', c.created_at, scanId);
    }
    const sources = new Set((await conn.getAllAsync<{ id: number }>('SELECT id FROM sources')).map((s) => s.id));
    for (const f of sale.from)
      await conn.runAsync(
        'INSERT INTO additions (scan_id, source_id, quantity, price_cents, added_at) VALUES (?, ?, ?, ?, ?)',
        scanId,
        f.source_id != null && sources.has(f.source_id) ? f.source_id : null,
        f.quantity,
        f.price_cents,
        f.added_at,
      );
    await conn.runAsync('DELETE FROM sales WHERE id = ?', saleId);
    await repairAdditions(conn);
  });
  notifyChange();
}

interface SaleRow {
  id: number;
  sold_at: string;
  quantity: number;
  sold_cents: number;
  card: string;
  from_json: string;
}

const toSale = (r: SaleRow): Sale => ({
  id: r.id,
  sold_at: r.sold_at,
  quantity: r.quantity,
  sold_cents: r.sold_cents,
  card: JSON.parse(r.card) as SaleCard,
  from: JSON.parse(r.from_json) as SaleFrom[],
});

export async function listSales(): Promise<Sale[]> {
  const rows = await (await db()).getAllAsync<SaleRow>('SELECT * FROM sales ORDER BY sold_at DESC, id DESC');
  return rows.map(toSale);
}

async function absorbDuplicates(id: number) {
  const conn = await db();
  await conn.withTransactionAsync(async () => {
    const me = await conn.getFirstAsync<{ scryfall_id: string; finish: string; condition: string }>(
      'SELECT scryfall_id, finish, condition FROM scans WHERE id = ?',
      id,
    );
    if (!me) return;
    const dupes = await conn.getAllAsync<{ id: number; quantity: number }>(
      `SELECT id, quantity FROM scans WHERE ${SAME_CARD} AND id <> ?`,
      me.scryfall_id,
      me.finish,
      me.condition,
      id,
    );
    if (dupes.length === 0) return;
    const extra = dupes.reduce((n, d) => n + (d.quantity ?? 1), 0);
    await conn.runAsync('UPDATE scans SET quantity = quantity + ? WHERE id = ?', extra, id);
    for (const d of dupes) {
      await conn.runAsync('UPDATE additions SET scan_id = ? WHERE scan_id = ?', id, d.id);
      await conn.runAsync('DELETE FROM scans WHERE id = ?', d.id);
    }
  });
}

export async function mergeDuplicateRows(): Promise<number> {
  const conn = await db();
  let removed = 0;
  await conn.withTransactionAsync(async () => {
    const groups = await conn.getAllAsync<{ keep: number; total: number; n: number }>(
      `SELECT MIN(id) AS keep, SUM(quantity) AS total, COUNT(*) AS n
       FROM scans GROUP BY scryfall_id, finish, condition HAVING COUNT(*) > 1`,
    );
    for (const g of groups) {
      await conn.runAsync('UPDATE scans SET quantity = ? WHERE id = ?', g.total, g.keep);
      await conn.runAsync(
        `UPDATE additions SET scan_id = ? WHERE scan_id IN (SELECT id FROM scans WHERE id <> ? AND
           (scryfall_id, finish, condition) = (SELECT scryfall_id, finish, condition FROM scans WHERE id = ?))`,
        g.keep,
        g.keep,
        g.keep,
      );
      const r = await conn.runAsync(
        `DELETE FROM scans WHERE id <> ? AND (scryfall_id, finish, condition) =
           (SELECT scryfall_id, finish, condition FROM scans WHERE id = ?)`,
        g.keep,
        g.keep,
      );
      removed += r.changes;
    }
  });
  notifyChange();
  return removed;
}

export async function updatePrice(
  id: number,
  p: { price_cents: number | null; market_cents: number | null; low_cents: number | null; manapool_url: string | null },
) {
  await (
    await db()
  ).runAsync(
    `UPDATE scans SET price_cents = ?, market_cents = ?, low_cents = ?, manapool_url = ?, price_updated_at = ? WHERE id = ?`,
    p.price_cents,
    p.market_cents,
    p.low_cents,
    p.manapool_url,
    new Date().toISOString(),
    id,
  );
}

export interface PriceUpdate {
  id: number;
  manapool?: { price_cents: number | null; market_cents: number | null; low_cents: number | null; manapool_url: string | null };
  sf_prices?: string;
}

export async function updatePricesBulk(rows: PriceUpdate[]) {
  if (rows.length === 0) return;
  const conn = await db();
  const now = new Date().toISOString();
  await conn.withTransactionAsync(async () => {
    for (const r of rows) {
      if (r.manapool)
        await conn.runAsync(
          'UPDATE scans SET price_cents = ?, market_cents = ?, low_cents = ?, manapool_url = ?, price_updated_at = ? WHERE id = ?',
          r.manapool.price_cents,
          r.manapool.market_cents,
          r.manapool.low_cents,
          r.manapool.manapool_url,
          now,
          r.id,
        );
      if (r.sf_prices !== undefined) await conn.runAsync('UPDATE scans SET sf_prices = ? WHERE id = ?', r.sf_prices, r.id);
    }
  });
}

export async function updateScryfallPrices(id: number, sfPrices: string | null) {
  await (await db()).runAsync('UPDATE scans SET sf_prices = ? WHERE id = ?', sfPrices, id);
}

export type ScanEdits = Pick<
  Scan,
  'scryfall_id' | 'name' | 'set_code' | 'set_name' | 'collector_number' | 'image_uri' | 'finish' | 'condition'
> &
  Partial<CardMeta> & { price_id?: string | null };

export async function updateScanDetails(id: number, e: ScanEdits) {
  await (
    await db()
  ).runAsync(
    `UPDATE scans SET scryfall_id = ?, name = ?, set_code = ?, set_name = ?, collector_number = ?, image_uri = ?,
                      finish = ?, condition = ?,
                      type_line = COALESCE(?, type_line), color_identity = COALESCE(?, color_identity),
                      rarity = COALESCE(?, rarity), released_at = COALESCE(?, released_at),
                      layout = COALESCE(?, layout), lang = COALESCE(?, lang), price_id = ?
     WHERE id = ?`,
    e.scryfall_id,
    e.name,
    e.set_code,
    e.set_name,
    e.collector_number,
    e.image_uri,
    e.finish,
    e.condition,
    e.type_line ?? null,
    e.color_identity ?? null,
    e.rarity ?? null,
    e.released_at ?? null,
    e.layout ?? null,
    e.lang ?? null,
    e.price_id ?? null,
    id,
  );
  await absorbDuplicates(id);
  notifyChange();
}

export async function clearPhotoReferences(): Promise<number> {
  const r = await (
    await db()
  ).runAsync("UPDATE scans SET photo_uri = '' WHERE photo_uri <> '' AND image_uri IS NOT NULL");
  return r.changes;
}

export async function getSetting<T>(key: string): Promise<T | null> {
  const row = await (await db()).getFirstAsync<{ value: string }>('SELECT value FROM settings WHERE key = ?', key);
  return row ? (JSON.parse(row.value) as T) : null;
}

export async function setSetting(key: string, value: unknown) {
  await (
    await db()
  ).runAsync(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
    key,
    JSON.stringify(value),
  );
}

export async function deleteScan(id: number) {
  const conn = await db();
  await conn.withTransactionAsync(async () => {
    const scan = await conn.getFirstAsync<Scan>('SELECT * FROM scans WHERE id = ?', id);
    if (scan) await eraseFromHistory(conn, scan, await takeCopies(conn, id, Number.MAX_SAFE_INTEGER, 'oldest'));
    await conn.runAsync('DELETE FROM additions WHERE scan_id = ?', id);
    await conn.runAsync('DELETE FROM scans WHERE id = ?', id);
  });
  notifyChange();
}

export async function applyRestore(
  plan: RestorePlan,
  onProgress?: (done: number, total: number) => void,
): Promise<void> {
  const conn = await db();
  const total =
    (plan.sources?.length ?? 0) +
    plan.insert.length +
    plan.raise.length +
    (plan.snapshots?.length ?? 0) +
    (plan.sales?.length ?? 0);
  let done = 0;
  let shown = -1;
  const step = Math.max(1, Math.floor(total / 100)); // about 100 updates however big the backup
  const tick = () => {
    done++;
    if (onProgress && (done - shown >= step || done === total)) {
      shown = done;
      onProgress(done, total);
    }
  };
  onProgress?.(0, total);
  await conn.withTransactionAsync(async () => {
    if (plan.mode === 'replace') {
      await conn.runAsync('DELETE FROM additions');
      await conn.runAsync('DELETE FROM sources');
      await conn.runAsync('DELETE FROM scans');
    }
    const sourceIds = new Map<number, number>();
    for (const src of plan.sources ?? []) {
      const have = await conn.getFirstAsync<{ id: number }>(
        'SELECT id FROM sources WHERE name = ? AND created_at = ?',
        src.name,
        src.created_at,
      );
      tick();
      if (have) {
        sourceIds.set(src.ref, have.id);
        continue;
      }
      const r = await conn.runAsync(
        `INSERT INTO sources (kind, name, cost_cents, packs, packs_opened, set_code, product_id, finished, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        src.kind,
        src.name,
        src.cost_cents,
        src.packs,
        src.packs_opened,
        src.set_code,
        src.product_id,
        src.finished ? 1 : 0,
        src.created_at,
      );
      sourceIds.set(src.ref, r.lastInsertRowId);
    }
    const insScan = await conn.prepareAsync(
      `INSERT INTO scans (photo_uri, scryfall_id, name, set_code, set_name, collector_number, image_uri,
                            finish, condition, price_cents, market_cents, manapool_url, price_updated_at,
                            type_line, color_identity, rarity, released_at, layout, quantity, created_at, sf_prices,
                            lang, price_id, low_cents)
         VALUES ('', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    const insAdd = await conn.prepareAsync(
      'INSERT INTO additions (scan_id, source_id, quantity, price_cents, added_at) VALUES (?, ?, ?, ?, ?)',
    );
    const insSnap = await conn.prepareAsync(
      'INSERT OR IGNORE INTO value_snapshots (day, value_cents, tcg_cents, copies) VALUES (?, ?, ?, ?)',
    );
    try {
      for (const c of plan.insert) {
        const r = await insScan.executeAsync(
          c.scryfall_id,
          c.name,
          c.set_code,
          c.set_name,
          c.collector_number,
          c.image_uri,
          c.finish,
          c.condition,
          c.price_cents,
          c.market_cents,
          c.manapool_url,
          c.price_updated_at,
          c.type_line,
          c.color_identity,
          c.rarity,
          c.released_at,
          c.layout,
          c.quantity,
          c.created_at,
          c.sf_prices ?? null,
          c.lang ?? 'en',
          c.price_id ?? null,
          c.low_cents ?? null,
        );
        for (const a of c.from ?? [])
          await insAdd.executeAsync(
            r.lastInsertRowId,
            a.source == null ? null : (sourceIds.get(a.source) ?? null),
            a.quantity,
            a.price_cents,
            a.added_at,
          );
        tick();
      }
      for (const r of plan.raise) {
        await conn.runAsync('UPDATE scans SET quantity = ? WHERE id = ?', r.quantity, r.id);
        tick();
      }
      if (plan.mode === 'replace') await conn.runAsync('DELETE FROM value_snapshots');
      for (const s of plan.snapshots ?? []) {
        await insSnap.executeAsync(s.day, s.value_cents, s.tcg_cents, s.copies);
        tick();
      }
      if (plan.mode === 'replace') await conn.runAsync('DELETE FROM sales');
      const had = new Set(
        (await conn.getAllAsync<SaleRow>('SELECT * FROM sales')).map((r) => {
          const s = toSale(r);
          return `${s.card.scryfall_id}|${s.sold_at}`;
        }),
      );
      for (const sale of plan.sales ?? []) {
        tick();
        if (had.has(`${sale.card.scryfall_id}|${sale.sold_at}`)) continue;
        const from = sale.from.map((f) => ({
          source_id: f.source == null ? null : (sourceIds.get(f.source) ?? null),
          quantity: f.quantity,
          price_cents: f.price_cents,
          added_at: f.added_at,
        }));
        await conn.runAsync(
          'INSERT INTO sales (sold_at, quantity, sold_cents, card, from_json) VALUES (?, ?, ?, ?, ?)',
          sale.sold_at,
          sale.quantity,
          sale.sold_cents,
          JSON.stringify({ ...sale.card, lang: sale.card.lang ?? 'en' }),
          JSON.stringify(from),
        );
      }
    } finally {
      await Promise.all([insScan.finalizeAsync(), insAdd.finalizeAsync(), insSnap.finalizeAsync()]);
    }
    await repairAdditions(conn);
  });
  notifyChange();
}

export async function backfillCardMeta(): Promise<number> {
  const conn = await db();
  const missing = await conn.getAllAsync<{ id: number; scryfall_id: string; price_id: string | null }>(
    'SELECT id, scryfall_id, price_id FROM scans WHERE type_line IS NULL OR layout IS NULL OR sf_prices IS NULL OR lang IS NULL',
  );
  if (missing.length === 0) return 0;
  const cards = await cardsByIds([
    ...new Set(missing.flatMap((m) => (m.price_id ? [m.scryfall_id, m.price_id] : [m.scryfall_id]))),
  ]);
  const byId = new Map(cards.map((c) => [c.id, c]));
  let updated = 0;
  for (const m of missing) {
    const card = byId.get(m.scryfall_id);
    if (!card) continue;
    const meta = cardMeta(card);
    await conn.runAsync(
      `UPDATE scans SET type_line = ?, color_identity = ?, rarity = ?, released_at = ?, layout = ?, lang = ?,
                        sf_prices = COALESCE(?, sf_prices, '{}') WHERE id = ?`,
      meta.type_line ?? '',
      meta.color_identity,
      meta.rarity,
      meta.released_at,
      meta.layout ?? '',
      meta.lang ?? 'en',
      serializePrices((m.price_id ? byId.get(m.price_id) : null)?.prices ?? card.prices),
      m.id,
    );
    updated++;
  }
  return updated;
}

export async function loadStackItems(): Promise<string[]> {
  const rows = await (await db()).getAllAsync<{ data: string }>('SELECT data FROM stack_items');
  return rows.map((r) => r.data);
}

export async function writeStackItems(upserts: { id: string; data: string }[], deletes: string[]) {
  const conn = await db();
  await conn.withTransactionAsync(async () => {
    for (const u of upserts)
      await conn.runAsync(
        'INSERT INTO stack_items (id, data) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data',
        u.id,
        u.data,
      );
    for (const id of deletes) await conn.runAsync('DELETE FROM stack_items WHERE id = ?', id);
  });
}

export async function createSource(src: NewSource): Promise<number> {
  const r = await (
    await db()
  ).runAsync(
    `INSERT INTO sources (kind, name, cost_cents, packs, packs_opened, set_code, product_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    src.kind,
    src.name,
    src.cost_cents,
    src.packs,
    src.packs_opened ?? 0,
    src.set_code ?? null,
    src.product_id ?? null,
    new Date().toISOString(),
  );
  notifyChange();
  return r.lastInsertRowId;
}

export async function listSources(): Promise<Source[]> {
  return (await db()).getAllAsync<Source>('SELECT * FROM sources ORDER BY created_at DESC, id DESC');
}

export async function getSource(id: number): Promise<Source | null> {
  return (await db()).getFirstAsync<Source>('SELECT * FROM sources WHERE id = ?', id);
}

export type SourcePatch = Partial<
  Pick<Source, 'name' | 'cost_cents' | 'packs' | 'packs_opened' | 'finished' | 'set_code' | 'product_id'>
>;

export async function updateSource(id: number, patch: SourcePatch) {
  const keys = Object.keys(patch) as (keyof SourcePatch)[];
  if (keys.length === 0) return;
  await (
    await db()
  ).runAsync(
    `UPDATE sources SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`,
    ...keys.map((k) => patch[k] ?? null),
    id,
  );
  notifyChange();
}

export async function deleteSource(id: number) {
  const conn = await db();
  await conn.withTransactionAsync(async () => {
    await conn.runAsync('UPDATE additions SET source_id = NULL WHERE source_id = ?', id);
    await conn.runAsync('DELETE FROM sources WHERE id = ?', id);
  });
  notifyChange();
}

export type SourceCardRow = Scan & { source_id: number; copies: number };

export async function listSourceCards(sourceId?: number): Promise<SourceCardRow[]> {
  const where = sourceId == null ? 'a.source_id IS NOT NULL' : 'a.source_id = ?';
  return (await db()).getAllAsync<SourceCardRow>(
    `SELECT s.*, a.source_id, SUM(a.quantity) AS copies
     FROM additions a JOIN scans s ON s.id = a.scan_id
     WHERE ${where} GROUP BY a.source_id, s.id`,
    ...(sourceId == null ? [] : [sourceId]),
  );
}

export interface Addition {
  scan_id: number;
  source_id: number | null;
  quantity: number;
  price_cents: number | null;
  added_at: string;
}

export async function listAdditions(): Promise<Addition[]> {
  return (await db()).getAllAsync<Addition>(
    'SELECT scan_id, source_id, quantity, price_cents, added_at FROM additions ORDER BY added_at, id',
  );
}

export type AdditionWithCard = Addition & Pick<Scan, 'finish' | 'price_cents' | 'sf_prices'>;

export async function listAdditionsWithCard(): Promise<AdditionWithCard[]> {
  return (await db()).getAllAsync<AdditionWithCard>(
    `SELECT a.scan_id, a.source_id, a.quantity, a.added_at, s.finish, s.price_cents, s.sf_prices
     FROM additions a JOIN scans s ON s.id = a.scan_id ORDER BY a.added_at, a.id`,
  );
}

export async function recordSnapshot(day: string, valueCents: number, tcgCents: number | null, copies: number) {
  await (
    await db()
  ).runAsync(
    `INSERT INTO value_snapshots (day, value_cents, tcg_cents, copies) VALUES (?, ?, ?, ?)
     ON CONFLICT(day) DO UPDATE SET value_cents = excluded.value_cents, tcg_cents = excluded.tcg_cents,
                                    copies = excluded.copies`,
    day,
    valueCents,
    tcgCents,
    copies,
  );
}

export async function listSnapshots(): Promise<{ day: string; value_cents: number; tcg_cents: number | null; copies: number }[]> {
  return (await db()).getAllAsync('SELECT day, value_cents, tcg_cents, copies FROM value_snapshots ORDER BY day');
}
