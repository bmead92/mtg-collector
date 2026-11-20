import './sim/mocks';
import { beforeEach, describe, expect, it } from 'vitest';
import { backupsToPrune } from '../src/lib/backup';
import { resetDatabases } from './stubs/expo-sqlite';
import { launchApp } from './sim/harness';

beforeEach(() => resetDatabases());

describe('auto backup', () => {
  it('keeps the newest daily files and ignores anything else', () => {
    const files = ['2026-11-12', '2026-11-19', '2026-11-15', '2026-11-18', '2026-11-13', '2026-11-17', '2026-11-16', '2026-11-14']
      .map((d, i) => ({ id: String(i), name: `mtg-collection-backup-${d}.json` }))
      .concat([{ id: 'x', name: 'mtg-collection-backup-2026-11-01 (1).json' }, { id: 'y', name: 'notes.txt' }]);
    expect(backupsToPrune(files, 7).map((f) => f.name)).toEqual([
      'mtg-collection-backup-2026-11-12.json',
      'mtg-collection-backup-2026-11-01 (1).json',
    ]);
    expect(backupsToPrune(files.slice(0, 3), 7)).toEqual([]);
  });

  it('prunes files from before the rename together with new ones', () => {
    const files = ['2026-11-14', '2026-11-15', '2026-11-16', '2026-11-17', '2026-11-18', '2026-11-19'].map((d) => ({
      name: `mtg-collection-backup-${d}.json`,
    }));
    files.push({ name: 'mtg-collector-backup-2026-11-20.json' }, { name: 'mtg-collector-backup-2026-11-21.json' });
    expect(backupsToPrune(files, 7).map((f) => f.name)).toEqual(['mtg-collection-backup-2026-11-14.json']);
  });

  it('collection changes are announced', async () => {
    const app = await launchApp();
    let n = 0;
    app.db.onCollectionChange(() => n++);
    const src = await app.db.createSource({ kind: 'pack', name: 'p', cost_cents: 100, packs: 1 });
    await app.db.updateSource(src, { name: 'q' });
    await app.db.deleteSource(src);
    expect(n).toBe(3);
    await app.db.recordSnapshot('2026-11-19', 1, null, 1);
    expect(n).toBe(3);
  });
});
