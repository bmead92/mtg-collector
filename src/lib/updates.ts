import { APP_VERSION, USER_AGENT } from './appInfo';

const LATEST = 'https://api.github.com/repos/bmead92/mtg-collector/releases/latest';
const CHECK_EVERY_MS = 24 * 60 * 60 * 1000;

export interface Update {
  version: string;
  url: string;
}

export function compareVersions(a: string, b: string): number {
  const parse = (v: string) => v.replace(/^v/i, '').split(/[.-]/).map((x) => parseInt(x, 10) || 0);
  const x = parse(a);
  const y = parse(b);
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const d = (x[i] ?? 0) - (y[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

interface Release {
  tag_name?: string;
  html_url?: string;
  draft?: boolean;
  prerelease?: boolean;
  assets?: { name?: string; browser_download_url?: string }[];
}

export function updateFrom(release: Release, current = APP_VERSION): Update | null {
  if (!release.tag_name || release.draft || release.prerelease) return null;
  if (compareVersions(release.tag_name, current) <= 0) return null;
  const apk = release.assets?.find((a) => a.name?.endsWith('.apk'))?.browser_download_url;
  const url = apk ?? release.html_url;
  return url ? { version: release.tag_name.replace(/^v/i, ''), url } : null;
}

export interface UpdateStore {
  get<T>(key: string): Promise<T | null>;
  set(key: string, value: unknown): Promise<void>;
}

export async function checkForUpdate(store: UpdateStore, now = Date.now()): Promise<Update | null> {
  const last = await store.get<{ at: number; update: Update | null }>('update.last');
  let update = last?.update ?? null;
  if (!last || now - last.at >= CHECK_EVERY_MS) {
    try {
      const res = await fetch(LATEST, { headers: { Accept: 'application/vnd.github+json', 'User-Agent': USER_AGENT } });
      update = res.ok ? updateFrom((await res.json()) as Release) : null;
      await store.set('update.last', { at: now, update });
    } catch {
    }
  }
  if (!update || compareVersions(update.version, APP_VERSION) <= 0) return null;
  const dismissed = await store.get<string>('update.dismissed');
  return dismissed === update.version ? null : update;
}

export const dismissUpdate = (store: UpdateStore, version: string) => store.set('update.dismissed', version);
