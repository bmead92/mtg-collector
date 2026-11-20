import Constants from 'expo-constants';
import { File, Paths } from 'expo-file-system';
import DownloadsStore from '../../modules/downloads-store';
import { backupFileName, backupsToPrune, buildBackup } from './backup';
import { PREFS_KEY } from './backupFile';
import { getSetting, listAdditions, listSales, listScans, listSnapshots, listSources, setSetting } from './db';
import { dayKey } from './growth';

export const AUTO_BACKUP_FOLDER = 'MTG Collector';
const OLD_FOLDER = 'MTG Collection';
const KEEP = 7;
const LAST_KEY = 'autoBackup.last';

let timer: ReturnType<typeof setTimeout> | null = null;
let running: Promise<unknown> = Promise.resolve();

export const autoBackupAvailable = () => DownloadsStore?.isAvailable() ?? false;

export function scheduleAutoBackup(delayMs = 5000) {
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = null;
    running = running.then(writeAutoBackup).catch(() => {});
  }, delayMs);
}

export async function backupIfDue() {
  const last = await getSetting<string>(LAST_KEY);
  if (!last || dayKey(Date.parse(last)) !== dayKey(Date.now())) scheduleAutoBackup(10_000);
}

async function writeAutoBackup() {
  if (!DownloadsStore || !autoBackupAvailable()) return;
  const [scans, sales] = await Promise.all([listScans(), listSales()]);
  if (scans.length === 0 && sales.length === 0) return;
  const now = new Date();
  const backup = buildBackup(scans, await getSetting(PREFS_KEY), Constants.expoConfig?.version ?? null, now, {
    sources: await listSources(),
    additions: await listAdditions(),
    snapshots: await listSnapshots(),
    sales,
  });
  const name = backupFileName(now);
  const tmp = new File(Paths.cache, `auto-${name}`);
  if (tmp.exists) tmp.delete();
  tmp.create();
  await tmp.write(JSON.stringify(backup));
  try {
    await DownloadsStore.save(tmp.uri, name, AUTO_BACKUP_FOLDER);
  } finally {
    tmp.delete();
  }
  const files = [...(await DownloadsStore.list(AUTO_BACKUP_FOLDER)), ...(await DownloadsStore.list(OLD_FOLDER))];
  for (const old of backupsToPrune(files, KEEP)) await DownloadsStore.remove(old.id);
  await setSetting(LAST_KEY, now.toISOString());
}
