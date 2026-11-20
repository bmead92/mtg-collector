import { APP_VERSION, REPO_URL } from './appInfo';

export interface DeviceInfo {
  model?: string | null;
  brand?: string | null;
  android?: string | number | null;
}

const MAX_URL = 7000; // GitHub rejects very long issue URLs

export function reportUrl(device: DeviceInfo, diagnostics: readonly string[]): string {
  const phone = [device.brand, device.model].filter(Boolean).join(' ') || 'unknown';
  const lines = [
    '**What happened?**',
    '',
    '',
    '**What did you expect?**',
    '',
    '',
    '---',
    `App ${APP_VERSION} · ${phone} · Android ${device.android ?? '?'}`,
  ];
  let diag = [...diagnostics];
  const build = () =>
    `${REPO_URL}/issues/new?` +
    new URLSearchParams({
      title: '',
      body: [...lines, ...(diag.length ? ['', 'Recent scans:', '```', ...diag, '```'] : [])].join('\n'),
    }).toString();
  let url = build();
  while (url.length > MAX_URL && diag.length > 0) {
    diag = diag.slice(1);
    url = build();
  }
  return url;
}
