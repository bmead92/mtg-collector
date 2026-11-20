import { afterEach, describe, expect, it, vi } from 'vitest';
import { checkForUpdate, compareVersions, dismissUpdate, updateFrom, type UpdateStore } from '../src/lib/updates';

afterEach(() => vi.unstubAllGlobals());

const memoryStore = (): UpdateStore & { data: Map<string, unknown> } => {
  const data = new Map<string, unknown>();
  return {
    data,
    get: async <T,>(k: string) => (data.has(k) ? (data.get(k) as T) : null),
    set: async (k: string, v: unknown) => void data.set(k, v),
  };
};

const release = (tag: string, extra: object = {}) => ({
  tag_name: tag,
  html_url: `https://github.com/bmead92/mtg-collector/releases/tag/${tag}`,
  assets: [{ name: 'app-release.apk', browser_download_url: `https://github.com/x/${tag}/app-release.apk` }],
  ...extra,
});

describe('versions', () => {
  it('compares', () => {
    expect(compareVersions('0.13.0', '0.12.1')).toBeGreaterThan(0);
    expect(compareVersions('v1.0.0', '0.99.9')).toBeGreaterThan(0);
    expect(compareVersions('0.12.1', 'v0.12.1')).toBe(0);
    expect(compareVersions('0.9.0', '0.10.0')).toBeLessThan(0);
  });

  it('reads a GitHub release', () => {
    expect(updateFrom(release('v1.0.0'), '0.13.0')).toEqual({ version: '1.0.0', url: 'https://github.com/x/v1.0.0/app-release.apk' });
    expect(updateFrom(release('v0.13.0'), '0.13.0')).toBeNull();
    expect(updateFrom(release('v1.0.0', { prerelease: true }), '0.13.0')).toBeNull();
    expect(updateFrom(release('v1.0.0', { assets: [] }), '0.13.0')?.url).toContain('/releases/tag/v1.0.0');
  });
});

describe('daily check', () => {
  it('asks GitHub at most once a day, offers a newer build, remembers a dismissal', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(release('v9.0.0'))));
    vi.stubGlobal('fetch', fetchMock);
    const store = memoryStore();
    const t = Date.UTC(2026, 10, 18);
    expect((await checkForUpdate(store, t))?.version).toBe('9.0.0');
    expect((await checkForUpdate(store, t + 3600_000))?.version).toBe('9.0.0');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await dismissUpdate(store, '9.0.0');
    expect(await checkForUpdate(store, t + 7200_000)).toBeNull();
    await checkForUpdate(store, t + 25 * 3600_000);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('offline or private repo (404): quietly nothing', async () => {
    const store = memoryStore();
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 404 })));
    expect(await checkForUpdate(store, 1)).toBeNull();
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline'); }));
    expect(await checkForUpdate(memoryStore(), 1)).toBeNull();
  });
});
