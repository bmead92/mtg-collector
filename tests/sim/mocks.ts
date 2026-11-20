import { vi } from 'vitest';

vi.mock('../../src/lib/identify', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../src/lib/identify')>();
  const { SETS } = await import('./fixture');
  const { fakeIdentify } = await import('./services');
  return { ...real, identify: fakeIdentify(SETS) };
});

vi.mock('../../src/lib/manapool', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../src/lib/manapool')>();
  const { SETS } = await import('./fixture');
  const { fakeSingles } = await import('./services');
  return { ...real, getSinglesByScryfallId: fakeSingles(SETS) };
});

vi.mock('../../src/lib/diag', () => ({ logRead: () => {}, logMatch: () => {}, logFailure: () => {} }));
