import { vi } from 'vitest';
import type { Pull } from './packs';
import { frameReads, TYPICAL_NOISE, type ReadNoise } from './reads';
import type { Rng } from './rng';

export type App = {
  stack: typeof import('../../src/lib/stack');
  db: typeof import('../../src/lib/db');
  autoScan: typeof import('../../src/lib/autoScan');
};

export async function launchApp(): Promise<App> {
  vi.resetModules();
  const [stack, db, autoScan] = await Promise.all([
    import('../../src/lib/stack'),
    import('../../src/lib/db'),
    import('../../src/lib/autoScan'),
  ]);
  await stack.restoreStack();
  return { stack, db, autoScan };
}

export function scanCard(app: App, pull: Pull, rng: Rng, noise: ReadNoise = TYPICAL_NOISE) {
  const merged = app.autoScan.mergeReads(frameReads(pull, rng, noise));
  if (merged) app.stack.enqueueRead(merged);
}

export function scanPulls(app: App, pulls: Pull[], rng: Rng, noise?: ReadNoise) {
  for (const p of pulls) scanCard(app, p, rng, noise);
}

export async function settle(app: App, items: () => readonly { status: string }[] = () => currentItems(app)) {
  for (let i = 0; i < 200; i++) {
    await new Promise((r) => setTimeout(r, 0));
    if (items().every((it) => it.status === 'done' || it.status === 'failed')) break;
  }
  await app.stack.flushStack();
}

export const currentItems = (app: App) => app.stack.getStackItems();

export async function review(app: App, pulls: Pull[]): Promise<{ cardFixes: number; finishFixes: number }> {
  let cardFixes = 0;
  let finishFixes = 0;
  const items = app.stack.getStackItems();
  for (const [i, it] of items.entries()) {
    const pull = pulls[i];
    if (!pull) continue;
    if (it.card?.id !== pull.card.id) {
      cardFixes++;
      await app.stack.setItemCard(it.id, pull.card);
    }
  }
  for (const [i, it] of app.stack.getStackItems().entries()) {
    const want = pulls[i]?.finish;
    if (want && it.finish !== want) {
      finishFixes++;
      app.stack.updateItem(it.id, { finish: want });
    }
  }
  await app.stack.flushStack();
  return { cardFixes, finishFixes };
}
