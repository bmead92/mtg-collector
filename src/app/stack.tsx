import { Image } from 'expo-image';
import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { langLabel } from '../lib/language';
import { PrintingPicker } from '../components/PrintingPicker';
import { SaveSheet } from '../components/SaveSheet';
import { Segmented } from '../components/Segmented';
import { colors, readable } from '../components/theme';
import { listSources } from '../lib/db';
import { CONDITIONS } from '../lib/manapool';
import { useGalleryPrefs } from '../lib/prefs';
import { formatCents } from '../lib/pricing';
import { cardByFuzzyName, cardImage } from '../lib/scryfall';
import { openBoxes, type Source } from '../lib/sources';
import { getOpening, setOpening, useOpening } from '../lib/opening';
import { setCodesByCount, suggestProducts, type Suggestion } from '../lib/sealed';
import { getSealedCatalog } from '../lib/sealedCatalog';
import {
  clearStack,
  isBusy,
  isLikelyRepeat,
  itemPrice,
  removeItem,
  saveStack,
  setItemCard,
  updateItem,
  useStack,
  type SaveTarget,
  type StackItem,
  type StackStatus,
} from '../lib/stack';

const STATUS_LABEL: Record<StackStatus, string> = {
  queued: 'Waiting…',
  reading: 'Reading…',
  identifying: 'Identifying…',
  pricing: 'Pricing…',
  done: '',
  failed: 'Failed',
};

export default function StackScreen() {
  const [{ priceSource }] = useGalleryPrefs();
  const insets = useSafeAreaInsets();
  const items = useStack();
  const [expanded, setExpanded] = useState<string | null>(null);
  const [pickerFor, setPickerFor] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [sortBy, setSortBy] = useState<'order' | 'price'>('order');
  const [saving, setSaving] = useState(false);
  const [saveSheet, setSaveSheet] = useState<{ boxes: Source[] } | null>(null);
  const opening = useOpening();
  const [suggestions, setSuggestions] = useState<{ pack: Suggestion[]; box: Suggestion[] } | null>(null);

  const busyCount = items.filter(isBusy).length;
  const toSave = items.filter((i) => i.include && i.card && i.status === 'done');
  const total = toSave.reduce((sum, i) => sum + (itemPrice(i, priceSource) ?? 0), 0);

  const ordered = useMemo(
    () =>
      sortBy === 'order'
        ? items
        : [...items].sort((a, b) => (itemPrice(b, priceSource) ?? -1) - (itemPrice(a, priceSource) ?? -1)),
    [items, sortBy, priceSource],
  );

  const runSearch = async (id: string) => {
    if (!search.trim()) return;
    try {
      const c = await cardByFuzzyName(search.trim());
      if (!c) Alert.alert('No match', `Scryfall couldn't find "${search}".`);
      else setItemCard(id, c, 'name');
    } catch (e) {
      Alert.alert('Search failed', String(e));
    }
  };

  const askWhereFrom = async () => {
    let boxes: Source[] = [];
    try {
      boxes = openBoxes(await listSources());
    } catch {
    }
    setSaveSheet({ boxes });
    setSuggestions(null);
    const setCodes = setCodesByCount(toSave.map((i) => i.card!.set));
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
    setSaveSheet(null);
    setSaving(true);
    try {
      await saveStack(target);
      if (getOpening()) setOpening(null); // those cards are saved: the next scan starts fresh
      router.dismissTo('/');
    } catch (e) {
      Alert.alert('Save failed', String(e));
      setSaving(false);
    }
  };

  const confirmClear = () =>
    Alert.alert('Clear stack?', 'Discard every card in the stack (nothing is saved)?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Clear',
        style: 'destructive',
        onPress: () => {
          clearStack();
          router.back();
        },
      },
    ]);

  const pickerItem = items.find((i) => i.id === pickerFor) ?? null;

  const renderItem = ({ item }: { item: StackItem }) => {
    const open = expanded === item.id;
    const price = itemPrice(item, priceSource);
    const thumb = (item.card && cardImage(item.card, 'small')) || item.photoUri;
    return (
      <View style={[styles.row, !item.include && styles.excluded]}>
        <Pressable
          style={styles.rowMain}
          disabled={isBusy(item) && !item.photoUri}
          onPress={() => {
            setExpanded(open ? null : item.id);
            setSearch(item.card?.name ?? item.guess?.name ?? '');
          }}
        >
          {thumb ? (
            <Image source={{ uri: thumb }} style={styles.thumb} contentFit="cover" />
          ) : (
            <View style={[styles.thumb, styles.center]}>
              <ActivityIndicator color={colors.text} />
            </View>
          )}
          <View style={{ flex: 1, gap: 2 }}>
            <Text style={styles.position}>#{item.number}</Text>
            {item.card ? (
              <>
                <Text style={styles.name} numberOfLines={1}>
                  {item.card.name}
                </Text>
                <Text style={styles.sub} numberOfLines={1}>
                  {item.card.set.toUpperCase()} #{item.card.collector_number} · {item.condition}
                  {langLabel(item.card.lang) ? ` · ${langLabel(item.card.lang)}` : ''}
                  {item.finish !== 'nonfoil' ? ` · ${item.finish}` : ''}
                  {item.method !== 'set+number' && !item.doubtful ? ' · check printing' : ''}
                </Text>
                {item.doubtful && <Text style={styles.warn}>Check card: the name read doesn&apos;t match</Text>}
                {!item.doubtful && item.include && isLikelyRepeat(item, items) && (
                  <Text style={styles.warn}>Repeat? Untick unless it&apos;s a second copy</Text>
                )}
              </>
            ) : item.status === 'done' ? (
              <Text style={styles.warn}>Not identified — tap to search</Text>
            ) : item.status === 'failed' ? (
              <Text style={styles.warn} numberOfLines={2}>
                Failed: {item.error}
              </Text>
            ) : (
              <Text style={styles.sub}>{STATUS_LABEL[item.status]}</Text>
            )}
          </View>
          <View style={{ alignItems: 'flex-end', gap: 6 }}>
            <Text style={styles.price}>{item.status === 'pricing' ? '…' : item.card ? formatCents(price) : ''}</Text>
            <Pressable hitSlop={10} onPress={() => updateItem(item.id, { include: !item.include })}>
              <Text style={[styles.toggle, !item.include && { color: colors.textMuted }]}>
                {item.include ? '✓ Keep' : '✕ Skip'}
              </Text>
            </Pressable>
          </View>
        </Pressable>

        {open && (
          <View style={styles.editor}>
            <View style={{ flexDirection: 'row', gap: 12 }}>
              {item.photoUri && <Image source={{ uri: item.photoUri }} style={styles.crop} contentFit="cover" />}
              <View style={{ flex: 1, gap: 8 }}>
                <Text style={styles.label}>Your photo</Text>
                {item.card && (
                  <Pressable onPress={() => setPickerFor(item.id)}>
                    <Text style={styles.link}>Change printing</Text>
                  </Pressable>
                )}
                {item.guess && (
                  <Text style={styles.sub}>
                    OCR: {item.guess.name ?? '∅'} · {item.guess.setCode ?? '∅'} #{item.guess.collectorNumber ?? '∅'}
                  </Text>
                )}
                <Pressable onPress={() => removeItem(item.id)}>
                  <Text style={[styles.link, { color: colors.danger }]}>Remove from stack</Text>
                </Pressable>
              </View>
            </View>

            {item.card && (
              <>
                <Text style={styles.label}>Finish</Text>
                <Segmented
                  options={item.card.finishes}
                  value={item.finish}
                  onChange={(f) => updateItem(item.id, { finish: f })}
                  labels={{ nonfoil: 'Non-foil', foil: 'Foil', etched: 'Etched' }}
                />
                <Text style={styles.label}>Condition</Text>
                <Segmented
                  options={CONDITIONS}
                  value={item.condition}
                  onChange={(c) => updateItem(item.id, { condition: c })}
                />
              </>
            )}

            <Text style={styles.label}>Wrong card? Search by name</Text>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <TextInput
                value={search}
                onChangeText={setSearch}
                onSubmitEditing={() => runSearch(item.id)}
                placeholder="Card name"
                placeholderTextColor={colors.textMuted}
                style={styles.input}
                returnKeyType="search"
              />
              <Pressable style={styles.smallButton} onPress={() => runSearch(item.id)}>
                <Text style={styles.buttonText}>Search</Text>
              </Pressable>
            </View>
          </View>
        )}
      </View>
    );
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <View style={{ flex: 1 }}>
          <Text style={styles.headerTitle}>
            {items.length} card{items.length === 1 ? '' : 's'}
            {busyCount > 0 ? ` · ${busyCount} processing` : ''}
          </Text>
          <Text style={styles.headerSub}>Kept value {formatCents(total)} · tap a row to fix it</Text>
        </View>
        <View style={{ width: 150 }}>
          <Segmented
            options={['order', 'price'] as const}
            value={sortBy}
            onChange={setSortBy}
            labels={{ order: 'Order', price: 'Price' }}
          />
        </View>
      </View>

      <FlatList
        data={ordered}
        keyExtractor={(i) => i.id}
        renderItem={renderItem}
        contentContainerStyle={[{ padding: 12, gap: 10, paddingBottom: 120 }, readable]}
        ListEmptyComponent={<Text style={styles.empty}>The stack is empty.</Text>}
        ListFooterComponent={
          items.length > 0 ? (
            <Pressable onPress={confirmClear} style={{ alignSelf: 'center', padding: 12 }}>
              <Text style={[styles.link, { color: colors.danger }]}>Clear stack</Text>
            </Pressable>
          ) : undefined
        }
      />

      <View style={[styles.footer, { paddingBottom: insets.bottom + 12 }]}>
        <Pressable style={[styles.button, styles.secondary]} onPress={() => router.back()}>
          <Text style={styles.buttonText}>Scan more</Text>
        </Pressable>
        <Pressable
          style={[styles.button, (toSave.length === 0 || saving) && { opacity: 0.5 }]}
          onPress={askWhereFrom}
          disabled={toSave.length === 0 || saving}
        >
          <Text style={styles.buttonText}>{saving ? 'Saving…' : `Save ${toSave.length} · ${formatCents(total)}`}</Text>
        </Pressable>
      </View>

      {saveSheet && (
        <SaveSheet
          visible
          cardCount={toSave.length}
          valueCents={total}
          openBoxes={saveSheet.boxes}
          opening={opening}
          suggestions={suggestions}
          setCodes={setCodesByCount(toSave.map((i) => i.card!.set))}
          onSave={save}
          onClose={() => setSaveSheet(null)}
        />
      )}

      <PrintingPicker
        visible={pickerFor !== null}
        card={pickerItem?.card ?? null}
        onSelect={(c) => {
          if (pickerFor) setItemCard(pickerFor, c);
          setPickerFor(null);
        }}
        onClose={() => setPickerFor(null)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  center: { alignItems: 'center', justifyContent: 'center' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  headerTitle: { color: colors.text, fontSize: 16, fontWeight: '700' },
  headerSub: { color: colors.textMuted, fontSize: 13, marginTop: 2 },
  empty: { color: colors.textMuted, textAlign: 'center', marginTop: 60 },
  row: {
    backgroundColor: colors.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
  },
  excluded: { opacity: 0.45 },
  rowMain: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 10 },
  thumb: { width: 52, height: 72, borderRadius: 4, backgroundColor: colors.surfaceHigh },
  position: { color: colors.textMuted, fontSize: 11 },
  name: { color: colors.text, fontWeight: '600' },
  sub: { color: colors.textMuted, fontSize: 12 },
  warn: { color: colors.danger, fontWeight: '600' },
  price: { color: colors.price, fontWeight: '800', fontSize: 16 },
  toggle: { color: colors.accent, fontWeight: '600', fontSize: 12 },
  editor: {
    padding: 12,
    gap: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    backgroundColor: colors.bg,
  },
  crop: { width: 90, aspectRatio: 63 / 88, borderRadius: 6, backgroundColor: colors.surfaceHigh },
  label: { color: colors.textMuted, fontSize: 12, textTransform: 'uppercase', marginTop: 4 },
  link: { color: colors.accent, fontWeight: '600' },
  input: {
    flex: 1,
    backgroundColor: colors.surfaceHigh,
    color: colors.text,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  smallButton: { backgroundColor: colors.accent, paddingHorizontal: 16, borderRadius: 8, justifyContent: 'center' },
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
  button: { flex: 1, backgroundColor: colors.accent, paddingVertical: 14, borderRadius: 12, alignItems: 'center' },
  secondary: { flex: 0, paddingHorizontal: 20, backgroundColor: colors.surfaceHigh },
  buttonText: { color: '#fff', fontWeight: '700' },
});
