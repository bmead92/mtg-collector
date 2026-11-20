import type { CardGuess } from './ocr';

export const MIN_STEADY_MS = 400; // two agreeing, unmoved reads spanning at least this long → capture
export const STEADY_MS = 600; // …or a single unchanged read held this long
export const RELEASE_MS = 800; // captured card must be gone this long before it can be captured again
export const MIN_GAP_MS = 800; // never capture faster than this

export interface AutoState {
  key: string | null; // what the camera sees right now (null = no card)
  since: number; // when `key` first appeared
  reads: number; // reads of `key` since then
  box: Box | null; // where the name line was in the last read
  lockedKey: string | null; // last captured card, ignored until it leaves the view
  lockedId: string | null; // its "SET#NUMBER" when known: in a pile its collector line can peek out alone
  id: string | null; // "SET#NUMBER" of the latest read, if it had one
  awaySince: number | null; // when the locked card was last replaced by something else / nothing
  lastCaptureAt: number;
}

export const initialAutoState = (): AutoState => ({
  key: null,
  since: 0,
  reads: 0,
  box: null,
  lockedKey: null,
  lockedId: null,
  id: null,
  awaySince: null,
  lastCaptureAt: -Infinity,
});

export function normalizeName(name: string | null | undefined): string | null {
  const k = (name ?? '').toLowerCase().replace(/[^a-z]/g, '');
  return k.length >= 3 ? k : null;
}

export function cardKey(g: CardGuess): string | null {
  const key = normalizeName(g.name);
  if (!key) return g.lang && g.lang !== 'en' && g.setCode && g.collectorNumber ? `#${collectorId(g)}` : null;
  const lines = g.rawText.split('\n').filter((l) => l.trim().length > 0).length;
  return g.setCode || g.collectorNumber || lines >= 4 ? key : null;
}

function editDistance(a: string, b: string): number {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++)
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length][b.length];
}

export function sameCard(a: string | null, b: string | null): boolean {
  if (!a || !b) return false;
  if (a === b) return true;
  if (a.startsWith('#') || b.startsWith('#')) return false; // collector-line keys must match exactly
  return editDistance(a, b) <= Math.max(1, Math.floor(Math.min(a.length, b.length) * 0.2));
}

export type Box = { x: number; y: number; h: number };

export function moved(a: Box | null | undefined, b: Box | null | undefined): boolean {
  if (!a || !b) return false; // unknown position (e.g. old results): judge by time alone
  const tol = Math.max(a.h, b.h) * 0.5;
  return Math.abs(a.x - b.x) > tol || Math.abs(a.y - b.y) > tol;
}

export function observe(
  s: AutoState,
  key: string | null,
  now: number,
  box: Box | null = null,
  id: string | null = null,
): AutoState {
  const next = { ...s, box: key ? box : null, id };
  if (!sameCard(key, s.key) || moved(box, s.box)) {
    next.key = key;
    next.since = now;
    next.reads = key ? 1 : 0;
  } else if (key) {
    next.reads = s.reads + 1;
  }
  if (next.lockedKey) {
    if (isLocked(next, key, id)) next.awaySince = null;
    else if (next.awaySince == null) next.awaySince = now;
  }
  return next;
}

const isLocked = (s: AutoState, key: string | null, id: string | null) =>
  sameCard(key, s.lockedKey) || (!!id && id === s.lockedId);

export const collectorId = (g: { setCode: string | null; collectorNumber: string | null }) =>
  g.setCode && g.collectorNumber ? `${g.setCode.toUpperCase()}#${g.collectorNumber}` : null;

export const lockCollectorId = (s: AutoState, id: string | null): AutoState => ({ ...s, lockedId: id ?? s.lockedId });

export function check(s: AutoState, now: number): { state: AutoState; capture: boolean } {
  let state = s;
  if (state.lockedKey && state.awaySince != null && now - state.awaySince >= RELEASE_MS) {
    state = { ...state, lockedKey: null, lockedId: null, awaySince: null };
  }
  const held = now - state.since;
  const ready =
    state.key != null &&
    ((state.reads >= 2 && held >= MIN_STEADY_MS) || held >= STEADY_MS) &&
    now - state.lastCaptureAt >= MIN_GAP_MS &&
    !isLocked(state, state.key, state.id);
  if (!ready) return { state, capture: false };
  return {
    state: { ...state, lockedKey: state.key, lockedId: state.id, awaySince: null, lastCaptureAt: now },
    capture: true,
  };
}

function mostCommon<T>(values: (T | null | undefined)[], keyOf: (v: T) => string = String): T | null {
  const counts = new Map<string, { v: T; n: number }>();
  for (const v of values) {
    if (v == null) continue;
    const k = keyOf(v);
    const e = counts.get(k);
    if (e) e.n++;
    else counts.set(k, { v, n: 1 });
  }
  let best: { v: T; n: number } | null = null;
  for (const e of counts.values()) if (!best || e.n > best.n) best = e;
  return best?.v ?? null;
}

export function mergeReads(reads: CardGuess[]): (CardGuess & { numberVotes: number }) | null {
  if (reads.length === 0) return null;
  const name = mostCommon(reads.map((r) => r.name), (n) => normalizeName(n) ?? n);
  const setCode = mostCommon(reads.map((r) => r.setCode));
  const withSet = reads.filter((r) => r.setCode === setCode);
  const collectorNumber =
    mostCommon(withSet.map((r) => r.collectorNumber)) ?? mostCommon(reads.map((r) => r.collectorNumber));
  const numberVotes = withSet.filter((r) => r.setCode && r.collectorNumber === collectorNumber).length;
  const lang = mostCommon(withSet.map((r) => r.lang)) ?? mostCommon(reads.map((r) => r.lang));
  const foilVotes = withSet.filter((r) => r.setCode).map((r) => r.foil);
  const foil = foilVotes.length > 0 && foilVotes.filter(Boolean).length * 2 > foilVotes.length;
  const rawText = reads.reduce((a, r) => (r.rawText.length > a.length ? r.rawText : a), '');
  return { name, setCode, collectorNumber, lang, foil, rawText, turns: reads[reads.length - 1].turns, numberVotes };
}

export const isCompleteRead = (g: (CardGuess & { numberVotes?: number }) | null) =>
  !!g &&
  (!!g.name || (!!g.lang && g.lang !== 'en')) &&
  !!g.setCode &&
  !!g.collectorNumber &&
  (g.numberVotes ?? 0) >= 2;

export function guideToScanRegion(
  g: { viewWidth: number; viewHeight: number; x: number; y: number; width: number; height: number },
  frameWidth: number,
  frameHeight: number,
  padX = 0.01,
  padY = 0.03,
): { left: number; top: number; width: number; height: number } {
  const s = Math.max(g.viewWidth / frameWidth, g.viewHeight / frameHeight);
  const ox = (g.viewWidth - frameWidth * s) / 2;
  const oy = (g.viewHeight - frameHeight * s) / 2;
  let x0 = (g.x - ox) / s;
  let y0 = (g.y - oy) / s;
  let x1 = (g.x + g.width - ox) / s;
  let y1 = (g.y + g.height - oy) / s;
  const px = (x1 - x0) * padX;
  const py = (y1 - y0) * padY;
  x0 = Math.max(0, x0 - px);
  y0 = Math.max(0, y0 - py);
  x1 = Math.min(frameWidth, x1 + px);
  y1 = Math.min(frameHeight, y1 + py);
  const pct = (v: number, of: number) => Math.round((v / of) * 1000) / 10;
  return {
    left: pct(x0, frameWidth),
    top: pct(y0, frameHeight),
    width: pct(x1 - x0, frameWidth),
    height: pct(y1 - y0, frameHeight),
  };
}
