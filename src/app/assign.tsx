import { Image } from 'expo-image';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { Alert, Pressable, SectionList, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { SaveSheet } from '../components/SaveSheet';
import { colors, readable } from '../components/theme';
import { assignAdditions, listSources, listUnsorted, type UnsortedRow } from '../lib/db';
import { useGalleryPrefs } from '../lib/prefs';
import { cachedPrice } from '../lib/prices';
import { formatCents } from '../lib/pricing';
import { setCodesByCount, suggestProducts, type Suggestion } from '../lib/sealed';
import { getSealedCatalog } from '../lib/sealedCatalog';
import { frontName } from '../lib/scryfall';
import { openBoxes, type Source } from '../lib/sources';
import { sourceForTarget, type SaveTarget } from '../lib/stack';
import { sessionsOf } from '../lib/unsorted';

const when = (iso: string) =>
  new Date(iso).toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

export default function AssignScreen() {
  const [{ priceSource }] = useGalleryPrefs();
  const insets = useSafeAreaInsets();
  const [rows, setRows] = useState<UnsortedRow[] | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [sheet, setSheet] = useState<{ boxes: Source[] } | null>(null);
  const [suggestions, setSuggestions] = useState<{ pack: Suggestion[]; box: Suggestion[] } | null>(null);
  const [saving, setSaving] = useState(false);

  useFocusEffect(
    useCallback(() => {
      let live = true;
      listUnsorted().then((r) => {
        if (!live) return;
        setRows(r);
        const first = sessionsOf(r)[0];
        setSelected(new Set(first?.rows.map((x) => x.addition_id) ?? []));
      });
      return () => {
        live = false;
      };
    }, []),
  );

  const sections = useMemo(
    () => sessionsOf(rows ?? []).map((s) => ({ key: s.start, title: when(s.start), data: s.rows })),
    [rows],
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
    if (target.kind === 'owned') return;
    setSaving(true);
    try {
      const id = await sourceForTarget(target);
      if (id == null) throw new Error('That box is gone.');
      await assignAdditions(chosen.map((r) => r.addition_id), id);
      router.replace({ pathname: '/source/[id]', params: { id: String(id) } });
    } catch (e) {
      Alert.alert('Not saved', e instanceof Error ? e.message : String(e));
      setSaving(false);
    }
  };

  return (
    <View style={styles.container}>
      <SectionList
        sections={sections}
        keyExtractor={(r) => String(r.addition_id)}
        stickySectionHeadersEnabled={false}
        contentContainerStyle={[{ padding: 12, paddingBottom: 120 }, readable]}
        ListEmptyComponent={
          rows ? <Text style={styles.empty}>Every card is already in a pack, box or deck.</Text> : undefined
        }
        renderSectionHeader={({ section }) => {
          const ids = section.data.map((r) => r.addition_id);
          const all = ids.every((id) => selected.has(id));
          return (
            <Pressable style={styles.sectionHeader} onPress={() => toggle(ids)}>
              <Text style={styles.sectionTitle}>
                {section.title} · {section.data.reduce((n, r) => n + r.copies, 0)}
              </Text>
              <Text style={styles.link}>{all ? 'Clear' : 'Select all'}</Text>
            </Pressable>
          );
        }}
        renderItem={({ item }) => {
          const on = selected.has(item.addition_id);
          const unit = cachedPrice(item, priceSource);
          return (
            <Pressable style={styles.row} onPress={() => toggle([item.addition_id])}>
              {item.image_uri ? (
                <Image source={{ uri: item.image_uri }} style={styles.thumb} contentFit="cover" />
              ) : (
                <View style={styles.thumb} />
              )}
              <View style={{ flex: 1, gap: 2 }}>
                <Text style={styles.name} numberOfLines={1}>
                  {frontName(item.name)}
                </Text>
                <Text style={styles.sub} numberOfLines={1}>
                  {item.set_code.toUpperCase()} #{item.collector_number}
                  {item.finish !== 'nonfoil' ? ` · ${item.finish}` : ''}
                  {item.copies > 1 ? ` · ×${item.copies}` : ''}
                </Text>
              </View>
              <Text style={styles.price}>{formatCents(unit == null ? null : unit * item.copies)}</Text>
              <View style={[styles.check, on && styles.checkOn]}>{on && <Text style={styles.checkMark}>✓</Text>}</View>
            </Pressable>
          );
        }}
      />

      <View style={[styles.footer, { paddingBottom: insets.bottom + 12 }]}>
        <Pressable
          style={[styles.button, (copies === 0 || saving) && { opacity: 0.5 }]}
          disabled={copies === 0 || saving}
          onPress={ask}
        >
          <Text style={styles.buttonText}>
            {saving ? 'Saving…' : `Add ${copies} to a pack or box · ${formatCents(value)}`}
          </Text>
        </Pressable>
      </View>

      {sheet && (
        <SaveSheet
          visible
          cardCount={copies}
          valueCents={value}
          openBoxes={sheet.boxes}
          opening={null}
          suggestions={suggestions}
          setCodes={setCodes}
          showOwned={false}
          onSave={save}
          onClose={() => setSheet(null)}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
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
  thumb: { width: 40, height: 56, borderRadius: 4, backgroundColor: colors.surfaceHigh },
  name: { color: colors.text, fontWeight: '600' },
  sub: { color: colors.textMuted, fontSize: 12 },
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
    paddingHorizontal: 16,
    paddingTop: 12,
    backgroundColor: colors.surface,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  button: { backgroundColor: colors.accent, paddingVertical: 14, borderRadius: 12, alignItems: 'center' },
  buttonText: { color: '#fff', fontWeight: '700' },
});
