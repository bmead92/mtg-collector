import type { Identification } from './identify';
import type { CardGuess } from './ocr';

const RECENT_MAX = 12;
const recent: string[] = [];

function keep(line: string) {
  recent.push(line);
  if (recent.length > RECENT_MAX) recent.shift();
}

export const recentDiagnostics = (): readonly string[] => recent;

export function logRead(where: string, g: CardGuess) {
  const data = JSON.stringify({ name: g.name, set: g.setCode, num: g.collectorNumber, lang: g.lang, foil: g.foil });
  console.info(`[scan:${where}] read`, data);
  keep(`read ${where} ${data}`);
}

export function logMatch(where: string, r: Identification) {
  const c = r.card;
  const what = c ? `${c.name} (${c.set.toUpperCase()} #${c.collector_number}${c.lang && c.lang !== 'en' ? ` ${c.lang}` : ''})` : 'none';
  console.info(`[scan:${where}] match`, r.method, what);
  keep(`match ${where} ${r.method} ${what}`);
}

export function logFailure(where: string, e: unknown) {
  const msg = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
  console.warn(`[scan:${where}] failed`, msg);
  keep(`failed ${where} ${msg}`);
}
