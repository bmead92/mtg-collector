# Decisions

Product and design decisions, with the reasons, so they don't get re-litigated. Newest first. Technical
details live in [DEVELOPMENT.md](DEVELOPMENT.md).

## Direction

- **A standalone collection catalog.** Selling a card = search for it and delete it. No selling, trading or
  sell-list tools. Packs and boxes are tracked only to compare what was paid with what was pulled.
  (Nov 18, 2026)
- **Free forever, optional donations.** Wizards' Fan Content Policy ("You can't require payments… to
  access your Fan Content"; donations, sponsorships and ads are allowed) and Scryfall's API terms ("You may
  not 'paywall' access to Scryfall data") rule out a paid download, a required "donation" before
  downloading, or a paid store listing. So: public repo, free APK on GitHub Releases, optional Ko-fi
  "Buy me a booster pack". No ads and no in-app purchases (owner's choice). Costs stay at $0 (no server; a
  free Play Store listing would be a one-time $25). The repo goes public only when the owner says so.
  (Nov 18, 2026)
- **No Wizards material in the app icon** (Fan Content Policy bans their logos): the icon is original
  hand-coded geometry (the owner rejects AI-generated art and using others' artwork; a better icon is a
  later to-do). **Mana symbols stay in the colour filters** (Scryfall's symbol SVGs): the owner's call,
  accepting the small risk; if Wizards ever objects, swap them for plain dots. The required "unofficial Fan
  Content" notice is in the README and in ⋯ → About. (Nov 18, 2026)
- **Name: MTG Collection** (was MTG Price Checker; repo renamed to `mtg-collection`, GitHub redirects the old
  URL). The Android package id `dev.mtgpricescanner.app` stays: changing it would install a separate app
  and lose the on-device collection. The backup format id `mtg-price-checker-backup` stays so old backups
  restore. (Nov 18, 2026)
- **Ask for as little typing as possible**, without making the app slow, bloated or costly. No paid
  services, no backend. (Nov 18, 2026)

## Scanning

- **Auto is the default mode; Single stays for pricing one card.** Stack mode was removed. (v0.5)
- **Skip the photo when two live frames agree on set + number;** otherwise take one and merge it with the
  frame reads. Ties go to the frame read. (v0.6)
- **Accepted limitations:** offset stacks (a card shifted so the lower card's collector line shows) can pick
  the wrong printing ("user error"; the card itself is right and marked "check printing"). Foil stars are
  often unreadable through glare, so Foil gets set in review. (v0.6)
- Realism test for scanning changes: a "sloppy pack rip" of ~10 cards. (v0.6)

## Prices

- **Mana Pool is the main price;** TCGplayer and Cardmarket come only from Scryfall's daily `prices` (no
  scraping). TCGplayer can be chosen as the main price. Card Kingdom is deferred. (v0.4)
- **Sealed prices come from Mana Pool's free `/prices/sealed`.** Scryfall has no sealed prices. What was
  paid is pre-filled from it but editable, since what was actually paid matters more than the market price. (v0.9)
- **Mana Pool's market price is the headline, lowest listing shown under it** (owner's call). Market is a
  near-mint figure, so played cards keep their lowest listing for that condition. `low_cents` column. (v0.17.7)

## Packs, boxes and growth

- **Two tabs, not a tab per box:** Collection (everything owned) and Opened (appears after the first opened
  pack / box). Loose packs are grouped; each box is one entry, opened over several sittings with
  "Continue". A box is tracked as a whole, not per pack inside it. (v0.8)
- **Additions log** (`additions` table): rows merge copies and keep only the first date, so a log of every
  addition is the source of truth for "where did this copy come from / when". Existing cards were migrated
  as already owned. (v0.8)
- **Product picking:** pick the set from a list (Scryfall's sets, newest first, the scanned cards' sets on
  top), then the product with its Mana Pool price. Replaced reading the wrapper with OCR (v0.9–0.13):
  stylised logos rarely read and a wrong guess is worse than one search. (v0.14, Nov 18, 2026)
- **Growth is one line chart, one point per day** (value or cards), touch to read a day. Bars and a
  "price moves" text were tried and dropped as harder to read. (v0.11)
- **Sell vs Delete** (v0.16, Nov 19, 2026): Sell is its own button (copies → sold-for → confirm only when the
  last copy leaves or the price is $0). Sold copies go to a `sales` table (card as sold + the additions
  taken, oldest first) and stay in history: Growth counts them until the sale day, packs count their
  proceeds in the gain, the Sold tab (greyed) shows sold-for vs value when added and time owned, with Undo.
  Delete, and lowering Copies, mean "never owned": the copies are subtracted from past daily snapshots at
  today's price (snapshots don't store per-card values, so this is an approximation).
- **Automatic backups** (v0.16.1, Nov 19, 2026, after an uninstall lost 280 cards; Google Auto Backup had only
  run once): the full backup JSON goes to `Downloads/MTG Collection/mtg-collection-backup-<day>.json` via a
  local Expo module (`modules/downloads-store`, MediaStore; no storage permission). One file per day,
  rewritten 5 s after any collection change and on the first launch of the day; the newest 7 kept. Never
  written while the collection is empty. A reinstalled app can't see or replace the old install's files
  (Android scoped storage), so it starts new ones ("… (1).json" for the same day); restore picks any of them.
- **Deck import** (v0.17, Nov 19, 2026): no site APIs for custom decks. Moxfield's API refuses outside apps
  (403, approval only), so both Moxfield and Archidekt are imported from their text export, pasted
  (`deckText.ts` reads quantities, "(SET) number", *F* / *E*, Archidekt [categories] / ^tags^, skips
  maybeboard / tokens). Cards resolve via Scryfall /cards/collection (set + number, else name; one retry by
  name). Precons come from MTGJSON (DeckList.json cached weekly, digital-only types dropped; deck files give
  exact printings + foils). A precon is a source of kind `precon` with what was paid (pre-filled from Mana
  Pool's sealed product of the same name); selling its cards counts toward its gain. "Only cards I don't
  have" compares exact printing + finish.
- **Paid** (Growth, v0.17): singles at their price when added (incl. sold ones), packs / boxes / precons at
  cost; vs worth now + sale proceeds.

## UI copy and style

- **Minimal copy:** no helper or explanation text under charts or sections when the title already says what
  it is. Explanations go in the docs, not the UI. (Nov 18, 2026)
- Prefer a bottom sheet over stacked alerts for choices. Plain-View or SVG charts, no heavy chart library.

## Process

- Work autonomously; check in only when needed. For multi-step requests: build each step, test it
  (simulation tests + on the phone), commit, push and release it before starting the next.
- No sealed product is on hand, so packs and boxes are tested with the simulator in `tests/sim/`
  (simulated sets, Play / Collector boosters, boxes, noisy OCR).
