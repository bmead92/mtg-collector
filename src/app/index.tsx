import { Image } from 'expo-image';
import { router, Stack, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  AppState,
  FlatList,
  Linking,
  Platform,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native';
import { ActionSheet, type SheetOption } from '../components/ActionSheet';
import { ToTopButton } from '../components/ToTopButton';
import { FilterSettingsSheet } from '../components/FilterSettingsSheet';
import { colors } from '../components/theme';
import { AUTO_BACKUP_FOLDER, autoBackupAvailable } from '../lib/autoBackup';
import { setBrowseList } from '../lib/browse';
import { langLabel } from '../lib/language';
import { OpenedView } from '../components/OpenedView';
import { PackIcon } from '../components/PackIcon';
import { ProgressOverlay } from '../components/ProgressOverlay';
import { SellSheet } from '../components/SellSheet';
import { SoldView } from '../components/SoldView';
import { APP_NAME, APP_VERSION, DATA_CREDITS, DONATE_URL, FAN_CONTENT_NOTICE, REPO_URL } from '../lib/appInfo';
import { Segmented } from '../components/Segmented';
import {
  applyRestore,
  backfillCardMeta,
  getSetting,
  listSales,
  listScans,
  listSources,
  recordSnapshot,
  setSetting,
  type Scan,
} from '../lib/db';
import { checkForUpdate, dismissUpdate, type Update } from '../lib/updates';
import { recentDiagnostics } from '../lib/diag';
import { reportUrl } from '../lib/report';

import { dayKey } from '../lib/growth';
import {
  applyFilters,
  COLOR_CHIPS,
  hasActiveFilters,
  SORTS,
  TYPE_CHIPS,
  type ColorChip,
  type Filters,
  type SortKey,
  type TypeChip,
} from '../lib/filter';
import { planRestore, type ParsedBackup, type RestoreMode } from '../lib/backup';
import { pickBackup, shareBackup } from '../lib/backupFile';
import { shareExport, type ExportFormat } from '../lib/export';
import { runMaintenance } from '../lib/maintenance';
import { DEFAULT_PREFS, useGalleryPrefs, type GalleryPrefs } from '../lib/prefs';
import { formatCents, refreshPrices, removeScan } from '../lib/pricing';
import { cachedPrice } from '../lib/prices';
import { frontName, isDoubleFacedLayout } from '../lib/scryfall';
import { enqueueRead, useStack } from '../lib/stack';
import { setOpening, useOpening } from '../lib/opening';
import type { CardGuess } from '../lib/ocr';

function deviceInfo() {
  const c = (Platform.constants ?? {}) as { Model?: string; Brand?: string; Release?: string };
  return { model: c.Model ?? null, brand: c.Brand ?? null, android: c.Release ?? Platform.Version };
}

const EMPTY_FILTERS: Filters = { query: '', colors: [], types: [], minPriceCents: null };

const manaSymbol = (c: ColorChip) => `https://svgs.scryfall.io/card-symbols/${c}.svg`;
const MULTI_GOLD = '#d4a63a';

const RARITY_BADGE: Record<string, { label: string; color: string }> = {
  common: { label: 'Common', color: '#8a8f99' },
  uncommon: { label: 'Uncommon', color: '#b8c4d1' },
  rare: { label: 'Rare', color: '#d8b24a' },
  mythic: { label: 'Mythic', color: '#ef6a2a' },
  special: { label: 'Special', color: '#a674e0' },
  bonus: { label: 'Bonus', color: '#a674e0' },
};

function toggle<T>(list: T[], v: T): T[] {
  return list.includes(v) ? list.filter((x) => x !== v) : [...list, v];
}

const DEV_SAMPLE_READS: CardGuess[] = [
  { name: 'Sol Ring', setCode: 'CMR', collectorNumber: '472', foil: false, rawText: 'Sol Ring' },
  { name: 'Sphere Grid', setCode: 'FIC', collectorNumber: '70', foil: true, rawText: 'Sphere Grid' },
  { name: 'Cadric, Soul Kindler', setCode: 'DMC', collectorNumber: '10', foil: false, rawText: 'Cadric, Soul Kindler' },
  { name: null, setCode: 'MOM', collectorNumber: '1', lang: 'ja', foil: false, rawText: '' },
];

const TOP_AFTER_MS = 60_000;

export default function Gallery() {
  const stack = useStack();
  const [scans, setScans] = useState<Scan[]>([]);
  const [hasOpened, setHasOpened] = useState(false);
  const [hasSold, setHasSold] = useState(false);
  const [tab, setTab] = useState<'collection' | 'opened' | 'sold'>('collection');
  const [selling, setSelling] = useState<Scan | null>(null);
  const [update, setUpdate] = useState<Update | null>(null);
  useEffect(() => {
    checkForUpdate({ get: getSetting, set: setSetting })
      .then(setUpdate)
      .catch(() => {});
  }, []);
  const [refreshing, setRefreshing] = useState(false);
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [sort, setSort] = useState<SortKey>('price-desc');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [prefs, updatePrefs] = useGalleryPrefs();

  const changePrefs = (patch: Partial<GalleryPrefs>) => {
    const next = { ...prefs, ...patch };
    updatePrefs(patch);
    setFilters((f) => ({
      ...f,
      minPriceCents:
        !next.showPrice || (f.minPriceCents != null && !next.priceThresholds.includes(f.minPriceCents))
          ? null
          : f.minPriceCents,
      colors: next.showColors ? f.colors : [],
      types: next.showTypes ? f.types.filter((t) => next.types.includes(t)) : [],
    }));
  };
  const [sheet, setSheet] = useState<
    | { kind: 'tools' }
    | { kind: 'scan' }
    | { kind: 'sort' }
    | { kind: 'export' }
    | { kind: 'restore'; data: ParsedBackup }
    | { kind: 'card'; scan: Scan }
    | null
  >(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const opening = useOpening();
  const grid = useRef<FlatList<Scan>>(null);
  const [scrolled, setScrolled] = useState(false);
  const toTop = useCallback(() => grid.current?.scrollToOffset({ offset: 0, animated: false }), []);
  useEffect(() => {
    let leftAt = 0;
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'background') leftAt = Date.now();
      else if (state === 'active' && leftAt && Date.now() - leftAt >= TOP_AFTER_MS) toTop();
    });
    return () => sub.remove();
  }, [toTop]);
  const { width: winW } = useWindowDimensions();
  const columns = Math.max(2, Math.floor(winW / 200));
  const tileWidth = (winW - 24 - 12 * (columns - 1)) / columns;
  const [busy, setBusy] = useState<{ label: string; done?: number; total?: number } | null>(null);
  const [restores, setRestores] = useState(0);
  const openSheet = (next: NonNullable<typeof sheet>) => {
    setSheet(next);
    setSheetOpen(true);
  };

  const load = useCallback(async () => {
    const all = await listScans();
    setScans(all);
    setHasOpened((await listSources()).length > 0);
    const sold = (await listSales()).length > 0;
    setHasSold(sold);
    if (all.length > 0 || sold) {
      const sum = (src: 'manapool' | 'tcgplayer') => all.reduce((n, s) => n + (cachedPrice(s, src) ?? 0) * (s.quantity ?? 1), 0);
      const copiesNow = all.reduce((n, s) => n + (s.quantity ?? 1), 0);
      recordSnapshot(dayKey(Date.now()), sum('manapool'), sum('tcgplayer'), copiesNow).catch(() => {});
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  useEffect(() => {
    backfillCardMeta()
      .then((n) => (n > 0 ? load() : undefined))
      .catch(() => {});
    runMaintenance()
      .then(load)
      .catch(() => {});
  }, [load]);

  const source = prefs.priceSource;
  const priceOf = useCallback((s: Scan) => cachedPrice(s, source), [source]);
  const visibleScans = useMemo(
    () => (prefs.hideBelowCents == null ? scans : scans.filter((s) => (priceOf(s) ?? 0) >= prefs.hideBelowCents!)),
    [scans, prefs.hideBelowCents, priceOf],
  );
  const copies = (list: Scan[]) => list.reduce((n, s) => n + (s.quantity ?? 1), 0);
  const hiddenCount = copies(scans) - copies(visibleScans);
  const { items, error } = useMemo(
    () => applyFilters(visibleScans, filters, sort, priceOf),
    [visibleScans, filters, sort, priceOf],
  );
  const filtered = hasActiveFilters(filters);
  const total = items.reduce((sum, s) => sum + (priceOf(s) ?? 0) * (s.quantity ?? 1), 0);
  const shownCopies = copies(items);
  const allCopies = copies(visibleScans);
  const sortShort = SORTS.find((s) => s.key === sort)?.short ?? '';

  const onRefresh = async () => {
    setRefreshing(true);
    try {
      await refreshPrices(scans);
      await load();
    } catch (e) {
      Alert.alert('Could not refresh prices', String(e));
    } finally {
      setRefreshing(false);
    }
  };

  const openDetails = (s: Scan) => {
    setBrowseList(items.map((x) => x.id));
    router.push({ pathname: '/card/[id]', params: { id: String(s.id) } });
  };

  const confirmDelete = (s: Scan) =>
    Alert.alert(`Delete ${s.name}?`, 'This permanently removes it from your collection.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          await removeScan(s);
          await load();
        },
      },
    ]);

  const showActions = (s: Scan) => openSheet({ kind: 'card', scan: s });

  const pickSort = () => openSheet({ kind: 'sort' });

  const showTools = () => openSheet({ kind: 'tools' });
  const showAbout = () =>
    Alert.alert(`${APP_NAME} ${APP_VERSION}`, `${FAN_CONTENT_NOTICE}\n\n${DATA_CREDITS}`, [
      { text: 'GitHub', onPress: () => Linking.openURL(REPO_URL) },
      { text: 'Close', style: 'cancel' as const },
    ]);

  const runBackup = async () => {
    try {
      await shareBackup();
    } catch (e) {
      Alert.alert('Backup failed', e instanceof Error ? e.message : String(e));
    }
  };

  const runRestore = async () => {
    try {
      const data = await pickBackup();
      if (!data) return;
      if (data.backup.cards.length === 0) {
        Alert.alert('Nothing to restore', 'That backup has no cards in it.');
        return;
      }
      openSheet({ kind: 'restore', data });
    } catch (e) {
      Alert.alert("Couldn't read that file", e instanceof Error ? e.message : String(e));
    }
  };

  const applyBackup = async (data: ParsedBackup, mode: RestoreMode) => {
    try {
      const plan = planRestore(
        scans,
        data.backup.cards,
        mode,
        data.backup.sources,
        data.backup.snapshots,
        data.backup.sales,
      );
      setBusy({ label: 'Restoring', done: 0, total: 0 });
      await applyRestore(plan, (done, total) => setBusy({ label: 'Restoring', done, total }));
      const prefs = data.backup.prefs;
      if (mode === 'replace' && prefs && typeof prefs === 'object') changePrefs({ ...DEFAULT_PREFS, ...prefs });
      setBusy({ label: 'Loading collection' });
      await load();
      setRestores((n) => n + 1);
      setBusy(null);
      const copies = data.backup.cards.reduce((n, c) => n + c.quantity, 0);
      const skipped = data.skipped
        ? `\n\n${data.skipped} damaged entr${data.skipped === 1 ? 'y was' : 'ies were'} skipped.`
        : '';
      Alert.alert(
        'Restore complete',
        (mode === 'replace'
          ? `Your collection now has the ${copies} cards from the backup.`
          : `Added ${plan.insert.length} new card${plan.insert.length === 1 ? '' : 's'}` +
            (plan.raise.length ? `, updated the count on ${plan.raise.length}` : '') +
            (plan.unchanged ? `; ${plan.unchanged} already matched` : '') +
            '.') + skipped,
      );
    } catch (e) {
      setBusy(null);
      Alert.alert('Restore failed', `Nothing was changed.\n\n${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const confirmReplace = (data: ParsedBackup) =>
    Alert.alert(
      'Replace your collection?',
      `Your current ${allCopies} cards will be replaced by the ${data.backup.cards.reduce((n, c) => n + c.quantity, 0)} cards in the backup. Cards that aren't in the backup will be removed.`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Replace', style: 'destructive', onPress: () => applyBackup(data, 'replace') },
      ],
    );

  const runExport = async (format: ExportFormat) => {
    try {
      await shareExport(format, items);
    } catch (e) {
      Alert.alert('Export failed', e instanceof Error ? e.message : String(e));
    }
  };

  const sheetProps = ((): { title: string; subtitle?: string; options: SheetOption[] } | null => {
    if (!sheet) return null;
    if (sheet.kind === 'sort') {
      return {
        title: 'Sort by',
        options: SORTS.map((o) => ({ label: o.label, selected: o.key === sort, onPress: () => setSort(o.key) })),
      };
    }
    if (sheet.kind === 'scan') {
      return {
        title: 'What are you scanning?',
        options: [
          ...(opening
            ? [{ icon: '★', label: `Keep opening ${opening.product.name}`, onPress: () => router.push('/scan') }]
            : []),
          {
            icon: '◇',
            label: 'A pack or box',
            description: 'Pick what you are opening',
            onPress: () => router.push({ pathname: '/scan', params: { pick: '1' } }),
          },
          {
            icon: '✓',
            label: 'Singles',
            description: 'Cards you already have',
            onPress: () => {
              setOpening(null);
              router.push('/scan');
            },
          },
          {
            icon: '⌕',
            label: 'Search by name',
            description: 'Add a card without the camera',
            onPress: () => router.push('/add'),
          },
        ],
      };
    }
    if (sheet.kind === 'tools') {
      return {
        title: 'Tools',
        options: [
          {
            icon: '↻',
            label: 'Refresh all prices',
            description: 'Fetch the latest Mana Pool prices for every card',
            onPress: onRefresh,
          },
          {
            icon: '⇪',
            label: 'Export',
            description: filtered ? `Share the ${shownCopies} cards shown` : 'Share your collection as a file',
            onPress: () => openSheet({ kind: 'export' }),
          },
          {
            icon: '◇',
            label: 'History',
            description: 'Every card you added, by day; add them to a pack',
            onPress: () => router.push('/history'),
          },
          {
            icon: '⇩',
            label: 'Import deck',
            description: 'A precon, or a list from Moxfield or Archidekt',
            onPress: () => router.push('/import'),
          },
          {
            icon: '⤓',
            label: 'Back up collection',
            description: autoBackupAvailable()
              ? `Also saved daily to Downloads › ${AUTO_BACKUP_FOLDER}`
              : 'Save a backup file to Drive, email, or anywhere',
            onPress: runBackup,
          },
          {
            icon: '⤒',
            label: 'Restore from backup',
            description: 'Bring cards back from a backup file',
            onPress: runRestore,
          },
          ...(__DEV__
            ? [
                {
                  icon: '⚙',
                  label: 'Dev: sample cards',
                  description: 'Add real cards to the Stack without the camera (debug builds only)',
                  onPress: () => {
                    for (const g of DEV_SAMPLE_READS) enqueueRead(g);
                    router.push('/stack');
                  },
                },
              ]
            : []),
          {
            icon: '!',
            label: 'Report a problem',
            description: 'Opens a GitHub issue with app and scan details',
            onPress: () => Linking.openURL(reportUrl(deviceInfo(), recentDiagnostics())),
          },
          ...(DONATE_URL
            ? [
                {
                  icon: <PackIcon size={22} />,
                  label: 'Buy me a pack',
                  description: 'Optional tip on Ko-fi',
                  onPress: () => Linking.openURL(DONATE_URL!),
                },
              ]
            : []),
          {
            icon: 'i',
            label: 'About',
            description: `Version ${APP_VERSION}`,
            onPress: showAbout,
          },
        ],
      };
    }
    if (sheet.kind === 'restore') {
      const { backup, skipped } = sheet.data;
      const copies = backup.cards.reduce((n, c) => n + c.quantity, 0);
      const when = backup.exportedAt ? new Date(backup.exportedAt).toLocaleDateString() : 'an unknown date';
      return {
        title: 'Restore backup',
        subtitle: `${copies} cards from ${when}${skipped ? ` · ${skipped} damaged entries will be skipped` : ''}`,
        options: [
          {
            icon: '+',
            label: 'Add missing cards',
            description: 'Keep your collection and add what the backup has',
            onPress: () => applyBackup(sheet.data, 'merge'),
          },
          {
            icon: '⟲',
            label: 'Replace my collection',
            description: 'Make your collection exactly match the backup',
            destructive: true,
            onPress: () => confirmReplace(sheet.data),
          },
        ],
      };
    }
    if (sheet.kind === 'export') {
      return {
        title: filtered ? `Export ${shownCopies} shown cards` : `Export all ${shownCopies} cards`,
        subtitle: filtered ? 'Only the cards matching your current filters' : undefined,
        options: [
          {
            icon: '▦',
            label: 'Spreadsheet (CSV)',
            description: 'Opens in Google Sheets or Excel; includes prices',
            onPress: () => runExport('csv'),
          },
          {
            icon: '≡',
            label: 'Card list',
            description: 'One card per line, for Mana Pool, Moxfield and similar sites',
            onPress: () => runExport('list'),
          },
        ],
      };
    }
    const s = sheet.scan;
    return {
      title: frontName(s.name),
      subtitle: `${s.set_name} · #${s.collector_number} · ${formatCents(priceOf(s))}${
        (s.quantity ?? 1) > 1 ? ` · ×${s.quantity}` : ''
      }`,
      options: [
        { icon: '›', label: 'View photo & details', onPress: () => openDetails(s) },
        { icon: '$', label: 'Sell', onPress: () => setSelling(s) },
        { icon: '✕', label: 'Delete card', destructive: true, onPress: () => confirmDelete(s) },
      ],
    };
  })();
  const shown = sheetProps;

  const tabOptions = [
    'collection' as const,
    ...(hasOpened ? (['opened'] as const) : []),
    ...(hasSold ? (['sold'] as const) : []),
  ];
  const currentTab = tabOptions.includes(tab) ? tab : 'collection';
  const tabs = tabOptions.length > 1 && (
    <View style={styles.tabs}>
      <Segmented
        options={tabOptions}
        value={currentTab}
        onChange={setTab}
        labels={{ collection: 'Collection', opened: 'Opened', sold: 'Sold' }}
      />
    </View>
  );

  const header = (
    <View style={styles.headerWrap}>
      {tabs}
      <View style={styles.summary}>
        <Text style={styles.summaryLabel}>
          {filtered ? `${shownCopies.toLocaleString()} of ${allCopies.toLocaleString()}` : allCopies.toLocaleString()} card
          {allCopies === 1 ? '' : 's'}
          {shownCopies !== items.length ? ` (${items.length.toLocaleString()} unique)` : ''} · sorted by {sortShort}
          {hiddenCount > 0 && prefs.hideBelowCents != null
            ? ` · ${hiddenCount} under $${(prefs.hideBelowCents / 100).toFixed(2)} hidden`
            : ''}
          {source === 'tcgplayer' ? ' · TCGplayer prices' : ''}
        </Text>
        <View style={styles.summaryRow}>
          <Text style={styles.summaryValue}>{formatCents(total)}</Text>
          {scans.length > 0 && (
            <Pressable onPress={() => router.push('/growth')} hitSlop={10} style={styles.growthLink}>
              <Text style={styles.growthLinkText}>Growth ›</Text>
            </Pressable>
          )}
        </View>
      </View>

      {update && (
        <View style={styles.stackBanner}>
          <Pressable style={{ flex: 1 }} onPress={() => Linking.openURL(update.url)}>
            <Text style={styles.stackBannerText}>
              Version {update.version} available · <Text style={styles.stackBannerLink}>Download</Text>
            </Text>
          </Pressable>
          <Pressable
            hitSlop={12}
            onPress={() => {
              dismissUpdate({ get: getSetting, set: setSetting }, update.version).catch(() => {});
              setUpdate(null);
            }}
            accessibilityLabel="Dismiss"
          >
            <Text style={styles.stackBannerText}>✕</Text>
          </Pressable>
        </View>
      )}

      {stack.length > 0 && (
        <Pressable style={styles.stackBanner} onPress={() => router.push('/stack')}>
          <Text style={styles.stackBannerText}>
            {stack.length} unsaved card{stack.length === 1 ? '' : 's'} in your stack
          </Text>
          <Text style={styles.stackBannerLink}>Review ›</Text>
        </Pressable>
      )}

      <View style={styles.searchRow}>
        <View style={styles.searchBox}>
          <TextInput
            value={filters.query}
            onChangeText={(query) => setFilters((f) => ({ ...f, query }))}
            placeholder="Search"
            placeholderTextColor={colors.textMuted}
            style={styles.search}
            autoCorrect={false}
            autoCapitalize="none"
            returnKeyType="search"
          />
          {filters.query.length > 0 && (
            <Pressable hitSlop={10} onPress={() => setFilters((f) => ({ ...f, query: '' }))} style={styles.searchIcon}>
              <Text style={styles.searchIconText}>✕</Text>
            </Pressable>
          )}
        </View>
        <Pressable style={styles.iconButton} onPress={pickSort} accessibilityLabel="Sort">
          <Text style={styles.iconButtonText}>⇅</Text>
        </Pressable>
        <Pressable
          style={styles.iconButton}
          onPress={() => setSettingsOpen(true)}
          accessibilityLabel="Customize filters"
        >
          <Text style={styles.iconButtonText}>⚙</Text>
        </Pressable>
      </View>
      {error && <Text style={styles.error}>{error}</Text>}

      {prefs.showPrice && prefs.priceThresholds.length > 0 && (
        <View style={styles.segmented}>
          {[null, ...prefs.priceThresholds].map((c) => {
            const on = filters.minPriceCents === c;
            return (
              <Pressable
                key={String(c)}
                style={[styles.segment, on && styles.segmentOn]}
                onPress={() => setFilters((f) => ({ ...f, minPriceCents: c }))}
              >
                <Text style={[styles.segmentText, on && styles.segmentTextOn]}>
                  {c == null ? 'Any' : `$${c / 100}+`}
                </Text>
              </Pressable>
            );
          })}
        </View>
      )}

      {prefs.showColors && (
        <View style={styles.wrapRow}>
          {COLOR_CHIPS.map((c) => {
            const on = filters.colors.includes(c);
            const onPress = () => setFilters((f) => ({ ...f, colors: toggle(f.colors, c) }));
            if (c === 'M') {
              return (
                <Pressable key={c} style={[styles.multiChip, on && styles.multiChipOn]} onPress={onPress}>
                  <Text style={[styles.multiChipText, on && styles.multiChipTextOn]}>Multi</Text>
                </Pressable>
              );
            }
            return (
              <Pressable key={c} style={[styles.colorChip, on && styles.colorChipOn]} onPress={onPress}>
                <Image source={{ uri: manaSymbol(c) }} style={[styles.manaSymbol, !on && styles.manaSymbolOff]} />
              </Pressable>
            );
          })}
        </View>
      )}

      {prefs.showTypes && prefs.types.length > 0 && (
        <View style={styles.wrapRow}>
          {TYPE_CHIPS.filter((t) => prefs.types.includes(t.key)).map(({ key, short }) => {
            const on = filters.types.includes(key);
            return (
              <Pressable
                key={key}
                style={[styles.typeChip, on && styles.typeChipOn]}
                onPress={() => setFilters((f) => ({ ...f, types: toggle<TypeChip>(f.types, key) }))}
              >
                <Text style={[styles.typeChipText, on && styles.typeChipTextOn]}>{short}</Text>
              </Pressable>
            );
          })}
        </View>
      )}

      {filtered && (
        <Pressable onPress={() => setFilters(EMPTY_FILTERS)} style={styles.clear}>
          <Text style={styles.clearText}>Clear filters</Text>
        </Pressable>
      )}
    </View>
  );

  return (
    <View style={styles.container}>
      <Stack.Screen
        options={{
          headerRight: () => (
            <Pressable onPress={showTools} hitSlop={12}>
              <Text style={styles.toolsText}>⋯</Text>
            </Pressable>
          ),
        }}
      />
      {currentTab === 'opened' ? (
        <OpenedView key={restores} priceSource={source} header={tabs} />
      ) : currentTab === 'sold' ? (
        <SoldView key={restores} header={tabs || undefined} onChange={load} />
      ) : (
      <FlatList
        ref={grid}
        key={`cols-${columns}`}
        onScroll={(e) => setScrolled(e.nativeEvent.contentOffset.y > 1500)}
        scrollEventThrottle={200}
        data={items}
        extraData={prefs} // rows read prefs (rarity badges), so re-render them when prefs change
        keyExtractor={(s) => String(s.id)}
        numColumns={columns}
        columnWrapperStyle={{ gap: 12, paddingHorizontal: 12 }}
        contentContainerStyle={{ gap: 12, paddingBottom: 120 }}
        ListHeaderComponent={header}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.text} />}
        ListEmptyComponent={
          <Text style={styles.empty}>
            {scans.length === 0 ? 'No cards yet. Tap Scan to photograph your first card.' : 'No cards match.'}
          </Text>
        }
        renderItem={({ item }) => (
          <Pressable
            style={[styles.tile, { maxWidth: tileWidth }]}
            onPress={() => openDetails(item)}
            onLongPress={() => showActions(item)}
            delayLongPress={350}
          >
            <Image
              source={{ uri: item.image_uri ?? item.photo_uri }}
              style={styles.photo}
              contentFit={item.image_uri ? 'contain' : 'cover'}
              transition={150}
            />
            <View style={styles.badge}>
              <Text style={styles.badgeText}>{formatCents(priceOf(item))}</Text>
            </View>
            {(item.quantity ?? 1) > 1 && (
              <View style={styles.qtyBadge}>
                <Text style={styles.qtyBadgeText}>×{item.quantity}</Text>
              </View>
            )}
            <View style={styles.meta}>
              <Text style={styles.name} numberOfLines={1}>
                {isDoubleFacedLayout(item.layout) ? `⇄ ${frontName(item.name)}` : item.name}
              </Text>
              <View style={styles.subRow}>
                {prefs.rarityBadges && item.rarity && RARITY_BADGE[item.rarity] && (
                  <View style={[styles.rarityBadge, { borderColor: RARITY_BADGE[item.rarity].color }]}>
                    <Text style={[styles.rarityText, { color: RARITY_BADGE[item.rarity].color }]}>
                      {RARITY_BADGE[item.rarity].label}
                    </Text>
                  </View>
                )}
                <Text style={[styles.sub, { flex: 1 }]} numberOfLines={1}>
                  {item.set_code.toUpperCase()} #{item.collector_number} · {item.condition}
                  {langLabel(item.lang) ? ` · ${langLabel(item.lang)}` : ''}
                  {item.finish !== 'nonfoil' ? ` · ${item.finish}` : ''}
                </Text>
              </View>
            </View>
          </Pressable>
        )}
      />
      )}

      {currentTab === 'collection' && scrolled && (
        <ToTopButton bottom={36} onPress={() => grid.current?.scrollToOffset({ offset: 0, animated: true })} />
      )}

      <Pressable style={styles.fab} onPress={() => openSheet({ kind: 'scan' })}>
        <Text style={styles.fabText}>Scan</Text>
      </Pressable>

      <FilterSettingsSheet
        visible={settingsOpen}
        prefs={prefs}
        onChange={changePrefs}
        onClose={() => setSettingsOpen(false)}
      />

      <ActionSheet
        visible={sheetOpen}
        title={shown?.title}
        subtitle={shown?.subtitle}
        options={shown?.options ?? []}
        onClose={() => setSheetOpen(false)}
      />

      {selling && (
        <SellSheet
          scan={selling}
          unitCents={priceOf(selling)}
          onClose={() => setSelling(null)}
          onSold={async () => {
            setSelling(null);
            await load();
          }}
        />
      )}

      <ProgressOverlay progress={busy} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  headerWrap: { paddingBottom: 4 },
  summary: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  summaryLabel: { color: colors.textMuted, fontSize: 13 },
  summaryValue: { color: colors.price, fontSize: 28, fontWeight: '700' },
  tabs: { marginHorizontal: 12, marginTop: 10 },
  summaryRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  growthLink: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  growthLinkText: { color: colors.accent, fontWeight: '700' },
  stackBanner: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginHorizontal: 12,
    marginTop: 12,
    padding: 12,
    borderRadius: 10,
    backgroundColor: colors.surfaceHigh,
    borderWidth: 1,
    borderColor: colors.accent,
  },
  stackBannerText: { color: colors.text, fontWeight: '600' },
  stackBannerLink: { color: colors.accent, fontWeight: '700' },
  searchRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginHorizontal: 12, marginTop: 12 },
  searchBox: { flex: 1, justifyContent: 'center' },
  search: {
    backgroundColor: colors.surface,
    color: colors.text,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 14,
    paddingVertical: 10,
    paddingRight: 40,
    fontSize: 15,
  },
  searchIcon: { position: 'absolute', right: 12, width: 24, alignItems: 'center' },
  searchIconText: { color: colors.textMuted, fontSize: 16, fontWeight: '700' },
  iconButton: {
    width: 44,
    height: 44,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  iconButtonText: { color: colors.text, fontSize: 18, fontWeight: '700' },
  error: { color: colors.danger, marginHorizontal: 16, marginTop: 6, fontSize: 12 },
  segmented: {
    flexDirection: 'row',
    marginHorizontal: 12,
    marginTop: 12,
    padding: 3,
    borderRadius: 12,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  segment: { flex: 1, paddingVertical: 8, borderRadius: 9, alignItems: 'center' },
  segmentOn: { backgroundColor: colors.accent },
  segmentText: { color: colors.textMuted, fontSize: 13, fontWeight: '600' },
  segmentTextOn: { color: '#fff' },
  wrapRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingHorizontal: 12, paddingTop: 12 },
  colorChip: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface,
    borderWidth: 2,
    borderColor: colors.border,
  },
  colorChipOn: { borderColor: '#fff', backgroundColor: colors.surfaceHigh },
  manaSymbol: { width: 26, height: 26 },
  manaSymbolOff: { opacity: 0.4 },
  multiChip: {
    height: 38,
    paddingHorizontal: 14,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface,
    borderWidth: 2,
    borderColor: MULTI_GOLD,
  },
  multiChipOn: { backgroundColor: MULTI_GOLD, borderColor: '#fff' },
  multiChipText: { color: MULTI_GOLD, fontWeight: '800', fontSize: 13 },
  multiChipTextOn: { color: '#1d1606' },
  typeChip: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.border,
  },
  typeChipOn: { backgroundColor: 'rgba(79,140,255,0.18)', borderColor: colors.accent },
  typeChipText: { color: colors.textMuted, fontSize: 13, fontWeight: '600' },
  typeChipTextOn: { color: colors.accent },
  clear: { alignSelf: 'flex-start', marginHorizontal: 16, marginTop: 10 },
  clearText: { color: colors.accent, fontWeight: '600' },
  toolsText: { color: colors.text, fontSize: 26, fontWeight: '700', paddingHorizontal: 8 },
  empty: { color: colors.textMuted, textAlign: 'center', marginTop: 60, paddingHorizontal: 32 },
  tile: {
    flex: 1,
    backgroundColor: colors.surface,
    borderRadius: 12,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: colors.border,
  },
  photo: { width: '100%', aspectRatio: 63 / 88, backgroundColor: colors.surfaceHigh },
  badge: {
    position: 'absolute',
    top: 8,
    right: 8,
    backgroundColor: 'rgba(0,0,0,0.75)',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
  },
  badgeText: { color: colors.price, fontWeight: '700' },
  qtyBadge: {
    position: 'absolute',
    top: 8,
    left: 8,
    backgroundColor: colors.accent,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
  },
  qtyBadgeText: { color: '#fff', fontWeight: '800' },
  meta: { padding: 8 },
  name: { color: colors.text, fontWeight: '600' },
  sub: { color: colors.textMuted, fontSize: 12 },
  subRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 4 },
  rarityBadge: { borderWidth: 1, borderRadius: 6, paddingHorizontal: 5, paddingVertical: 1 },
  rarityText: { fontSize: 10, fontWeight: '800', letterSpacing: 0.3, textTransform: 'uppercase' },
  fab: {
    position: 'absolute',
    bottom: 32,
    alignSelf: 'center',
    backgroundColor: colors.accent,
    paddingHorizontal: 36,
    paddingVertical: 16,
    borderRadius: 32,
    elevation: 6,
  },
  fabText: { color: '#fff', fontSize: 18, fontWeight: '700' },
});
