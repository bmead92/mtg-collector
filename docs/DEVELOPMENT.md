# Development notes

Reference for working on MTG Collector (formerly MTG Price Checker). The [README](../README.md) is the
user-facing page (what the app does, download, install, FAQ).

## Current status & handoff

**Version 1.0.1** (Nov 21, 2026). 1.0.0 (Nov 20) was the first public release. Product decisions and the reasons behind them:
[DECISIONS.md](DECISIONS.md). Release history: GitHub Releases.

**Going public:** free APK on GitHub Releases + optional Ko-fi ("Buy me a pack", `DONATE_URL` in
`src/lib/appInfo.ts`). Public since 1.0.0 (Nov 20, 2026), starting from a fresh history; development
history before 1.0 is in private archive repos.

**What the app does:** hands-free Auto scanning (default) + Single; exact printing from the collector line;
Mana Pool + TCGplayer + Cardmarket prices (main price selectable); quantities; filters / search; export
(CSV / card list); backup / restore (v2: includes packs / boxes and value history); unsaved Stack kept
across restarts; **Opened** tab (packs / boxes: cost vs value); **Pack / box** picker (set list from
Scryfall → product with its Mana Pool price); **Growth** screen (one line chart per day). Photos are not stored.

**Recent versions:** 1.0.1 Scan asks singles or pack / box first, Select in the Stack saves part of it to a pack, History of added cards where they can be added to a pack, back-to-top button (and the list jumps to the top after a minute away), sharper auto scans that wait for the collector line plus a second read of the enlarged bottom strip, Opened / Sold refresh after a restore, card page without a picture no longer crashes · 1.0.0 renamed MTG Collector (repo bmead92/mtg-collector, backups in Downloads › MTG Collector, package id unchanged) · 0.17.7 market price is the headline, lowest listing under it · 0.17.5 foldables / wide screens (scanner frame fits by height too, more gallery columns, readable-width pages and sheets, capped card image; tested on the Pixel Fold emulator folded + unfolded and Fold7 sizes; phones unchanged), Commander precons listed first · 0.17.4 Scryfall 429 retry, network-error fixes, thousands separators in the header · 0.17.2 private release key (first build signed with it: 0.17.1), Buy me a pack row with a hand-drawn pack icon, backup file fix after reinstall · 0.17 Import deck (MTGJSON precons with price, pasted Moxfield / Archidekt / plain lists), Paid total on Growth · 0.16.2 first-run scan tip, camera-denied screen · 0.16.1 automatic backups to Downloads › MTG Collector (survive uninstall), thousands separators · 0.16 Sell (Sold tab, undo, pack gains include sales; Delete erases history), swipe between cards · 0.15.2 restore progress bar, ~10× faster restore · 0.15.1 years on long Growth charts · 0.15 search printings (set, code, number, year, treatment), set symbols, prices in the printing list fixed · 0.14 pick the set from a list instead of reading the wrapper · 0.13 foreign cards, update banner, report a problem · 0.12 public-release prep (icon, colour dots, notice, About, User-Agent) · 0.7 Stack persistence + rename to MTG Collection (package id unchanged) · 0.8 Opened tab
(`sources` + `additions`) · 0.9 product picker · 0.10 Growth + daily `value_snapshots` · 0.11 Growth as one
line chart (react-native-svg).

**Not yet verified on the device with real data** (all covered by simulation tests):
- Save sheet → Opened tab → pack / box page → Forget, with real scanned cards. Quick check: scan 2–3
  singles, save as "Opened packs" with a price, look at Opened and the pack page, then Forget it.
- Unsaved Stack restore after the phone kills the app mid-session (works in tests and on install).

**Open issue:** on some cards the collector number isn't read (seen on Cloud, Ex-SOLDIER FIC and a
laminated Phyrexian Germ token whose set read as "TOK"), so the printing falls back to name-in-set or the
newest printing. Next step when it recurs: log the raw bottom-of-card OCR lines in `src/lib/diag.ts`, then
fix the parser in `src/lib/ocr.ts`.

**Release routine (per feature):** `npm test`, `npx tsc --noEmit`, `npx expo lint` (0 warnings) → bump
`version` in `app.json` and `versionCode` / `versionName` in `android/app/build.gradle` (no prebuild needed)
→ release build (below) → `scripts/install-apk.sh` (answers Play Protect's "Don't send" prompt) → check on
the phone → commit, push, `gh release create vX.Y.Z <apk>`. Update this section and the README.

**Phone etiquette (for agents):** before tapping or launching on the phone, check the foreground app
(`adb shell dumpsys activity activities | grep topResumedActivity`). If it isn't MTG Collector or the
launcher, the owner is using the phone: stop, and keep no screenshots of their screen. Find tap targets with
`uiautomator dump` bounds; never tap blind. The unsaved Stack survives installs, so installing is safe.

**Release build:** `cd android; .\gradlew.bat app:assembleRelease -PreactNativeArchitectures=arm64-v8a
--no-daemon -q` with `JAVA_HOME=%LOCALAPPDATA%\Programs\Temurin\jdk-17.0.21+9` and
`ANDROID_HOME=%LOCALAPPDATA%\Android\Sdk`. New native modules (e.g. react-native-svg) are picked up by
autolinking without `expo prebuild`.

**Working on the device:** the release build isn't debuggable. To inspect the database or iterate on JS,
install the debug build (`android/app/build/outputs/apk/debug/app-debug.apk`; same signing key, so it
updates in place and keeps data), run Metro, `adb reverse tcp:8081 tcp:8081`, then read the DB with
`adb exec-out run-as dev.mtgpricescanner.app cat files/SQLite/scans.db`. Back the DB up this way before
any migration. Reinstall the release APK afterwards.

**Build gotchas (Windows):**
- `expo prebuild` deletes `android/local.properties`; re-add `sdk.dir` + `cmake.dir` (see below) every time.
- "Unable to delete directory … .so" = a stale Gradle/Kotlin daemon or a running Metro (its watcher covers
  `node_modules`) holding files. Stop Metro before release builds, kill `java` processes,
  delete the library's `node_modules/<lib>/android/build`, build with `--no-daemon`.
- Metro's file watcher can go stale (serves old code). Check with
  `curl "http://localhost:8081/src/app/index.bundle?platform=android&dev=true&modulesOnly=true&runModule=false"`
  and restart Metro with `--clear` if a recent change is missing.
- **Keep R8 off** (`enableMinifyInReleaseBuilds: false`): R8 broke the Nitro OCR module (every scan failed
  in v0.2.0–0.2.1).
- Release-build scans log `[scan:single|stack] read/match/failed` and `[auto] frame/capture/stats/used`
  lines: `adb logcat -s ReactNativeJS`. Git Bash: use the SDK's adb path and `MSYS_NO_PATHCONV=1`.

**Known Auto gaps:** offset stacks (front card shifted up so the lower card's collector line shows) can pair the
front card's name with the lower card's set + number; identify then trusts the name, so the card is right but
the printing is "check printing". Foil is only detected from the ★ on the collector line, which glare on foils often
hides (then the user sets Foil in review). Cards matched by name only get "check printing".

**Next up:** the device checks above; then candidates from the roadmap (per-card price trend, Card Kingdom
buylist, iOS). Not wanted: selling / trading tools (see DECISIONS.md).

## Road to 1.0

Order: finish features → beta on other phones → security / release hardening → public 1.0.

**Features and fixes before the freeze**
- ~~In-app update check~~ (0.13.0, `src/lib/updates.ts`): at most daily, GitHub's latest release vs this
  build → "Version X available · Download" banner (dismissable per version). Returns nothing while the
  repo is private (404).
- ~~Verify the Opened flow on screen~~ (0.13.0, emulator): sample cards → Stack → save as opened pack with a
  product chip → Opened tab → pack page → Forget; foreign card shown "· JP" with its English price; v1
  backup restore; Growth; Report a problem; scan screen opens with the trimmed permissions. 0.14: set
  picker (scan screen + save sheet "Other set…"), search, Android back steps out of a set. 0.15.2 on the
  phone (S21, real collection, update over 0.13.0 kept data): printing picker prices + set symbol, set
  picker search + products with prices.
  (Simulated: Stack restore after a kill, a kill mid-save, 10k-card collections — `tests/stack.test.ts`, `sealed.test.ts`, `scale.test.ts`,
  `refresh.test.ts`.) The emulator needs the Windows hypervisor driver installed (admin) first.
- Large collections (simulated, Node, 10k cards): first open incl. migrating the log ~30 ms, list ~25 ms,
  filter/sort ≤20 ms, two-year daily line ~10 ms, quantity edit ~60 ms. Refresh all prices = 100 Mana Pool
  + 134 Scryfall requests (≈13 s of Scryfall throttle on a phone); writes are batched in one transaction
  (`updatePricesBulk`). Still to check on a phone: gallery scrolling with 10k tiles.
- ~~Report a problem~~ (0.13.0): ⋯ → prefilled GitHub issue (app version, phone model, Android version,
  last 12 scan log lines from `diag.ts`; card text only). Template in `.github/ISSUE_TEMPLATE/`.
- ~~First run~~ (0.16.2): one scan tip on the first scan (setting `tip.scan`); camera denied → "Allow camera" /
  "Open settings" + Back (Vision Camera re-checks the permission when the app returns).
- ~~Safety net~~ (0.16.1): Android Auto Backup proved unreliable (ran once in days), so the app writes its
  own daily backup to Downloads › MTG Collector (survives uninstall; restore tested on the emulator). Before 1.0 the folder was "MTG Collection"; its files are pruned together with the new ones.
- ~~Non-English cards~~ (v0.13.0): the collector line's language code (SP FR DE IT PT JP KR RU CS CT PH)
  picks Scryfall's printing in that language (`/cards/{set}/{n}/{lang}`); prices come from the English
  printing (`scans.price_id`), since foreign printings have no prices on Scryfall or Mana Pool. Auto mode
  tracks cards whose names it can't read (other scripts) by their collector line. Shown as "· JP" etc.

**Beta (0.13 → 0.9x)**
- A few friends on different phones / Android versions via GitHub pre-releases. The camera crop assumes
  preview and photo share an aspect ratio; only one phone has been tested.

**Security and release hardening (right before 1.0)**
- Release signing: builds are signed with the stock Android debug keystore (public, password "android"),
  so anyone could sign an "update" that installs over users' apps. Create a private release keystore,
  keep it out of the repo, back it up (password manager + offline copy); losing it means no more
  updates. Switching keys forces one uninstall: back up, install, restore. Do it before strangers install.
  Wired: `plugins/withReleaseSigning.js` signs with the keystore named in `~/.gradle/gradle.properties`
  (`MTG_RELEASE_STORE_FILE`, `_STORE_PASSWORD`, `_KEY_ALIAS`, `_KEY_PASSWORD`); without them, the debug key.
  **Done 2026-11-19 (0.17.1):** `~/.mtg-collection/release.jks` (alias `mtgcollection`, RSA 4096, valid to
  2076, CN "MTG Collection"); owner keeps an off-PC copy. Builds without the properties fall back to the
  debug key and won't install over release builds.
- Hashes are not published in release notes (owner's call: looks sketchy). `scripts/apk-hashes.sh` prints
  them locally if needed.
- ~~Permissions~~ (0.13.0): SYSTEM_ALERT_WINDOW and legacy storage blocked via `android.blockedPermissions`;
  the app asks only for the camera (INTERNET / VIBRATE need no prompt). Dark launch screen via the
  expo-splash-screen plugin.
- GitHub: 2FA on, branch protection on `main` (needs Pro while private: do it when public), Dependabot
  security alerts (on, 0.16.2; no version-update PRs: Expo packages must move together via
  `npx expo install`), secret scanning (free once public). `npm audit`: 3 moderate, all in Expo's build
  tooling (minimatch via @expo/fingerprint), not in the app; the suggested fix downgrades Expo.
- ~~Privacy note in the README~~ (0.16.2).

**Launch**
- ~~Flip the repo public, 1.0.0 release, Ko-fi link live~~ (1.0.0).
- Google developer verification ($25 once, ID) before it is enforced worldwide (reported for January 2027);
  without it, sideloading and updates need Android's "advanced flow" (24 h wait).
- Later, optional: free Play Store listing ($25 once; closed test with ~12 testers for 14 days), iOS.

## Stack

Expo SDK 58 / React Native 0.88 (New Architecture), TypeScript, Expo Router. Camera: VisionCamera v5.
OCR: Google ML Kit via `react-native-vision-camera-ocr-plus` (on-device). Storage: `expo-sqlite`.
Card data: [Scryfall API](https://scryfall.com/docs/api). Prices:
[Mana Pool public API](https://manapool.com/api/docs) (no key needed).

## How a scan works

1. **Capture** (`src/lib/capture.ts`): VisionCamera takes a photo. Stack mode writes it to a temp file
   immediately so the camera buffer is freed for the next shot.
2. **Upright + crop**: the rotation is baked into the pixels (the OCR library ignores EXIF on Android),
   then the photo is cropped to the on-screen card guide so neighbouring cards and play mats are ignored.
3. **OCR** (`src/lib/ocr.ts`): the parser extracts the name (top line), set code, collector number and
   foil star (bottom-left collector line).
4. **Identify** (`src/lib/identify.ts`): Scryfall lookup by set + number, cross-checked against the name.
   Fallbacks: a trailing letter on the set code is treated as a misread foil star; a misread number picks
   the closest-numbered printing of that name in the set; otherwise fuzzy name search.
   Tokens print the main set's code (`ONC • EN`) but Scryfall files them under the token set (`TONC`)
   with the same number, often with a bare number and no rarity letter (`023`). The parser accepts the
   bare number, and identification retries `T<set>` when the text has a "Token Creature/Artifact…" type
   line or the main-set card's name doesn't match.
5. **Price** (`src/lib/manapool.ts`): `GET https://manapool.com/api/v1/products/singles?scryfall_ids=…`
   (repeat the param for several ids, max 100). The headline price is the lowest current listing for the
   chosen finish + condition (default NM non-foil), falling back to Mana Pool's market price.
   TCGplayer and Cardmarket prices come free with the Scryfall card object (`prices`: usd / usd_foil /
   usd_etched / eur / eur_foil / eur_etched; near-mint market prices, updated daily). They're stored as
   JSON in `sf_prices` and resolved per finish in `src/lib/prices.ts` (etched falls back to foil; foil never
   falls back to non-foil). The gallery's **main price** (Customize → Main price, Mana Pool or TCGplayer;
   USD only so totals and filters stay in one currency) drives tiles, total, price filters, sorting and
   the Stack total. The card page lists every source enabled in Customize. "Refresh prices" re-fetches
   Mana Pool and Scryfall in parallel; startup backfills `sf_prices` for older rows.
6. **Save**: a row in SQLite (`src/lib/db.ts`). There is one row per exact printing + finish +
   condition with a `quantity`; saving the same card again (or editing a card into one that already
   exists) raises the quantity instead of adding a row. Collection value = Σ price × quantity. The photo is only used to check the match and is deleted
   once the card is saved; cards display the Scryfall image. (Versions before 0.2 kept photos; they are
   purged on launch by `src/lib/maintenance.ts`.)

## Auto (hands-free) scanning

`src/lib/useAutoScan.ts` + `src/lib/autoScan.ts` (pure, unit-tested). A VisionCamera frame output
(FHD 16:9, `pixelFormat: 'rgb'` on Android, which the OCR library's native side expects) runs a worklet on the
camera thread that calls the OCR library's `scanFrame`. That call never blocks: it queues ML Kit on a native
thread and returns the last completed result. A separate recognizer is configured with `scanRegion` = the
guide (mapped through the preview's cover crop with the real frame size, reported by the first frame). The
worklet posts a result to JS only when its text hash changes (`createSynchronizable` holds the hash).

JS parses each read with the normal `parseCardText` and keys it by normalised name (`cardKey` also needs a
collector line or 4+ lines, so playmats don't count). **Capture rule:** two reads of the same key whose name
line hasn't moved more than half a line height, spanning ≥ 400 ms (or one unchanged read held 600 ms; identical
text is only posted once), min 0.8 s between captures. Until some read of the card has its collector line
(`SET#NUMBER`) it waits 1.5 s (`NO_NUMBER_MS`). The photo is taken at `balanced` quality, kept at 2600 px, and
when the set or number is still missing a second OCR pass reads the bottom 14% enlarged 2× (`withCollectorStrip`
in `capture.ts`, `parseCollectorStrip` in `ocr.ts`). Movement resets the clock, so cards sliding over a pile
never count as steady. **Lock:** the captured card (by name *and* by `SET#NUMBER`, since in a pile the previous
card's collector line peeks out under the next one) is ignored until it has been out of view for 800 ms
(second copy = take it out and put it back).

**What gets added:** all reads of the card are merged (`mergeReads`: majority name; set + number from the
frames that read them, majority vote). If ≥ 2 reads agree on set + number (`isCompleteRead`) the card is added
straight from that read with **no photo** (`stack.enqueueRead`). Otherwise a normal Stack photo is taken and
the merged read rides along as a hint; `identifyAndPrice` tries the more complete read first (ties go to the
frame read; photos of a card being handled can misread) and falls back to the other.

**Review flags:** "Check card" when the matched card's name resembles neither read (its flavor/alt name and
the real name printed anywhere in the read count as matches); "Repeat?" when the same printing + finish was
added in the last 30 s (resurfaced card or a real second copy; the user decides).

`parseCardText` straightens text first: line corner points give the reading direction (`textTurns`), so
upright, sideways and upside-down images parse the same.

Measured on a Galaxy S21: ~130 ms per OCR pass, 4–5 completed reads/s, ~3.5 s per card including the swap.
Sloppy pack-rip test (v0.6.0): 11 captures for 11 cards, no repeats or strays.

Parser fix found by Auto testing: the set line needs a separator or space before `EN` (rules-text "BETWEEN"
used to read as set "BETWE").

## Opened packs / boxes (sources + additions log)

- `sources`: one row per opened pack purchase (`kind: 'pack'`, `packs` = how many loose packs) or box /
  bundle (`kind: 'box'`, `packs` in it, `packs_opened` so far, `finished`). `cost_cents` = what was paid
  (null = not entered, then no gain is shown). `set_code` / `product_id` are for the product picker.
- `additions`: every time copies enter the collection: `scan_id`, `source_id` (null = already owned),
  `quantity`, `price_cents` at the time, `added_at`. Needed because `scans` merges copies into one row and
  only keeps the first date. **Invariant:** a card's additions sum to its quantity. `repairAdditions()`
  enforces it (on open, after quantity edits and restores): missing copies → already owned; surplus →
  taken off the newest additions; orphans dropped. Row merges re-point additions; deletes remove them.
- First launch on v0.8.0 logs every existing card as already owned on its `created_at`.
- `saveStack(target, only?)`: `owned` | `new` (creates the source) | `existing` (adds packs opened to a box);
  `only` = ids picked with Select on the Stack screen (the rest stay in the Stack).
  UI: `SaveSheet` (Stack screen) → `OpenedView` tab in the gallery → `source/[id]` page.
- Scan button → "What are you scanning?" (singles / pack or box / keep opening). Pack or box opens the
  product picker (`/scan?pick=1`) before the camera.
- **History** (`/history`, Tools and the Opened tab): every addition with where it came from (`listHistory`),
  grouped into scan sessions (`sessionsOf`, a 30 min gap starts a new one), filter "Not in a pack". Selected
  rows → `SaveSheet` → `assignAdditions` points them at a new / continued source, or back to none ("Already
  owned"). Whole additions move (no splitting copies); a pack left empty stays until Forget. Summaries are pure
  (`sources.ts`) and use the main price source.
- Backup v2 adds `sources` (with a `ref`) and per-card `from` (additions); v1 files still restore (all
  already owned). Merge restores reuse a source with the same name + created_at.
- `applyRestore(plan, onProgress)` reports ~100 steps (sources + cards + raises + snapshots) for the
  `ProgressOverlay` bar, and inserts through prepared statements: the 22k-card demo restores in ~20 s on
  the emulator (minutes with per-row `runAsync`).

## Product picker (sealed)

- Catalog: `GET https://manapool.com/api/v1/prices/sealed` (free, no key, ~2,300 in-stock products, prices
  in cents). `sealedCatalog.ts` fetches it at most daily, only when a pack / box is involved, and caches a
  slim copy in `settings` (`sealed.catalog`); offline it uses the stale copy.
- Sets: `GET https://api.scryfall.com/sets` (`setCatalog.ts`, cached weekly in `settings` as
  `scryfall.sets`). Mana Pool's sealed `set_code`s match Scryfall's (174 of 175 in Nov 2026; MB1 is named
  from its product).
- `sealed.ts` (pure): `productType(name)` (play/collector/set/draft/jumpstart pack or box, bundle; cases,
  samples, prerelease, decks → other), `packsIn`, `cardsPerPack`, `productsForSet` (everyday booster first),
  `suggestProducts(catalog, {setCodes, want})` (products of the scanned cards' sets).
- `setList.ts` (pure): `buildSetList` = sets Mana Pool sells packs / boxes for, plus booster-type Scryfall
  sets (expansion, core, masters, draft_innovation, funny) up to 45 days ahead; newest first. A set without
  Mana Pool products gets `usualProducts` (no price, `product_id` saved as null). `searchSets` (code, or
  word starts of the name), `withCardSetsFirst`.
- `ProductBrowser` (set list → products) is used by the scan screen's **Pack / box** (full-screen modal
  → `setOpening()`, persisted in `settings`) and the save sheet's **Other set…** chip. Save sheet offers
  "Opened: <product>" first (`sourceFromProduct`: packs estimated from card count). The opening is cleared
  after a save.
- Wrapper OCR was removed in 0.14: a list is quicker and never wrong, and stylised set logos rarely read.

## Demo data

`scripts/make-demo-backup.py` writes a backup to restore on the emulator, for screenshots and UI checks:
- `newplayer` (**the emulator's default and the README screenshots**): two years of a new Commander player
  with a decent budget: precons (MTGJSON, priced from Mana Pool sealed), packs most months, a play box or
  bundle most sets, two collector boxes, staples bought to upgrade decks, a box still being opened, some
  sales. ~5.6k cards, ~$3.2k sealed + ~$0.9k singles spent.
- `recent` (six weeks; `--owned-db` adds an app database copy as already owned), `collector` (twenty
  years, ~22k cards), `meme` (100 LTR + 100 FDN collector packs).

Real cards from Scryfall, current Mana Pool prices, simulated booster contents (cards Scryfall marks as not
in boosters, e.g. serialized / headliner printings, are left out). `--cache DIR` keeps API responses for
reruns. `adb push` the file to `/sdcard/Download/`, then ⋯ → Restore from backup → Replace.

## Change printing

- `PrintingPicker` lists every paper printing (`allPrintings`, Scryfall `prints_search_uri`) with its Mana
  Pool NM price, set symbol (`getSets`) and treatments (`printings.ts` `printingTags`: borderless, showcase,
  extended art, full art, retro frame, special foils, flavor name). Search (shown when > 6 printings) is
  local: `searchPrintings`, every typed word must match a set-name word start, the set code, the number,
  the year, a finish or a treatment. Tested on Sol Ring's 140 printings (`tests/fixtures/sol-ring-printings.json`).
- 0.15 fixed prices never showing in this list (the load effect cancelled itself; FlatList needed `extraData`).

## Growth

- `growth.ts` (pure): `growthSeries` (periods by day < 3 weeks, week < 6 months, else month; running totals
  at today's prices; `fromOpened` per period), `addedSince` (this week from Monday / this month),
  `breakdown` (owned vs opened), `priceMove` (today's value − oldest earlier snapshot − value added since).
- `value_snapshots` (day, value_cents = Mana Pool, tcg_cents, copies): upserted by the gallery's `load()`
  (latest load of the day wins). Included in backups (`snapshots`).
- Additions / sources / new scans are stamped with the JS clock (not SQLite's default), so dates are
  consistent and testable with fake timers.
- Screen: `src/app/growth.tsx`, opened from "Growth ›" by the collection total. One line chart
  (`components/LineChart.tsx`, react-native-svg; touch / drag selects a day) of `dailyLine()`: per day, the
  snapshot value where recorded, else the cards held by then at today's prices. Value / Cards toggle.
  (Earlier: bar charts and a price-moves text; the user preferred one simple line chart. `priceMove` is kept
  in growth.ts, unused by the UI.)

## Unsaved Stack persistence

`stack.ts` mirrors the in-memory Stack to the `stack_items` table (id + JSON of the item), 300 ms after
changes; items are replaced on every change, so identity comparison finds what to write. `restoreStack()`
runs at launch (`_layout.tsx`): items still identifying / pricing resume from their saved read; items whose
photo hadn't been read yet become "failed: scan it again" (the temp photo isn't kept). `saveStack` deletes
each item's row right after its card is written, so a crash can't save a card twice.

## Export

`src/lib/export.ts`: **Tools → Export** shares the cards currently shown (filters apply) through the Android
share sheet (`expo-sharing`), as either
- **CSV** (RFC 4180, CRLF): quantity, name, set, number, finish, condition, rarity, price, market, total
  (Mana Pool), TCGplayer (USD), Cardmarket (EUR), Scryfall ID, Mana Pool URL, or
- **Card list**: `2 Sol Ring (CMR) 472 *F*` per line (`*F*` foil, `*E*` etched), the format Mana Pool's
  mass entry, Moxfield and Archidekt import.

Files are named `mtg-collector-YYYY-MM-DD.(csv|txt)` (local date) and written to the app cache.

## Backup / restore

`src/lib/backup.ts` (pure: build, validate, plan) + `src/lib/backupFile.ts` (share / pick) +
`db.applyRestore` (one transaction). Backup = JSON `{format: "mtg-price-checker-backup", version: 1,
exportedAt, appVersion, prefs, cards[]}` with every card field except row id and photo. Restore validates
the file (wrong/newer/damaged files are rejected with a message; bad entries are skipped and counted),
then either **merges** (add missing cards; for cards in both keep the higher quantity, so re-restoring is
idempotent) or **replaces** (collection becomes exactly the backup, after a confirm). Original "added"
dates are preserved.

## Project layout

```
src/app/            screens (Expo Router): gallery, scan, confirm, stack review, card detail
src/components/     shared UI: bottom sheets, printing picker, filter settings, segmented control
src/lib/            capture, OCR parsing, identification, pricing, storage, filters, preferences
plugins/            Expo config plugin for Windows build-path limits
assets/             app icons (generated from Scryfall's planeswalker symbol, see below)
```

## Setup (Windows + Android device)

Requires Node 20+, JDK 17, the Android SDK (platform 37, build-tools 37, NDK 27.1, CMake 3.31.6) and a
phone with USB debugging enabled.

1. Point `ANDROID_HOME` at the SDK and `JAVA_HOME` at JDK 17; add `platform-tools` to `PATH`.
2. `npm install`
3. `npm run android`: generates `android/`, builds and installs the dev build.
4. Afterwards, for JS-only changes: `npm run start:dev`, then `adb reverse tcp:8081 tcp:8081` and open
   the app on the phone.

Native config lives in `app.json` (Continuous Native Generation); don't hand-edit `android/`.

### Building a release APK

```sh
npx expo prebuild --platform android    # only if android/ doesn't exist or app.json changed
cd android
./gradlew app:assembleRelease -PreactNativeArchitectures=arm64-v8a   # Windows: .\gradlew.bat …
```

Output: `android/app/build/outputs/apk/release/app-release.apk`. Install with
`adb install -r app-release.apk` (keeps data). Bump `version` and `android.versionCode` in `app.json`
for each release, then attach the APK to a GitHub release (`gh release create vX.Y.Z <apk>`).

Release builds are signed with the private release key (see Road to 1.0 › Release signing). Builds on a
machine without it fall back to the debug key and won't install over release builds.

### Windows long-path notes

Native C++ builds (Nitro modules, gesture-handler codegen) produce paths well over 260 characters.

- Enable Windows long paths once (admin PowerShell):
  `Set-ItemProperty HKLM:\SYSTEM\CurrentControlSet\Control\FileSystem -Name LongPathsEnabled -Value 1 -Type DWord`
- Use CMake ≥ 3.31 from the SDK (ships Ninja 1.12, which is long-path aware), referenced from
  `android/local.properties`. That file is machine-local and **prebuild deletes it**, so re-add it after
  every `expo prebuild`:
  ```
  sdk.dir=C:/Users/<you>/AppData/Local/Android/Sdk
  cmake.dir=C:/Users/<you>/AppData/Local/Android/Sdk/cmake/3.31.6
  ```
- `plugins/withWindowsShortCxxPaths.js` moves CMake build folders to `%USERPROFILE%\.cxx`.
- `minSdkVersion` is 26 (required by the OCR module), set via `expo-build-properties`.

## Scripts

| Command | What it does |
|---|---|
| `npm run android` | Native build + install on the connected device |
| `npm run start:dev` | Metro dev server for the dev client |
| `npm run typecheck` | TypeScript check |
| `npx expo lint` | ESLint |
| `npm test` | Vitest: logic tests + simulated packs / boxes (see Tests) |

## Emulator (Android Studio)

AVD `Medium_Phone_API_37.0` (x86_64, 1080×2400). Needs the Windows hypervisor driver (`emulator -accel-check`
should say WHPX is usable). Start: `emulator -avd Medium_Phone_API_37.0 -no-snapshot-save -no-audio`.
Build APKs with `-PreactNativeArchitectures=arm64-v8a,x86_64` to run on both the phone and the emulator.
With a phone also attached, address the emulator explicitly: `adb -s emulator-5554 …`.

- Test data: convert a dev DB backup to a JSON backup and restore it through ⋯ → Restore (file in
  `/sdcard/Download`).
- Debug builds only: ⋯ → **Dev: sample cards** adds real cards (incl. a Japanese one) to the Stack without a
  camera, to exercise review / save / Opened. Run Metro (`npx expo start --dev-client`), `adb reverse
  tcp:8081 tcp:8081`, connect to `localhost:8081` in the dev launcher; turn off the dev menu's "Tools button"
  (its floating gear covers the ⋯ button). Stop Metro before release builds (file locks).
- The emulated camera is a virtual room; `adb emu virtualscene-image wall <file>` sets a poster, but aiming
  the camera at it needs the emulator's gRPC pose API, so scanning is still tested on the phone.

## Tests

`npm test` runs Vitest on `tests/**/*.test.ts` under Node (no phone needed).

- Native modules are aliased to stubs in `vitest.config.ts` (`tests/stubs/`). `expo-sqlite` runs on Node's
  built-in SQLite, so `db.ts` and its SQL are tested for real. Databases live on `globalThis` and survive
  `vi.resetModules()`: `launchApp()` in `tests/sim/harness.ts` re-imports the app's modules, which is an
  app restart with data kept. `resetDatabases()` is a fresh install.
- **Simulated product** (`tests/sim/`): `catalog.ts` builds made-up sets (commons to mythics, basics,
  collector-only booster-fun versions, Scryfall-style prices); `packs.ts` opens Play / Collector boosters
  and boxes; `reads.ts` turns a pulled card into noisy live-frame OCR reads (name typos, missed collector
  line, foil star hidden by glare); `services.ts` + `mocks.ts` replace Scryfall identify and Mana Pool prices.
  All seeded, so runs are repeatable.
- Harness: `scanPulls` (Auto-style: merge reads, add to the Stack), `settle`, `review` (fix wrong cards /
  finishes like the user would), then `saveStack` and check the database.

## App icon

Original artwork, hand-written SVG (no generated or third-party art): a fanned stack of three card shapes,
the front one with an art window and two text lines cut out, orange gradient (#ff9a3c → #e5501b) on the
app background (#0d0d12). `node scripts/make-icons.cjs` renders `assets/icon.png`, `android-icon-*.png`,
`favicon.png` and `splash-icon.png` (uses `@resvg/resvg-js`). The adaptive foreground stays within the
safe zone. After changing icons, run `npx expo prebuild --platform android` (then restore
`android/local.properties`) so the launcher mipmaps are regenerated. Wizards' logos and symbols (mana,
planeswalker) must not be used: the Fan Content Policy requires permission.

## Known limitations

- Android only so far (iOS needs a Mac or cloud build, and hasn't been tested).
- Cards printed before 2014 have no set code on the collector line, so they match by name and the user
  picks the printing. Retro-frame reprints behave the same way.
- Prices: Mana Pool (live listings, condition-aware) plus Scryfall's daily TCGplayer / Cardmarket
  near-mint market prices (ignore condition). No buylist data; the TCGplayer API is closed to new developers.
- The camera-to-photo crop assumes the preview and photo share an aspect ratio (true on devices tested).
- The Mana Pool API is marked "in active development, can change without notice".

## Roadmap / TODO

- [ ] iOS build and release
- [x] Export (CSV, card list) and backup / restore (JSON)
- [x] Persist an unsaved Stack across app restarts
- [x] TCGplayer + Cardmarket prices (via Scryfall), selectable main price
- [ ] Card Kingdom buylist (public price-list file; check terms)
- [x] Hands-free Auto scanning (live-frame OCR, capture on a steady read)
- [x] Opened packs / boxes: cost vs value (sources + additions log)
- [x] Product picker: set list (Scryfall) + Mana Pool sealed prices + set codes from the cards (0.14: wrapper OCR removed)
- [x] Collection growth: start date, cards/value over time, daily value snapshots
- [ ] Price history / trend per card
- [ ] Verify the Opened flow on the phone with real cards
- [ ] Optional: "came from" (pack / box) on the card page
- [x] Quantity per card (multiple copies) instead of duplicate rows
- [ ] Dedicated release signing key + Play Store listing
- [ ] Optional: better handling for pre-2014 and retro-frame cards (printing hint from frame style)

## Attribution

Card data, images and TCGplayer / Cardmarket prices from Scryfall; live prices from Mana Pool. Mana and planeswalker symbols © Wizards of the
Coast. This project is unofficial and not affiliated with Wizards of the Coast, Scryfall or Mana Pool.
