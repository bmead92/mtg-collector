import './sim/mocks';
import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it } from 'vitest';
import { buildBackup, parseBackup } from '../src/lib/backup';
import { parseDeckText } from '../src/lib/deckText';
import { preconCards, preconProduct, searchPrecons, slimDeckList } from '../src/lib/precons';
import { paidSummary, type Sale } from '../src/lib/sales';
import { slimProduct, type SealedProduct } from '../src/lib/sealed';
import { groupOpened, summarizeSources } from '../src/lib/sources';
import { launchApp } from './sim/harness';
import { resetDatabases } from './stubs/expo-sqlite';

const fixture = (name: string) => JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8'));

beforeEach(() => resetDatabases());

describe('deck text', () => {
  it('reads a Moxfield export', () => {
    const { lines } = parseDeckText(`1 Ellivere of the Wild Court (WOC) 2 *F*
1 Arcane Signet (WOC) 147
1 Delver of Secrets / Insectile Aberration (ISD) 51

SIDEBOARD:
2 Plains (WOE) 262`);
    expect(lines).toEqual([
      { quantity: 1, name: 'Ellivere of the Wild Court', set: 'woc', number: '2', finish: 'foil' },
      { quantity: 1, name: 'Arcane Signet', set: 'woc', number: '147', finish: null },
      { quantity: 1, name: 'Delver of Secrets // Insectile Aberration', set: 'isd', number: '51', finish: null },
      { quantity: 2, name: 'Plains', set: 'woe', number: '262', finish: null },
    ]);
  });

  it('reads an Archidekt export, skipping the maybeboard', () => {
    const { lines } = parseDeckText(`1x Sol Ring (cmr) 472 [Ramp] ^Have,#37d67a^
1x Jeweled Lotus (cmr) 319 *F* [Ramp]
1x The One Ring (ltr) 246 [Maybeboard{noDeck}{noPrice}]
3x Forest (dmu) 277 [Land]`);
    expect(lines.map((l) => [l.quantity, l.name, l.set, l.number, l.finish])).toEqual([
      [1, 'Sol Ring', 'cmr', '472', null],
      [1, 'Jeweled Lotus', 'cmr', '319', 'foil'],
      [3, 'Forest', 'dmu', '277', null],
    ]);
  });

  it('reads Arena and plain lists, merges repeats, skips maybeboard sections', () => {
    const { lines, unreadable } = parseDeckText(`Commander
1 Atraxa, Praetors' Voice (2X2) 190

Deck
4 Lightning Bolt
Lightning Bolt
1 Cultivate (M21) 177
// comment
Maybeboard
1 Doubling Season (2X2) 147`);
    expect(lines.map((l) => [l.quantity, l.name, l.set])).toEqual([
      [1, "Atraxa, Praetors' Voice", '2x2'],
      [5, 'Lightning Bolt', null],
      [1, 'Cultivate', 'm21'],
    ]);
    expect(unreadable).toEqual([]);
  });

  it('keeps PLST style numbers and etched cards', () => {
    const { lines } = parseDeckText('1 Sol Ring (PLST) CMR-472\n1 Commander\'s Sphere (CMM) 696 *E*');
    expect(lines[0]).toMatchObject({ set: 'plst', number: 'CMR-472' });
    expect(lines[1]).toMatchObject({ finish: 'etched' });
  });
});

describe('precons', () => {
  const list = slimDeckList(fixture('mtgjson-decklist.json').data);

  it('lists paper decks only, newest first, searchable', () => {
    expect(list.some((p) => /mtgo|arena|shandalar/i.test(p.type))).toBe(false);
    const commander = list.filter((p) => p.type === 'Commander Deck');
    expect(list.slice(0, commander.length)).toEqual(commander);
    expect(commander.every((p, i) => i === 0 || commander[i - 1].releaseDate >= p.releaseDate)).toBe(true);
    expect(searchPrecons(list, 'virtue').map((p) => p.name)).toEqual(['Virtue and Valor']);
    expect(searchPrecons(list, 'woc').every((p) => p.code === 'WOC')).toBe(true);
  });

  it('reads a deck file: commander + 99, foil commander', () => {
    const cards = preconCards(fixture('mtgjson-virtue-and-valor.json').data);
    expect(cards.reduce((n, c) => n + c.quantity, 0)).toBe(100);
    expect(cards.find((c) => c.name === 'Ellivere of the Wild Court')).toMatchObject({ foil: true, quantity: 1 });
  });

  it('finds the sealed product for its price', () => {
    const catalog = (fixture('sealed-precons.json') as Record<string, unknown>[])
      .map(slimProduct)
      .filter((p): p is SealedProduct => !!p);
    expect(preconProduct(catalog, { name: 'Virtue and Valor', code: 'WOC' })?.name).toBe(
      'Wilds of Eldraine Commander Deck Virtue and Valor',
    );
    expect(preconProduct(catalog, { name: 'Grand Larceny', code: 'OTC' })?.name).toMatch(/Grand Larceny$/);
    expect(preconProduct(catalog, { name: 'Not A Deck', code: 'WOC' })).toBeNull();
  });
});

describe('precons in the collection', () => {
  it('saved cards belong to the precon; it shows in its own group and survives a backup', async () => {
    const app = await launchApp();
    const src = await app.db.createSource({ kind: 'precon', name: 'Virtue and Valor', cost_cents: 4500, packs: 1, set_code: 'WOC' });
    const card = (id: string, price: number, quantity: number) => ({
      photo_uri: '',
      scryfall_id: id,
      name: id,
      set_code: 'woc',
      set_name: 'Wilds of Eldraine Commander',
      collector_number: id,
      image_uri: null,
      finish: 'nonfoil' as const,
      condition: 'NM' as const,
      price_cents: price,
      market_cents: price,
      manapool_url: null,
      price_updated_at: null,
      type_line: 'Creature',
      color_identity: 'G',
      rarity: 'rare',
      released_at: '2023-09-08',
      layout: 'normal',
      quantity,
    });
    await app.db.insertScans([card('a', 1000, 1), card('b', 50, 30)], src);
    const rows = await app.db.listSourceCards(src);
    const [s] = summarizeSources(
      await app.db.listSources(),
      rows.map((r) => ({ source_id: r.source_id, copies: r.copies, priceCents: r.price_cents })),
    );
    expect(s).toMatchObject({ cards: 31, valueCents: 2500, gainCents: -2000 });
    expect(groupOpened([s]).precons).toHaveLength(1);

    const b = parseBackup(
      JSON.stringify(
        buildBackup(await app.db.listScans(), null, '1', new Date(), {
          sources: await app.db.listSources(),
          additions: await app.db.listAdditions(),
        }),
      ),
    ).backup;
    expect(b.sources?.[0]).toMatchObject({ kind: 'precon', cost_cents: 4500 });
  });
});

describe('paid', () => {
  it('singles at their added price, sealed and precons at cost, sold singles included', () => {
    const sale = {
      id: 1,
      sold_at: '2026-11-01',
      quantity: 1,
      sold_cents: 900,
      card: {},
      from: [{ source_id: null, quantity: 1, price_cents: 700, added_at: '2026-10-01' }],
    } as unknown as Sale;
    expect(
      paidSummary({
        sources: [
          { kind: 'pack', cost_cents: 500 },
          { kind: 'box', cost_cents: 15000 },
          { kind: 'precon', cost_cents: 4500 },
          { kind: 'pack', cost_cents: null },
        ],
        ownedAdditions: [
          { quantity: 2, price_cents: 100 },
          { quantity: 1, price_cents: null },
        ],
        sales: [sale],
        worthCents: 19000,
      }),
    ).toEqual({
      singlesCents: 900,
      sealedCents: 15500,
      preconsCents: 4500,
      totalCents: 20900,
      returnCents: 19900,
      gainCents: -1000,
    });
  });
});
