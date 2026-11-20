import { useSyncExternalStore } from 'react';
import type { Photo } from 'react-native-vision-camera';
import { processSavedCapture, savePhoto, type GuideFrame, type SavedCapture } from './capture';
import { createSource, getSource, insertScan, loadStackItems, updateSource, writeStackItems } from './db';
import { scryfallCents, serializePrices, type HeadlineSource } from './prices';
import { logFailure, logMatch, logRead } from './diag';
import { defaultFinish, identify, nameAppearsIn, type MatchMethod } from './identify';
import { getSinglesByScryfallId, headlinePrice, quoteFor, type Condition, type ManaPoolSingle } from './manapool';
import { normalizeName, sameCard } from './autoScan';
import type { CardGuess } from './ocr';
import { deletePhoto } from './photos';
import { pricingPrinting } from './language';
import { cardImage, cardMeta, type Finish, type ScryfallCard } from './scryfall';
import type { NewSource } from './sources';

export type StackStatus = 'queued' | 'reading' | 'identifying' | 'pricing' | 'done' | 'failed';

export interface StackItem {
  id: string;
  number: number; // 1-based shot order
  addedAt: number; // ms timestamp, for "Repeat?" hints in review
  status: StackStatus;
  photoUri: string | null;
  guess: CardGuess | null;
  card: ScryfallCard | null;
  method: MatchMethod;
  finish: Finish;
  condition: Condition;
  single: ManaPoolSingle | null;
  priceCard?: ScryfallCard | null;
  include: boolean;
  doubtful?: boolean;
  error?: string;
}

let items: StackItem[] = [];
let shotCounter = 0;
const listeners = new Set<() => void>();

function emit() {
  items = [...items]; // new identity so useSyncExternalStore re-renders
  listeners.forEach((l) => l());
  scheduleFlush();
}

let persisted = new Map<string, StackItem>();
let restored: Promise<void> | null = null;
let flushTimer: ReturnType<typeof setTimeout> | null = null;
let flushChain: Promise<void> = Promise.resolve();
const FLUSH_DELAY_MS = 300;

function scheduleFlush() {
  if (flushTimer) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    void flushStack();
  }, FLUSH_DELAY_MS);
}

export function flushStack(): Promise<void> {
  if (flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  flushChain = flushChain
    .then(async () => {
      await restoreStack(); // never overwrite a saved Stack that hasn't been loaded yet
      const snapshot = new Map(items.map((it) => [it.id, it]));
      const upserts = items.filter((it) => persisted.get(it.id) !== it);
      const deletes = [...persisted.keys()].filter((id) => !snapshot.has(id));
      if (upserts.length === 0 && deletes.length === 0) return;
      await writeStackItems(
        upserts.map((it) => ({ id: it.id, data: JSON.stringify(it) })),
        deletes,
      );
      persisted = snapshot;
    })
    .catch((e) => console.warn('[stack] could not save the unsaved Stack', e));
  return flushChain;
}

const INTERRUPTED = 'The app closed before this card was read. Scan it again.';

export function restoreStack(): Promise<void> {
  restored ??= (async () => {
    let saved: StackItem[] = [];
    try {
      saved = (await loadStackItems()).map((d) => JSON.parse(d) as StackItem);
    } catch (e) {
      console.warn('[stack] could not load the unsaved Stack', e);
      return;
    }
    if (saved.length === 0) return;
    saved.sort((a, b) => a.number - b.number);
    persisted = new Map(saved.map((it) => [it.id, it]));
    const resume: StackItem[] = [];
    const revived = saved.map((it): StackItem => {
      if (it.status === 'queued' || it.status === 'reading') return { ...it, status: 'failed', error: INTERRUPTED };
      if ((it.status === 'identifying' || it.status === 'pricing') && it.guess) {
        const r = { ...it, status: 'identifying' as const };
        resume.push(r);
        return r;
      }
      return it;
    });
    shotCounter = Math.max(shotCounter, ...revived.map((it) => it.number));
    const fresh = items.filter((it) => !persisted.has(it.id)).map((it) => ({ ...it, number: ++shotCounter }));
    items = [...revived, ...fresh];
    emit();
    for (const it of resume)
      identifyAndPrice(it.id, it.guess!, null).catch((e) => {
        logFailure('restore', e);
        updateItem(it.id, { status: 'failed', error: String(e) });
      });
  })();
  return restored;
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}

export function useStack(): StackItem[] {
  return useSyncExternalStore(subscribe, () => items);
}

export const getStackItems = (): readonly StackItem[] => items;

export function updateItem(id: string, patch: Partial<StackItem>) {
  const i = items.findIndex((it) => it.id === id);
  if (i < 0) return;
  items[i] = { ...items[i], ...patch };
  emit();
}

export function removeItem(id: string) {
  const it = items.find((x) => x.id === id);
  if (it?.photoUri) deletePhoto(it.photoUri);
  const waiting = ready.get(id);
  if (waiting) deletePhoto(waiting.capture.path);
  ready.delete(id);
  items = items.filter((x) => x.id !== id);
  emit();
}

export function clearStack() {
  for (const it of items) if (it.photoUri) deletePhoto(it.photoUri);
  for (const { capture } of ready.values()) deletePhoto(capture.path);
  ready.clear();
  items = [];
  shotCounter = 0;
  emit();
}

export const isBusy = (it: StackItem) => it.status !== 'done' && it.status !== 'failed';

const ready = new Map<string, { capture: SavedCapture; guide: GuideFrame | null; hint: CardGuess | null }>();
const MAX_WORKERS = 2; // OCR/decoding run natively, so two at a time drains the queue ~2x faster
let activeWorkers = 0;

export function enqueue(photo: Photo, guide: GuideFrame | null = null, hint: CardGuess | null = null) {
  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  items.push({
    id,
    number: ++shotCounter,
    addedAt: Date.now(),
    status: 'queued',
    photoUri: null,
    guess: null,
    card: null,
    method: 'none',
    finish: 'nonfoil',
    condition: 'NM',
    single: null,
    include: true,
  });
  emit();

  savePhoto(photo)
    .then((capture) => {
      if (!items.some((it) => it.id === id)) return deletePhoto(capture.path); // removed meanwhile
      ready.set(id, { capture, guide, hint });
      pump();
    })
    .catch((e) => updateItem(id, { status: 'failed', error: String(e) }));
}

function pump() {
  while (activeWorkers < MAX_WORKERS) {
    const next = items.find((it) => it.status === 'queued' && ready.has(it.id));
    if (!next) return;
    const job = ready.get(next.id)!;
    ready.delete(next.id);
    updateItem(next.id, { status: 'reading' }); // claim it synchronously so it isn't picked twice
    activeWorkers++;
    processItem(next.id, job.capture, job.guide, job.hint).finally(() => {
      activeWorkers--;
      pump();
    });
  }
}

function nameMatches(card: ScryfallCard, g: CardGuess | null): boolean {
  if (!g) return false;
  if (nameAppearsIn(card.name, g.rawText)) return true;
  const read = normalizeName(g.name);
  if (!read) return false;
  const names = [
    ...card.name.split(' // '),
    ...(card.flavor_name ? [card.flavor_name] : []),
    ...(card.printed_name ? card.printed_name.split(' // ') : []),
  ];
  return names.some((face) => {
    const f = normalizeName(face);
    return !!f && (sameCard(read, f) || (read.length >= 5 && (f.includes(read) || read.includes(f))));
  });
}

const REPEAT_WINDOW_MS = 30_000;

export function isLikelyRepeat(it: StackItem, all: StackItem[]): boolean {
  if (!it.card) return false;
  return all.some(
    (o) =>
      o.number < it.number &&
      o.include &&
      o.card?.id === it.card!.id &&
      o.finish === it.finish &&
      it.addedAt - o.addedAt < REPEAT_WINDOW_MS,
  );
}

const readScore = (g: CardGuess | null) => (g ? (g.name ? 1 : 0) + (g.setCode ? 1 : 0) + (g.collectorNumber ? 1 : 0) : -1);

export function enqueueRead(guess: CardGuess) {
  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  items.push({
    id,
    number: ++shotCounter,
    addedAt: Date.now(),
    status: 'identifying',
    photoUri: null,
    guess,
    card: null,
    method: 'none',
    finish: 'nonfoil',
    condition: 'NM',
    single: null,
    include: true,
  });
  emit();
  logRead('auto', guess);
  identifyAndPrice(id, guess, null).catch((e) => {
    logFailure('auto', e);
    updateItem(id, { status: 'failed', error: String(e) });
  });
}

async function processItem(id: string, capture: SavedCapture, guide: GuideFrame | null, hint: CardGuess | null) {
  try {
    const { photoUri, guess } = await processSavedCapture(capture, guide);
    if (!items.some((it) => it.id === id)) return deletePhoto(photoUri); // removed while reading
    logRead('stack', guess);
    updateItem(id, { photoUri, guess, status: 'identifying' });
    await identifyAndPrice(id, guess, hint);
  } catch (e) {
    logFailure('stack', e);
    updateItem(id, { status: 'failed', error: String(e) });
  }
}

async function identifyAndPrice(id: string, guess: CardGuess, hint: CardGuess | null) {
  const [first, second] = hint && readScore(hint) >= readScore(guess) ? [hint, guess] : [guess, hint];
  let result = await identify(first);
  if (!result.card && second) {
    const retry = await identify(second);
    if (retry.card) result = retry;
  }
  if (hint) console.info('[auto] used', first === hint ? 'frame read' : 'photo read', result.card ? 'ok' : 'no match');
  logMatch('stack', result);
  const { card, method, foil } = result;
  if (!card) return updateItem(id, { status: 'done', method: 'none' });
  const doubtful = card.lang !== 'en' && card.lang ? false : !nameMatches(card, guess) && !nameMatches(card, hint);
  updateItem(id, { card, method, finish: defaultFinish(card, foil), status: 'pricing', doubtful });

  const priceCard = await pricingPrinting(card);
  const singles = await getSinglesByScryfallId([priceCard.id]);
  updateItem(id, {
    single: singles.get(priceCard.id) ?? null,
    priceCard: priceCard.id === card.id ? null : priceCard,
    status: 'done',
  });
}

export async function setItemCard(id: string, card: ScryfallCard, method: MatchMethod = 'set+number') {
  const current = items.find((it) => it.id === id);
  const finish =
    current && card.finishes.includes(current.finish) ? current.finish : defaultFinish(card, current?.guess?.foil);
  updateItem(id, { card, method, finish, single: null, priceCard: null, status: 'pricing', include: true, doubtful: false });
  try {
    const priceCard = await pricingPrinting(card);
    const singles = await getSinglesByScryfallId([priceCard.id]);
    updateItem(id, {
      single: singles.get(priceCard.id) ?? null,
      priceCard: priceCard.id === card.id ? null : priceCard,
      status: 'done',
    });
  } catch (e) {
    updateItem(id, { status: 'done', error: String(e) });
  }
}

export function itemPrice(it: StackItem, source: HeadlineSource = 'manapool'): number | null {
  const pc = it.priceCard ?? it.card;
  if (source === 'tcgplayer') return pc ? scryfallCents(pc.prices ?? null, 'tcgplayer', it.finish) : null;
  return it.single ? headlinePrice(quoteFor(it.single, it.finish, it.condition)) : null;
}

export type SaveTarget =
  | { kind: 'owned' } // already owned (singles, old collection)
  | { kind: 'new'; source: NewSource } // a pack / box opened now (packs_opened = packs in this Stack)
  | { kind: 'existing'; sourceId: number; packsOpened: number }; // more packs from a box being opened

export const savableItems = (list: readonly StackItem[]) =>
  list.filter((it) => it.include && it.card && it.status === 'done');

export async function saveStack(target: SaveTarget = { kind: 'owned' }): Promise<number> {
  const toSave = savableItems(items);
  if (toSave.length === 0) return 0;
  let sourceId: number | null = null;
  if (target.kind === 'new') {
    sourceId = await createSource(target.source);
  } else if (target.kind === 'existing') {
    const src = await getSource(target.sourceId);
    if (src) {
      sourceId = src.id;
      await updateSource(src.id, { packs_opened: src.packs_opened + Math.max(0, target.packsOpened) });
    }
  }
  let saved = 0;
  try {
    for (const it of toSave) {
      const card = it.card!;
      const q = it.single ? quoteFor(it.single, it.finish, it.condition) : null;
      await insertScan({
        photo_uri: '', // photos aren't kept once a card is saved; the Scryfall image is shown instead
        scryfall_id: card.id,
        name: card.name,
        set_code: card.set,
        set_name: card.set_name,
        collector_number: card.collector_number,
        image_uri: cardImage(card, 'normal'),
        ...cardMeta(card),
        sf_prices: serializePrices((it.priceCard ?? card).prices),
        price_id: it.priceCard?.id ?? null,
        finish: it.finish,
        condition: it.condition,
        price_cents: q ? headlinePrice(q) : null,
        market_cents: q?.marketCents ?? null,
        low_cents: q?.lowCents ?? null,
        manapool_url: q?.url ?? null,
        price_updated_at: q ? new Date().toISOString() : null,
      }, sourceId);
      await writeStackItems([], [it.id]);
      persisted.delete(it.id);
      if (it.photoUri) deletePhoto(it.photoUri);
      items = items.filter((x) => x.id !== it.id);
      saved++;
    }
  } finally {
    emit();
  }
  return saved;
}
