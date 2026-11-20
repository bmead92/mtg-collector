import Constants from 'expo-constants';
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { backupFileName, buildBackup, parseBackup, type ParsedBackup } from './backup';
import { getSetting, listAdditions, listSales, listScans, listSnapshots, listSources } from './db';

const PREFS_KEY = 'gallery.prefs';

export async function shareBackup(): Promise<number> {
  const scans = await listScans();
  const prefs = await getSetting<unknown>(PREFS_KEY);
  const history = {
    sources: await listSources(),
    additions: await listAdditions(),
    snapshots: await listSnapshots(),
    sales: await listSales(),
  };
  const backup = buildBackup(scans, prefs, Constants.expoConfig?.version ?? null, new Date(), history);
  const file = new File(Paths.cache, backupFileName());
  if (file.exists) file.delete();
  file.create();
  await file.write(JSON.stringify(backup, null, 2));
  if (!(await Sharing.isAvailableAsync())) throw new Error('Sharing is not available on this device.');
  await Sharing.shareAsync(file.uri, {
    mimeType: 'application/json',
    dialogTitle: 'Save your collection backup',
    UTI: 'public.json',
  });
  return scans.reduce((n, s) => n + (s.quantity ?? 1), 0);
}

export async function pickBackup(): Promise<ParsedBackup | null> {
  const picked = await File.pickFileAsync({
    mimeTypes: ['application/json', 'text/plain', 'application/octet-stream'],
  });
  if (picked.canceled || !picked.result) return null;
  return parseBackup(await picked.result.text());
}

export { PREFS_KEY };
