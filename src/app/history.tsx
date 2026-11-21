import { Image } from 'expo-image';
import { router, Stack, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useMemo, useRef, useState } from 'react';
import { Alert, Pressable, SectionList, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { SaveSheet } from '../components/SaveSheet';
import { Segmented } from '../components/Segmented';
import { ToTopButton } from '../components/ToTopButton';
import { colors, readable } from '../components/theme';
import { assignAdditions, getSource, listHistory, listSources, type HistoryRow } from '../lib/db';
import { useGalleryPrefs } from '../lib/prefs';
import { cachedPrice } from '../lib/prices';
import { formatCents } from '../lib/pricing';
import { setCodesByCount, suggestProducts, type Suggestion } from '../lib/sealed';
import { getSealedCatalog } from '../lib/sealedCatalog';
import { frontName } from '../lib/scryfall';
import { openBoxes, type Source } from '../lib/sources';
import { sourceForTarget, type SaveTarget } from '../lib/stack';
import { historyRows, sessionsOf } from '../lib/unsorted';

const when = (iso: string) =>
  new Date(iso).toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

const printing = (r: HistoryRow) =>
  `${r.set_code.toUpperCase()} #${r.collector_number}${r.finish !== 'nonfoil' ? ` · ${r.finish}` : ''}`;

type Show = 'all' | 'loose';

export default function HistoryScreen() {
  const [{ priceSource }] = useGalleryPrefs();
  const insets = useSafeAreaInsets();
  const { into } = useLocalSearchParams<{ into?: string }>();
  const target = into ? Number(into) : null;
  const [targetName, setTargetName] = useState<string | null>(null);
  const list = useRef<SectionList<HistoryRow, { key: string; title: string; data: HistoryRow[] }>>(null);
  const [rows, setRows] = useState<HistoryRow[] | null>(null);
  const [show, setShow] = useState<Show>(target ? 'loose' : 'all');
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [sheet, setSheet] = useState<{ boxes: Source[] } | null>(null);
  const [suggestions, setSuggestions] = useState<{ pack: Suggestion[]; box: Suggestion[] } | null>(null);
  const [saving, setSaving] = useState(false);
  const [scrolled, setScrolled] = useState(false);

  const load = useCallback(async () => {
    setRows(await listHistory());
    if (target) setTargetName((await getSource(target))?.name ?? null);
  }, [target]);
  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  const sections = useMemo(
    () =>
      sessionsOf(historyRows(rows ?? [], show, target)).map((s) => ({
        key: s.start,
        title: when(s.start),
        data: s.rows,
      })),
    [rows, show, target],
  );
  const chosen = (rows ?? []).filter((r) => selected.has(r.addition_id));
  const copies = chosen.reduce((n, r) => n + r.copies, 0);
  const value = chosen.reduce((n, r) => n + (cachedPrice(r, priceSource) ?? 0) * r.copies, 0);
  const setCodes = setCodesByCount(chosen.map((r) => r.set_code));

  const toggle = (ids: number[]) =>
    setSelected((prev) => {
      const next = new Set(prev);
      const all = ids.every((id) => next.has(id));
      for (const id of ids) {
        if (all) next.delete(id);
        else next.add(id);
      }
      return next;
    });

  const addToTarget = async () => {
    setSaving(true);
    try {
      await assignAdditions(chosen.map((r) => r.addition_id), target);
      router.back();
    } catch (e) {
      Alert.alert('Not saved', e instanceof Error ? e.message : String(e));
      setSaving(false);
    }
  };

  const ask = async () => {
    let boxes: Source[] = [];
    try {
      boxes = openBoxes(await listSources());
    } catch {
    }
    setSheet({ boxes });
    setSuggestions(null);
    getSealedCatalog()
      .then((catalog) =>
        setSuggestions({
          pack: suggestProducts(catalog, { setCodes, want: 'pack' }, 4),
          box: suggestProducts(catalog, { setCodes, want: 'box' }, 4),
        }),
      )
      .catch(() => setSuggestions({ pack: [], box: [] }));
  };

  const save = async (target: SaveTarget) => {
    setSheet(null);
    setSaving(true);
    try {
      const id = await sourceForTarget(target);
      if (target.kind !== 'owned' && id == null) throw new Error('That box is gone.');
      await assignAdditions(chosen.map((r) => r.addition_id), id);
      setSelected(new Set());
      await load();
    } catch (e) {
      Alert.alert('Not saved', e instanceof Error ? e.message : String(e));
    }
    setSaving(false);
  };

  return (
    <View style={styles.container}>
      {target != null && <Stack.Screen options={{ title: targetName ? `Add to ${targetName}` : 'Add cards' }} />}
      <View style={styles.top}>
        <Segmented
          options={['all', 'loose'] as const}
          value={show}
          onChange={setShow}
          labels={{ all: 'All', loose: 'Not in a pack' }}
        />
      </View>
      <SectionList
        ref={list}
        sections={sections}
        keyExtractor={(r) => String(r.addition_id)}
        stickySectionHeadersEnabled={false}
        onScroll={(e) => setScrolled(e.nativeEvent.contentOffset.y > 1200)}
        scrollEventThrottle={200}
        contentContainerStyle={[{ padding: 12, paddingBottom: 120 }, readable]}
        ListEmptyComponent={
          rows ? (
            <Text style={styles.empty}>{show === 'all' ? 'No cards yet.' : 'Every card is in a pack, box or deck.'}</Text>
          ) : undefined
        }
        renderSectionHeader={({ section }) => {
          const ids = section.data.map((r) => r.addition_id);
          const all = ids.every((id) => selected.has(id));
          return (
            <Pressable style={styles.sectionHeader} onPress={() => toggle(ids)}>
              <Text style={styles.sectionTitle}>
                {section.title} · {section.data.reduce((n, r) => n + r.copies, 0)}
              </Text>
              <Text style={styles.link}>{all ? 'Clear' : 'Select'}</Text>
            </Pressable>
          );
        }}
        renderItem={({ item }) => {
          const on = selected.has(item.addition_id);
          const unit = cachedPrice(item, priceSource);
          return (
            <Pressable
              style={[styles.row, on && styles.rowOn]}
              onPress={() => toggle([item.addition_id])}
              onLongPress={() => router.push({ pathname: '/card/[id]', params: { id: String(item.id) } })}
            >
              {item.image_uri ? (
                <Image source={{ uri: item.image_uri }} style={styles.thumb} contentFit="cover" />
              ) : (
                <View style={styles.thumb} />
              )}
              <View style={{ flex: 1, gap: 2 }}>
                <Text style={styles.name} numberOfLines={1}>
                  {frontName(item.name)}
                  {item.copies > 1 ? ` ×${item.copies}` : ''}
                </Text>
                <Text style={styles.sub} numberOfLines={1}>
                  {printing(item)}
                </Text>
                <Text style={[styles.from, item.source_id == null && styles.fromNone]} numberOfLines={1}>
                  {item.source_name ?? 'Not in a pack'}
                </Text>
              </View>
              <Text style={styles.price}>{formatCents(unit == null ? null : unit * item.copies)}</Text>
              <View style={[styles.check, on && styles.checkOn]}>{on && <Text style={styles.checkMark}>✓</Text>}</View>
            </Pressable>
          );
        }}
      />

      {scrolled && copies === 0 && (
        <ToTopButton bottom={insets.bottom + 24} onPress={() => list.current?.scrollToLocation({ sectionIndex: 0, itemIndex: 0, viewOffset: 60 })} />
      )}

      {copies > 0 && (
        <View style={[styles.footer, { paddingBottom: insets.bottom + 12 }]}>
          <Pressable style={[styles.secondary]} onPress={() => setSelected(new Set())}>
            <Text style={styles.secondaryText}>Clear</Text>
          </Pressable>
          <Pressable style={[styles.button, saving && { opacity: 0.5 }]} disabled={saving} onPress={target ? addToTarget : ask}>
            <Text style={styles.buttonText} numberOfLines={1}>
              {saving ? 'Saving…' : `Add ${copies}${target ? '' : ' to a pack'} · ${formatCents(value)}`}
            </Text>
          </Pressable>
        </View>
      )}

      {sheet && (
        <SaveSheet
          visible
          cardCount={copies}
          valueCents={value}
          openBoxes={sheet.boxes}
          opening={null}
          suggestions={suggestions}
          setCodes={setCodes}
          showOwned={chosen.some((r) => r.source_id != null)}
          onSave={save}
          onClose={() => setSheet(null)}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  top: { paddingHorizontal: 12, paddingTop: 12 },
  empty: { color: colors.textMuted, textAlign: 'center', marginTop: 60 },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 4,
    paddingTop: 14,
    paddingBottom: 8,
  },
  sectionTitle: { color: colors.textMuted, fontWeight: '700', fontSize: 13 },
  link: { color: colors.accent, fontWeight: '600' },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 10,
    marginBottom: 8,
    backgroundColor: colors.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
  },
  rowOn: { borderColor: colors.accent },
  thumb: { width: 40, height: 56, borderRadius: 4, backgroundColor: colors.surfaceHigh },
  name: { color: colors.text, fontWeight: '600' },
  sub: { color: colors.textMuted, fontSize: 12 },
  from: { color: colors.accent, fontSize: 12, fontWeight: '600' },
  fromNone: { color: colors.textMuted, fontWeight: '400' },
  price: { color: colors.price, fontWeight: '700' },
  check: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkOn: { backgroundColor: colors.accent, borderColor: colors.accent },
  checkMark: { color: '#fff', fontWeight: '800', fontSize: 13 },
  footer: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    flexDirection: 'row',
    gap: 12,
    paddingHorizontal: 16,
    paddingTop: 12,
    backgroundColor: colors.surface,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  secondary: { paddingHorizontal: 20, paddingVertical: 14, borderRadius: 12, backgroundColor: colors.surfaceHigh },
  secondaryText: { color: colors.text, fontWeight: '700' },
  button: { flex: 1, backgroundColor: colors.accent, paddingVertical: 14, borderRadius: 12, alignItems: 'center' },
  buttonText: { color: '#fff', fontWeight: '700' },
});
