import { describe, expect, it } from 'vitest';
import { reportUrl } from '../src/lib/report';

describe('report a problem', () => {
  it('prefills app version, phone and recent scans', () => {
    const url = reportUrl({ brand: 'samsung', model: 'SM-G991U', android: 15 }, ['read auto {"name":"Sol Ring"}', 'match auto set+number Sol Ring (CMR #472)']);
    expect(url.startsWith('https://github.com/bmead92/mtg-collector/issues/new?')).toBe(true);
    const body = new URL(url).searchParams.get('body')!;
    expect(body).toContain('samsung SM-G991U · Android 15');
    expect(body).toContain('Sol Ring (CMR #472)');
  });

  it('stays under GitHub URL limits by dropping the oldest scans', () => {
    const many = Array.from({ length: 200 }, (_, i) => `read auto ${'x'.repeat(80)} ${i}`);
    const url = reportUrl({}, many);
    expect(url.length).toBeLessThanOrEqual(7000);
    expect(new URL(url).searchParams.get('body')).toContain(' 199');
  });
});
