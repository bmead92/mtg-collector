#!/usr/bin/env python3
"""Demo collection generator: writes a backup file (format v2) to restore in the app (⋯ → Restore from backup).

Cards are real (Scryfall), pulled into packs roughly the way boosters are built, and priced from Mana Pool's
current prices. Openings are dated, so the Opened tab, the pack / box pages and Growth all have something
to show. For screenshots and UI testing only; nothing here ships in the app.

  python scripts/make-demo-backup.py --scenario recent    --out demo.json [--owned-db scans.db]
  python scripts/make-demo-backup.py --scenario collector --out demo.json

  recent     six weeks: a few loose packs, a finished play box, a collector box in progress
             (--owned-db: an app database copy whose cards become "already owned" at the start)
  collector  twenty years of a heavy spender: boxes most years, collector boxes, Masters boxes, loose packs,
             singles bought along the way; paid prices are typical retail at the time

Then: adb push demo.json /sdcard/Download/ and restore it in the app ("Replace my collection" for a clean demo).
Uses only the standard library. Be gentle with the APIs: requests are spaced out (Scryfall asks for 50-100 ms).
"""
import argparse, hashlib, json, os, random, re, sqlite3, sys, time, urllib.error, urllib.parse, urllib.request
from datetime import date, datetime, timedelta, timezone

UA = {'User-Agent': 'MTGCollection-demo-generator/1.0', 'Accept': 'application/json'}
ORDER = 'WUBRG'


def log(*a):
    print(*a, file=sys.stderr, flush=True)


CACHE = None


def get(url):
    path = CACHE and os.path.join(CACHE, hashlib.sha1(url.encode()).hexdigest() + '.json')
    if path and os.path.exists(path):
        with open(path, encoding='utf8') as f:
            return json.load(f)
    time.sleep(0.12)
    for attempt in range(6):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=60) as r:
                data = json.load(r)
            if path:
                with open(path, 'w', encoding='utf8') as f:
                    json.dump(data, f)
            return data
        except urllib.error.HTTPError as e:
            if e.code == 404:
                return None
            if e.code == 429 or e.code >= 500:
                time.sleep(int(e.headers.get('Retry-After') or 0) or 10 * (attempt + 1))
                continue
            raise
    raise RuntimeError(f'gave up on {url}')


def post(url, body):
    key = url + json.dumps(body, sort_keys=True)
    path = CACHE and os.path.join(CACHE, hashlib.sha1(key.encode()).hexdigest() + '.json')
    if path and os.path.exists(path):
        with open(path, encoding='utf8') as f:
            return json.load(f)
    time.sleep(0.12)
    req = urllib.request.Request(url, data=json.dumps(body).encode(), headers={**UA, 'Content-Type': 'application/json'})
    for attempt in range(6):
        try:
            with urllib.request.urlopen(req, timeout=60) as r:
                data = json.load(r)
            if path:
                with open(path, 'w', encoding='utf8') as f:
                    json.dump(data, f)
            return data
        except urllib.error.HTTPError as e:
            if e.code == 429 or e.code >= 500:
                time.sleep(int(e.headers.get('Retry-After') or 0) or 10 * (attempt + 1))
                continue
            raise
    raise RuntimeError(f'gave up on {url}')


def cards_by_id(ids):
    out = {}
    for i in range(0, len(ids), 75):
        body = post('https://api.scryfall.com/cards/collection', {'identifiers': [{'id': x} for x in ids[i:i + 75]]})
        for c in body.get('data', []):
            out[c['id']] = c
    return out


def search(q):
    url = 'https://api.scryfall.com/cards/search?' + urllib.parse.urlencode({'q': q, 'unique': 'prints'})
    out = []
    while url:
        page = get(url)
        if not page:
            break
        out += page['data']
        url = page.get('next_page') if page.get('has_more') else None
    return out


def iso(dt):
    return dt.strftime('%Y-%m-%dT%H:%M:%S.000Z')


class Gen:
    def __init__(self, seed, today):
        self.rng = random.Random(seed)
        self.today = today
        self.pools = {}
        self.sources = []
        self.events = []  # (card, finish, condition, added_at datetime, source ref | None)
        self.sealed = (get('https://manapool.com/api/v1/prices/sealed') or {}).get('data', [])

    def pool(self, code):
        if code in self.pools:
            return self.pools[code]
        cards = [c for c in search(f'set:{code} is:booster game:paper') if c.get('lang') == 'en']
        if len([c for c in cards if c['rarity'] == 'common']) < 20:  # older / odd sets: the whole set
            cards = [c for c in search(f'set:{code} game:paper') if c.get('lang') == 'en']
        in_boosters = [c for c in cards if c.get('booster')]
        special = {'serialized', 'headliner', 'poster', 'gleaminggold'}
        cards = in_boosters if len(in_boosters) * 2 >= len(cards) else [
            c for c in cards if c.get('finishes') != ['foil'] and not special & set(c.get('promo_types') or [])]
        num = lambda c: int(''.join(ch for ch in c['collector_number'] if ch.isdigit()) or 0)
        commons = [c for c in cards if c['rarity'] == 'common']
        limit = max((num(c) for c in commons), default=10 ** 6)
        main = [c for c in cards if num(c) <= limit]  # higher numbers are variants
        by = lambda r: [c for c in main if c['rarity'] == r]
        p = {
            'common': by('common') or main, 'uncommon': by('uncommon') or main, 'rare': by('rare') or main,
            'mythic': by('mythic'),
            'land': [c for c in main if 'Basic Land' in (c.get('type_line') or '')],
            'extras': [c for c in cards if num(c) > limit] or by('rare') or main,
        }
        p['land'] = p['land'] or p['common']
        self.pools[code] = p
        log(f'  pool {code}: {len(main)} cards, {len(p["extras"])} variants')
        return p

    def rare(self, p):
        return self.rng.choice(p['mythic'] if p['mythic'] and self.rng.random() < 1 / 7 else p['rare'])

    def wild(self, p):
        r = self.rng.random()
        return self.rng.choice(p['common'] if r < .55 else p['uncommon'] if r < .85 else p['rare'] if r < .97 else (p['mythic'] or p['rare']))

    def extra(self, p):
        r = self.rng.random()
        want = 'common' if r < .35 else 'uncommon' if r < .7 else 'rare' if r < .96 else 'mythic'
        return self.rng.choice([c for c in p['extras'] if c['rarity'] == want] or p['extras'])

    @staticmethod
    def fin(c, want):
        if want in c['finishes']:
            return want
        return 'nonfoil' if 'nonfoil' in c['finishes'] else c['finishes'][0]

    def draft_pack(self, code, masters=False):
        """Classic 15-card booster: 10 C, 3 U, 1 R/M, 1 basic (a foil replaces a common now and then)."""
        p = self.pool(code)
        n_common = 10 if masters else 9
        pulls = [(c, 'nonfoil') for c in self.rng.sample(p['common'], min(n_common, len(p['common'])))]
        pulls += [(c, 'nonfoil') for c in self.rng.sample(p['uncommon'], min(3, len(p['uncommon'])))]
        pulls.append((self.rare(p), 'nonfoil'))
        if masters or self.rng.random() < 1 / 6:
            f = self.wild(p)
            pulls.append((f, 'foil'))
        else:
            pulls.append((self.rng.choice(p['common']), 'nonfoil'))
        if not masters:
            pulls.append((self.rng.choice(p['land']), 'nonfoil'))
        return [(c, self.fin(c, f)) for c, f in pulls]

    def play_pack(self, code):
        p = self.pool(code)
        pulls = [(c, 'nonfoil') for c in self.rng.sample(p['common'], min(6, len(p['common'])))]
        pulls += [(c, 'nonfoil') for c in self.rng.sample(p['uncommon'], min(3, len(p['uncommon'])))]
        pulls += [(self.rare(p), 'nonfoil'), (self.wild(p), 'nonfoil'), (self.wild(p), 'nonfoil'),
                  (self.rng.choice(p['land']), 'nonfoil')]
        f = self.wild(p)
        pulls.append((f, 'foil'))
        return [(c, self.fin(c, f)) for c, f in pulls]

    def collector_pack(self, code):
        p = self.pool(code)
        pulls = [(c, 'foil') for c in self.rng.sample(p['common'], min(4, len(p['common'])))]
        pulls += [(c, 'foil') for c in self.rng.sample(p['uncommon'], min(3, len(p['uncommon'])))]
        pulls += [(self.rare(p), 'foil'), (self.rare(p), 'nonfoil'), (self.rare(p), 'nonfoil')]
        for _ in range(4):
            e = self.extra(p)
            pulls.append((e, 'foil' if self.rng.random() < .25 else 'nonfoil'))
        pulls.append((self.extra(p), 'foil'))
        return [(c, self.fin(c, f)) for c, f in pulls]

    def product(self, code, names):
        for n in names:
            for p in self.sealed:
                if p['set_code'].upper() == code.upper() and p['name'] == n:
                    return p
        return None

    def open(self, kind, code, set_name, product_names, packs, cost_cents, make, sittings, condition=lambda d: 'NM'):
        """sittings: list of (datetime, packs opened that day)."""
        prod = self.product(code, product_names)
        ref = len(self.sources) + 1
        opened = sum(k for _, k in sittings)
        name = prod['name'] if prod else product_names[0]
        if kind == 'pack' and packs > 1:
            name = f'{name} ×{packs}'
        self.sources.append({
            'ref': ref, 'kind': kind, 'name': name, 'cost_cents': cost_cents, 'packs': packs, 'packs_opened': opened,
            'set_code': code.upper(), 'product_id': prod['product_id'] if prod else None,
            'finished': 1 if kind == 'box' and opened >= packs else 0, 'created_at': iso(sittings[0][0]),
        })
        for when, k in sittings:
            for _ in range(k):
                for c, f in make(code):
                    self.events.append((c, f, condition(when), when, ref))

    def precon(self, deck, when, cost_cents, product_id=None):
        data = (get(f"https://mtgjson.com/api/v5/decks/{deck['fileName']}.json") or {}).get('data', {})
        rows = [c for b in ('commander', 'mainBoard', 'sideBoard') for c in data.get(b, [])
                if (c.get('identifiers') or {}).get('scryfallId')]
        cards = cards_by_id(sorted({c['identifiers']['scryfallId'] for c in rows}))
        ref = len(self.sources) + 1
        self.sources.append({
            'ref': ref, 'kind': 'precon', 'name': deck['name'], 'cost_cents': cost_cents, 'packs': 1, 'packs_opened': 0,
            'set_code': deck.get('code'), 'product_id': product_id, 'finished': 0, 'created_at': iso(when),
        })
        for c in rows:
            card = cards.get(c['identifiers']['scryfallId'])
            if card:
                for _ in range(c.get('count', 1)):
                    self.events.append((card, self.fin(card, 'foil' if c.get('isFoil') else 'nonfoil'), 'NM', when, ref))

    def precon_product(self, deck):
        fold = lambda x: ' ' + re.sub(r'[^a-z0-9]+', ' ', x.lower()).strip() + ' '
        want = fold(deck['name'])
        hits = [p for p in self.sealed if want in fold(p['name']) and not re.search(r'collector|set of|case', p['name'].lower())]
        hits.sort(key=lambda p: (p['set_code'].upper() != (deck.get('code') or '').upper(), len(p['name'])))
        return hits[0] if hits else None

    def named(self, name):
        return get('https://api.scryfall.com/cards/named?' + urllib.parse.urlencode({'exact': name}))

    def single(self, card, when, finish='nonfoil', condition='NM'):
        self.events.append((card, self.fin(card, finish), condition, when, None))

    def build(self, owned_rows=(), snapshot_from=None, appreciation=None, sell_rate=0.0):
        ids = sorted({c['id'] for c, *_ in self.events})
        log(f'pricing {len(ids)} printings on Mana Pool…')
        singles = {}
        for i in range(0, len(ids), 100):
            qs = '&'.join('scryfall_ids=' + x for x in ids[i:i + 100])
            for s in (get('https://manapool.com/api/v1/products/singles?' + qs) or {}).get('data', []):
                for x in s.get('scryfall_ids') or [s.get('scryfall_id')]:
                    singles[x] = s

        def price(sid, fin, cond):
            s = singles.get(sid) or {}
            nm = {'nonfoil': 'price_cents_nm', 'foil': 'price_cents_nm_foil', 'etched': 'price_cents_nm_etched'}[fin]
            lp = {'nonfoil': 'price_cents_lp_plus', 'foil': 'price_cents_lp_plus_foil', 'etched': 'price_cents_lp_plus_etched'}[fin]
            mk = {'nonfoil': 'price_market', 'foil': 'price_market_foil', 'etched': 'price_market_foil'}[fin]
            p = s.get(nm) if cond == 'NM' else (s.get(lp) or s.get(nm))
            return p, s.get(mk), s.get('url')

        now = iso(datetime.combine(self.today, datetime.min.time(), timezone.utc) + timedelta(hours=20))
        cards = {}
        for c, fin, cond, when, ref in sorted(self.events, key=lambda e: e[3]):
            k = f"{c['id']}|{fin}|{cond}"
            row = cards.get(k)
            if row is None:
                img = (c.get('image_uris') or (c.get('card_faces') or [{}])[0].get('image_uris') or {}).get('normal')
                type_line = c.get('type_line') or ' // '.join(f.get('type_line', '') for f in c.get('card_faces', []))
                p, m, url = price(c['id'], fin, cond)
                row = cards[k] = {
                    'scryfall_id': c['id'], 'name': c['name'], 'set_code': c['set'], 'set_name': c['set_name'],
                    'collector_number': c['collector_number'], 'image_uri': img, 'finish': fin, 'condition': cond,
                    'quantity': 0, 'price_cents': p, 'market_cents': m, 'manapool_url': url, 'price_updated_at': now,
                    'sf_prices': None, 'created_at': iso(when), 'type_line': type_line,
                    'color_identity': ''.join(sorted(c.get('color_identity', []), key=ORDER.index)),
                    'rarity': c['rarity'], 'released_at': c.get('released_at'), 'layout': c.get('layout'),
                    'lang': 'en', 'price_id': None, 'from': [],
                }
            last = row['from'][-1] if row['from'] else None
            if last and last['source'] == ref and last['added_at'] == iso(when):
                last['quantity'] += 1
            else:
                row['from'].append({'source': ref, 'quantity': 1, 'price_cents': row['price_cents'], 'added_at': iso(when)})
            row['quantity'] += 1

        for o in owned_rows:  # cards from an app database copy, as already owned
            k = f"{o['scryfall_id']}|{o['finish']}|{o['condition']}"
            add = {'source': None, 'quantity': 1, 'price_cents': o['price_cents'], 'added_at': o['added']}
            if k in cards:
                cards[k]['quantity'] += 1
                cards[k]['from'].insert(0, add)
                cards[k]['created_at'] = min(cards[k]['created_at'], o['added'])
                continue
            row = {kk: o.get(kk) for kk in ['scryfall_id', 'name', 'set_code', 'set_name', 'collector_number', 'image_uri',
                                            'finish', 'condition', 'type_line', 'color_identity', 'rarity', 'released_at', 'layout',
                                            'price_cents', 'market_cents', 'manapool_url']}
            row.update({'quantity': 1, 'price_updated_at': now, 'sf_prices': None, 'created_at': o['added'], 'lang': 'en',
                        'price_id': None, 'from': [add]})
            cards[k] = row

        sales = []
        today_dt = datetime.combine(self.today, datetime.min.time(), timezone.utc)
        for k, c in list(cards.items()):
            if (c['price_cents'] or 0) < 500 or self.rng.random() >= sell_rate:
                continue
            first = datetime.fromisoformat(c['from'][0]['added_at'].replace('Z', '+00:00'))
            span = (today_dt - first).days
            if span < 3:
                continue
            sold_at = first + timedelta(days=self.rng.randint(min(14, span - 2), span - 1), hours=self.rng.randint(0, 6))
            n = self.rng.randint(1, c['quantity'])
            taken, left = [], n
            for a in c['from']:
                if left <= 0 or a['added_at'] > iso(sold_at):
                    break
                t = min(left, a['quantity'])
                taken.append({**a, 'quantity': t})
                a['quantity'] -= t
                left -= t
            n -= left
            if n <= 0:
                continue
            c['from'] = [a for a in c['from'] if a['quantity'] > 0]
            c['quantity'] -= n
            card = {kk: v for kk, v in c.items() if kk not in ('quantity', 'from')}
            sales.append({'sold_at': iso(sold_at), 'quantity': n, 'sold_cents': int(c['price_cents'] * n * self.rng.uniform(0.75, 1.1)),
                          'card': card, 'from': taken})
            if c['quantity'] == 0:
                del cards[k]

        per_day = {}
        for sale in sales:
            ry = int((sale['card'].get('released_at') or '2020')[:4])
            for a in sale['from']:
                for d, sign in ((a['added_at'][:10], 1), (sale['sold_at'][:10], -1)):
                    bucket = per_day.setdefault(d, {})
                    v, n = bucket.get(ry, (0, 0))
                    bucket[ry] = (v + sign * a['quantity'] * (sale['card']['price_cents'] or 0), n + sign * a['quantity'])
        for c in cards.values():
            ry = int((c.get('released_at') or '2020')[:4])
            for a in c['from']:
                d = a['added_at'][:10]
                bucket = per_day.setdefault(d, {})
                v, n = bucket.get(ry, (0, 0))
                bucket[ry] = (v + a['quantity'] * (c['price_cents'] or 0), n + a['quantity'])
        first = date.fromisoformat(snapshot_from or min(per_day))
        appreciation = appreciation or (lambda day, ry: 1.0)
        snapshots, cum, copies, noise, day = [], {}, 0, 1.0, first
        while day < self.today:
            for ry, (v, n) in per_day.get(day.isoformat(), {}).items():
                cum[ry] = cum.get(ry, 0) + v
                copies += n
            noise = min(1.06, max(0.94, noise + self.rng.uniform(-0.01, 0.0105)))
            if copies:
                value = sum(v * appreciation(day, ry) for ry, v in cum.items()) * noise
                snapshots.append({'day': day.isoformat(), 'value_cents': int(value), 'tcg_cents': None, 'copies': copies})
            day += timedelta(days=1)

        return {'format': 'mtg-price-checker-backup', 'version': 2, 'exportedAt': now, 'appVersion': None, 'prefs': None,
                'cards': list(cards.values()), 'sources': self.sources, 'snapshots': snapshots, 'sales': sales}


def at(rng, d, hour=19):
    return datetime(d.year, d.month, d.day, hour, rng.randint(0, 59), tzinfo=timezone.utc)


def recent(g, owned_db):
    """Six weeks: three loose packs, a finished play box, a collector box in progress, more loose packs."""
    t = g.today
    day = lambda n: at(g.rng, t - timedelta(days=n))
    price = lambda code, names: (g.product(code, names) or {}).get('low_price')
    g.open('pack', 'blb', 'Bloomburrow', ['Bloomburrow Play Booster Pack'], 3,
           (price('blb', ['Bloomburrow Play Booster Pack']) or 500) * 3, g.play_pack, [(day(37), 3)])
    g.open('box', 'dsk', 'Duskmourn', ['Duskmourn: House of Horror Play Booster Box'], 30,
           price('dsk', ['Duskmourn: House of Horror Play Booster Box']), g.play_pack, [(day(31), 12), (day(24), 10), (day(17), 8)])
    g.open('box', 'fdn', 'Foundations', ['Foundations Collector Booster Box'], 12,
           price('fdn', ['Foundations Collector Booster Box']), g.collector_pack, [(day(10), 3), (day(3), 2)])
    g.open('pack', 'eoe', 'Edge of Eternities', ['Edge of Eternities Collector Booster Pack'], 1,
           price('eoe', ['Edge of Eternities Collector Booster Pack']), g.collector_pack, [(day(5), 1)])
    g.open('pack', 'spm', "Marvel's Spider-Man", ["Marvel's Spider-Man Play Booster Pack"], 2,
           (price('spm', ["Marvel's Spider-Man Play Booster Pack"]) or 400) * 2, g.play_pack, [(day(2), 2)])
    owned = []
    if owned_db:
        con = sqlite3.connect(f'file:{owned_db}?mode=ro', uri=True)
        con.row_factory = sqlite3.Row
        rows = [dict(r) for r in con.execute('SELECT * FROM scans')]
        start = datetime.combine(t - timedelta(days=44), datetime.min.time(), timezone.utc) + timedelta(hours=18)
        for i, o in enumerate(rows):
            o['added'] = iso(start + timedelta(hours=int(i * 14 * 24 / max(1, len(rows)))))
        owned = rows
    return g.build(owned, sell_rate=0.1)


def meme(g):
    t = g.today
    day = lambda n: at(g.rng, t - timedelta(days=n))
    price = lambda code, names: (g.product(code, names) or {}).get('low_price')
    for code, set_name, name, dates in [
        ('ltr', 'The Lord of the Rings: Tales of Middle-earth', 'The Lord of the Rings: Tales of Middle-earth Collector Booster Pack', (20, 13, 6)),
        ('fdn', 'Foundations', 'Foundations Collector Booster Pack', (18, 11, 4)),
    ]:
        g.open('pack', code, set_name, [name], 100, (price(code, [name]) or 3000) * 100, g.collector_pack,
               [(day(dates[0]), 34), (day(dates[1]), 33), (day(dates[2]), 33)])
    g.open('box', 'dsk', 'Duskmourn', ['Duskmourn: House of Horror Play Booster Box'], 30,
           price('dsk', ['Duskmourn: House of Horror Play Booster Box']), g.play_pack, [(day(9), 7), (day(2), 5)])
    g.open('pack', 'spm', "Marvel's Spider-Man", ["Marvel's Spider-Man Play Booster Pack"], 2,
           (price('spm', ["Marvel's Spider-Man Play Booster Pack"]) or 400) * 2, g.play_pack, [(day(1), 2)])
    for code in ['blb', 'otj', 'mkm', 'woe', 'one', 'dmu', 'neo', 'mid']:
        p = g.pool(code)
        g.single(g.rare(p), day(g.rng.randint(25, 40)), 'foil' if g.rng.random() < .3 else 'nonfoil',
                 'LP' if g.rng.random() < .25 else 'NM')
        g.single(g.rng.choice(p['uncommon']), day(g.rng.randint(25, 40)))
    return g.build(sell_rate=0.2)


STAPLES = [
    'Sol Ring', 'Arcane Signet', 'Command Tower', 'Lightning Greaves', 'Swiftfoot Boots', 'Cultivate', "Kodama's Reach",
    'Rhystic Study', 'Smothering Tithe', 'Cyclonic Rift', 'Swords to Plowshares', 'Path to Exile', 'Counterspell',
    'Beast Within', 'Chaos Warp', 'Fellwar Stone', 'Mind Stone', 'Esper Sentinel', "Teferi's Protection",
    'Demonic Tutor', 'Vampiric Tutor', 'Mystic Remora', 'Birds of Paradise', 'Llanowar Elves', 'Heroic Intervention',
    'Deflecting Swat', 'Fierce Guardianship', "Jeska's Will", 'Three Visits', 'Farseek', "Nature's Lore",
    'Exotic Orchard', 'Reliquary Tower', "Rogue's Passage", 'Blasphemous Act', 'Toxic Deluge', 'Anguished Unmaking',
    "Assassin's Trophy", 'Eternal Witness', 'Skullclamp', 'Wishclaw Talisman', 'The Great Henge',
    'Doubling Season', 'Parallel Lives', 'Anointed Procession', 'Rampant Growth', 'Generous Gift', 'Feed the Swarm',
]


def newplayer(g):
    """Two years of a new player with a decent budget: precons first, packs most weeks, a box most sets,
    staples bought to upgrade decks, the odd collector box, a few good pulls sold."""
    rng, t = g.rng, g.today
    start = t - timedelta(days=730)
    lo = (start - timedelta(days=75)).isoformat()
    sets = sorted([s for s in (get('https://api.scryfall.com/sets') or {}).get('data', [])
                   if not s.get('digital') and s['set_type'] in ('expansion', 'core') and s.get('card_count', 0) >= 150
                   and lo <= s.get('released_at', '') <= t.isoformat()], key=lambda s: s['released_at'])
    decks = [d for d in (get('https://mtgjson.com/api/v5/DeckList.json') or {}).get('data', [])
             if d.get('type') == 'Commander Deck' and lo <= d.get('releaseDate', '') <= t.isoformat()
             and 'collector' not in d['name'].lower()]
    decks = [d for d in decks if ((g.precon_product(d) or {}).get('low_price') or 0) <= 8000]
    log('sets: ' + ', '.join(s['code'] for s in sets))
    clamp = lambda d: min(max(d, start), t - timedelta(days=1))
    day = lambda d, hour=19: at(rng, clamp(d), hour)
    price = lambda code, names, fallback: (g.product(code, names) or {}).get('low_price') or fallback

    def buy_precon(deck, d):
        prod = g.precon_product(deck)
        g.precon(deck, day(d), (prod or {}).get('low_price') or 4499, (prod or {}).get('product_id'))

    owned_staples = set()

    def staples(d, n):
        left = [x for x in STAPLES if x not in owned_staples]
        for name in rng.sample(left, min(n, len(left))):
            owned_staples.add(name)
            card = g.named(name)
            if card:
                g.single(card, day(d + timedelta(days=rng.randint(0, 20)), 21), 'nonfoil')

    def sittings(first, packs, n):
        parts, left = [], packs
        for i in range(n):
            k = left if i == n - 1 else max(1, round(packs / n + rng.randint(-2, 2)))
            k = min(k, left)
            if k > 0:
                parts.append((day(first + timedelta(days=6 * i + rng.randint(0, 3))), k))
            left -= k
        return parts

    def current_set(d):
        out = [s for s in sets if s['released_at'] <= d.isoformat()]
        return out[-1] if out else sets[0]

    first_decks = sorted([x for x in decks if x['releaseDate'] <= start.isoformat()], key=lambda x: x['releaseDate'])[-8:]
    for deck in rng.sample(first_decks, min(2, len(first_decks))):
        buy_precon(deck, start + timedelta(days=rng.randint(0, 6)))
    staples(start + timedelta(days=10), 8)

    seen, collector_boxes = set(), 0
    for m in range(25):
        d = start + timedelta(days=30 * m)
        s = current_set(d)
        code, name = s['code'], s['name']
        if code not in seen:
            seen.add(code)
            rel = date.fromisoformat(s['released_at'])
            if rng.random() < 0.6:
                first = clamp(rel) + timedelta(days=rng.randint(0, 10))
                recent = (t - first).days < 45
                g.open('box', code, name, [f'{name} Play Booster Box'], 30,
                       price(code, [f'{name} Play Booster Box'], 30 * 549 * 4 // 5), g.play_pack,
                       sittings(first, 12 if recent else 30, 2 if recent else rng.choice([2, 3, 4])))
            elif rng.random() < 0.5:
                g.open('box', code, name, [f'{name} Bundle'], 9, price(code, [f'{name} Bundle'], 4999), g.play_pack,
                       sittings(clamp(rel) + timedelta(days=rng.randint(0, 14)), 9, 1))
            set_decks = [x for x in decks if abs((date.fromisoformat(x['releaseDate']) - rel).days) <= 21]
            if set_decks and rng.random() < 0.55:
                buy_precon(rng.choice(set_decks), clamp(rel) + timedelta(days=rng.randint(3, 25)))
            if collector_boxes < 2 and rng.random() < 0.18:
                collector_boxes += 1
                g.open('box', code, name, [f'{name} Collector Booster Box'], 12,
                       price(code, [f'{name} Collector Booster Box'], 12 * 2500), g.collector_pack,
                       sittings(clamp(rel) + timedelta(days=rng.randint(0, 20)), 12, rng.choice([1, 2])))
        packs = rng.choice([2, 2, 3, 4, 6])
        g.open('pack', code, name, [f'{name} Play Booster Pack'], packs,
               packs * price(code, [f'{name} Play Booster Pack'], 549), g.play_pack,
               [(day(d + timedelta(days=rng.randint(0, 25))), packs)])
        if rng.random() < 0.25:
            g.open('pack', code, name, [f'{name} Collector Booster Pack'], 1,
                   price(code, [f'{name} Collector Booster Pack'], 2500), g.collector_pack,
                   [(day(d + timedelta(days=rng.randint(0, 25))), 1)])
        staples(d, rng.randint(1, 4))
        p = g.pool(code)
        for _ in range(rng.randint(1, 3)):
            g.single(g.rare(p), day(d + timedelta(days=rng.randint(0, 28)), 21), 'foil' if rng.random() < .1 else 'nonfoil')

    s = current_set(t)
    g.open('box', s['code'], s['name'], [f"{s['name']} Play Booster Box"], 30,
           price(s['code'], [f"{s['name']} Play Booster Box"], 30 * 549 * 4 // 5), g.play_pack,
           [(day(t - timedelta(days=9)), 6), (day(t - timedelta(days=2)), 5)])

    def appreciation(dd, release_year):
        return 0.9 + 0.1 * min(1.0, max(0.0, (dd - start).days / 730))

    return g.build(appreciation=appreciation, sell_rate=0.12)


def retail_pack(year, kind):
    if kind == 'collector':
        return 2000 if year < 2023 else 2500
    if kind == 'masters':
        return 699 if year < 2020 else 999
    if kind == 'play':
        return 549 if year < 2026 else 599
    return 329 if year < 2009 else 399 if year < 2020 else 449


def collector(g):
    """Twenty years of a heavy spender."""
    rng = g.rng
    start_year, t = g.today.year - 20, g.today
    sets = [s for s in (get('https://api.scryfall.com/sets') or {}).get('data', [])
            if not s.get('digital') and s.get('released_at') and s.get('card_count', 0) >= 150
            and s['set_type'] in ('expansion', 'core', 'masters', 'draft_innovation')
            and f'{start_year}-01-01' <= s['released_at'] <= t.isoformat()]
    by_year = {}
    for s in sets:
        by_year.setdefault(int(s['released_at'][:4]), []).append(s)

    def when(s, after_days=(0, 60)):
        d = max(date.fromisoformat(s['released_at']) + timedelta(days=rng.randint(*after_days)), date(start_year, 1, 1))
        return min(d, t - timedelta(days=1))

    def sittings(first, packs, n):
        parts, left = [], packs
        for i in range(n):
            k = left if i == n - 1 else max(1, round(packs / n + rng.randint(-2, 2)))
            k = min(k, left)
            if k > 0:
                parts.append((at(rng, min((first + timedelta(days=7 * i + rng.randint(0, 3))).date(), t - timedelta(days=1)), 20), k))
            left -= k
        return parts

    cond = lambda dt: 'LP' if dt.year < 2016 and rng.random() < 0.2 else 'NM'
    in_progress = 0
    for year in range(start_year, t.year + 1):
        main = [s for s in by_year.get(year, []) if s['set_type'] in ('expansion', 'core')]
        masters = [s for s in by_year.get(year, []) if s['set_type'] in ('masters', 'draft_innovation')]
        if not main:
            continue
        log(f'{year}: {", ".join(s["code"] for s in main)}')
        for s in rng.sample(main, min(len(main), rng.choice([1, 1, 2] if year < 2016 else [1, 2, 2]))):
            code, play = s['code'], s['released_at'] >= '2024-02-01'
            packs = 36 if not play or s['released_at'] < '2025-01-01' else 30
            kind_word = 'Play Booster Box' if play else 'Draft Booster Box' if s['released_at'] >= '2020-09-01' else 'Booster Box'
            cost = int(packs * retail_pack(year, 'play' if play else 'draft') * 0.75)
            first = at(rng, when(s))
            recent_box = (t - first.date()).days < 120 and in_progress < 1
            n_sit = rng.choice([1, 2, 3])
            sit = sittings(first, packs if not recent_box else packs // 3, n_sit)
            if recent_box:
                in_progress += 1
            g.open('box', code, s['name'], [f"{s['name']} {kind_word}", f"{s['name']} Booster Box"], packs, cost,
                   g.play_pack if play else g.draft_pack, sit, cond)
        newer = [x for x in main if x['released_at'] >= '2019-10-01']
        if newer and rng.random() < 0.6:
            s = rng.choice(newer)
            if True:
                first = at(rng, when(s, (0, 120)))
                g.open('box', s['code'], s['name'], [f"{s['name']} Collector Booster Box"], 12,
                       int(12 * retail_pack(year, 'collector') * 0.85), g.collector_pack, sittings(first, 12, rng.choice([1, 2])))
        if masters and rng.random() < 0.45:
            s = rng.choice(masters)
            first = at(rng, when(s))
            g.open('box', s['code'], s['name'], [f"{s['name']} Draft Booster Box", f"{s['name']} Booster Box"], 24,
                   int(24 * retail_pack(year, 'masters') * 0.85), lambda c: g.draft_pack(c, masters=True),
                   sittings(first, 24, rng.choice([1, 2])), cond)
        for _ in range(rng.randint(3, 6)):
            s = rng.choice(main)
            n = rng.choice([1, 1, 2, 3, 3, 6])
            play = s['released_at'] >= '2024-02-01'
            g.open('pack', s['code'], s['name'], [f"{s['name']} {'Play Booster Pack' if play else 'Booster Pack'}", f"{s['name']} Draft Booster Pack"],
                   n, n * retail_pack(year, 'play' if play else 'draft'), g.play_pack if play else g.draft_pack,
                   [(at(rng, when(s, (0, 300))), n)], cond)
        for _ in range(rng.randint(6, 14)):
            s = rng.choice(main)
            p = g.pool(s['code'])
            g.single(g.rare(p), at(rng, when(s, (5, 330)), 15), 'foil' if rng.random() < .15 else 'nonfoil', cond(at(rng, when(s))))

    def appreciation(day, release_year):
        age_then = max(0.0, (day.year + day.timetuple().tm_yday / 365) - release_year)
        age_now = max(0.5, (t.year + t.timetuple().tm_yday / 365) - release_year)
        return 0.55 + 0.45 * min(1.0, age_then / age_now) ** 0.8

    return g.build(appreciation=appreciation, sell_rate=0.08)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--scenario', choices=['recent', 'collector', 'meme', 'newplayer'], required=True)
    ap.add_argument('--out', required=True)
    ap.add_argument('--owned-db', help='recent: an app database copy whose cards become already owned')
    ap.add_argument('--seed', type=int, default=2026)
    ap.add_argument('--today', default=date.today().isoformat())
    ap.add_argument('--cache', help='directory to keep API responses in, for reruns')
    a = ap.parse_args()
    global CACHE
    if a.cache:
        os.makedirs(a.cache, exist_ok=True)
        CACHE = a.cache
    g = Gen(a.seed, date.fromisoformat(a.today))
    backup = {'recent': lambda: recent(g, a.owned_db), 'collector': lambda: collector(g), 'meme': lambda: meme(g),
              'newplayer': lambda: newplayer(g)}[a.scenario]()
    with open(a.out, 'w', encoding='utf8') as f:
        json.dump(backup, f, ensure_ascii=False)
    cards = backup['cards']
    total = sum((c['price_cents'] or 0) * c['quantity'] for c in cards)
    spent = sum(s['cost_cents'] or 0 for s in backup['sources'])
    log(f"{len(cards)} rows, {sum(c['quantity'] for c in cards)} copies, worth ${total / 100:,.2f}; "
        f"{len(backup['sources'])} packs / boxes, spent ${spent / 100:,.2f}; {len(backup['sales'])} sales; "
        f"{len(backup['snapshots'])} days → {a.out}")


if __name__ == '__main__':
    main()
