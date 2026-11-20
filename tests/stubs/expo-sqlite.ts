import { DatabaseSync, type SQLInputValue } from 'node:sqlite';

const clean = (params: unknown[]): SQLInputValue[] =>
  params.map((p) => (p === undefined ? null : typeof p === 'boolean' ? (p ? 1 : 0) : (p as SQLInputValue)));

export class StubDatabase {
  constructor(readonly raw: DatabaseSync) {}
  async execAsync(sql: string) {
    this.raw.exec(sql);
  }
  async runAsync(sql: string, ...params: unknown[]) {
    const r = this.raw.prepare(sql).run(...clean(params));
    return { changes: Number(r.changes), lastInsertRowId: Number(r.lastInsertRowid) };
  }
  async getFirstAsync<T>(sql: string, ...params: unknown[]): Promise<T | null> {
    return (this.raw.prepare(sql).get(...clean(params)) as T | undefined) ?? null;
  }
  async getAllAsync<T>(sql: string, ...params: unknown[]): Promise<T[]> {
    return this.raw.prepare(sql).all(...clean(params)) as T[];
  }
  async prepareAsync(sql: string) {
    const stmt = this.raw.prepare(sql);
    return {
      async executeAsync(...params: unknown[]) {
        const r = stmt.run(...clean(params));
        return { changes: Number(r.changes), lastInsertRowId: Number(r.lastInsertRowid) };
      },
      async finalizeAsync() {},
    };
  }
  async withTransactionAsync(fn: () => Promise<void>) {
    stats.transactions++;
    this.raw.exec('BEGIN');
    try {
      await fn();
      this.raw.exec('COMMIT');
    } catch (e) {
      this.raw.exec('ROLLBACK');
      throw e;
    }
  }
}

export type SQLiteDatabase = StubDatabase;

const g = globalThis as unknown as { __stubDbs?: Map<string, StubDatabase>; __stubStats?: { transactions: number } };
const dbs = (g.__stubDbs ??= new Map());

export const stats = (g.__stubStats ??= { transactions: 0 });

export async function openDatabaseAsync(name: string): Promise<StubDatabase> {
  let db = dbs.get(name);
  if (!db) dbs.set(name, (db = new StubDatabase(new DatabaseSync(':memory:'))));
  return db;
}

export function resetDatabases() {
  for (const db of dbs.values()) db.raw.close();
  dbs.clear();
  stats.transactions = 0;
}

export const rawDatabase = (name = 'scans.db') => dbs.get(name)?.raw ?? null;
