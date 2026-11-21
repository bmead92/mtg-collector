import { Image } from 'expo-image';
import { router, Stack, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { Alert, FlatList, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Stepper } from '../../components/Stepper';
import { colors, readable } from '../../components/theme';
import { deleteSource, getSource, listSales, listSourceCards, removeFromSource, updateSource, type SourceCardRow, type SourcePatch } from '../../lib/db';
import { cachedPrice } from '../../lib/prices';
import { formatCents } from '../../lib/pricing';
import { useGalleryPrefs } from '../../lib/prefs';
import { langLabel } from '../../lib/language';
import { frontName } from '../../lib/scryfall';
import { setBrowseList } from '../../lib/browse';
import { soldBySource } from '../../lib/sales';
import { formatGain, gainPercent, parseDollars, type Source } from '../../lib/sources';

export default function SourceScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [{ priceSource }] = useGalleryPrefs();
  const insets = useSafeAreaInsets();
  const [source, setSource] = useState<Source | null>(null);
  const [cards, setCards] = useState<SourceCardRow[]>([]);
  const [name, setName] = useState('');
  const [paid, setPaid] = useState('');
  const [sold, setSold] = useState({ cards: 0, soldCents: 0 });
  const [editing, setEditing] = useState<Set<number> | null>(null);

  const load = useCallback(async () => {
    const s = await getSource(Number(id));
    setSource(s);
    if (s) {
      setName(s.name);
      setPaid(s.cost_cents == null ? '' : (s.cost_cents / 100).toFixed(2));
    }
    setCards(await listSourceCards(Number(id)));
    setSold(soldBySource(await listSales()).get(Number(id)) ?? { cards: 0, soldCents: 0 });
  }, [id]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  const priced = useMemo(
    () =>
      cards
        .map((c) => ({ ...c, unit: cachedPrice(c, priceSource) }))
        .sort((a, b) => (b.unit ?? -1) * b.copies - (a.unit ?? -1) * a.copies),
    [cards, priceSource],
  );
  const value = priced.reduce((n, c) => n + (c.unit ?? 0) * c.copies, 0);
  const copies = priced.reduce((n, c) => n + c.copies, 0);

  if (!source) return <View style={styles.container} />;

  const gain = source.cost_cents == null ? null : value + sold.soldCents - source.cost_cents;
  const isBox = source.kind === 'box';
  const noun = source.kind === 'precon' ? 'precon' : isBox ? 'box' : 'pack';

  const change = async (patch: SourcePatch) => {
    setSource({ ...source, ...patch } as Source);
    await updateSource(source.id, patch);
  };

  const savePaid = () => {
    const cents = parseDollars(paid);
    if (paid.trim() !== '' && cents == null) {
      Alert.alert('Price not understood', 'Type an amount like 35 or 4.99.');
      return;
    }
    if (cents !== source.cost_cents) change({ cost_cents: cents });
  };

  const forget = () =>
    Alert.alert(
      `Forget this ${noun}?`,
      'The record of what you paid is removed. The cards stay in your collection, as already owned.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Forget',
          style: 'destructive',
          onPress: async () => {
            await deleteSource(source.id);
            router.back();
          },
        },
      ],
    );

  const header = (
    <View style={{ gap: 12, paddingBottom: 12 }}>
      <View style={styles.summary}>
        <View style={styles.stat}>
          <Text style={styles.statLabel}>Paid</Text>
          <Text numberOfLines={1} adjustsFontSizeToFit style={styles.statValue}>{formatCents(source.cost_cents)}</Text>
        </View>
        <View style={styles.stat}>
          <Text style={styles.statLabel}>Worth now</Text>
          <Text numberOfLines={1} adjustsFontSizeToFit style={[styles.statValue, { color: colors.price }]}>{formatCents(value)}</Text>
          {sold.cards > 0 && (
            <Text style={styles.statFoot}>
              +{formatCents(sold.soldCents)} for {sold.cards} sold
            </Text>
          )}
        </View>
        <View style={styles.stat}>
          <Text style={styles.statLabel}>Gain</Text>
          <Text numberOfLines={1} adjustsFontSizeToFit style={[styles.statValue, { color: gain == null ? colors.textMuted : gain >= 0 ? colors.price : colors.danger }]}>
            {formatGain(gain)}
          </Text>
          <Text style={styles.statFoot}>{gainPercent(gain, source.cost_cents)}</Text>
        </View>
      </View>

      <View style={styles.form}>
        <View style={styles.field}>
          <Text style={styles.label}>Name</Text>
          <TextInput
            value={name}
            onChangeText={setName}
            onEndEditing={() => name.trim() && name.trim() !== source.name && change({ name: name.trim() })}
            style={styles.input}
            placeholderTextColor={colors.textMuted}
          />
        </View>
        <View style={styles.field}>
          <Text style={styles.label}>What you paid</Text>
          <TextInput
            value={paid}
            onChangeText={setPaid}
            onEndEditing={savePaid}
            keyboardType="decimal-pad"
            placeholder="Not entered"
            placeholderTextColor={colors.textMuted}
            style={styles.input}
          />
        </View>
        {isBox && (
          <>
            <View style={styles.inline}>
              <Text style={styles.label}>Packs in the box</Text>
              <Stepper value={source.packs} onChange={(packs) => change({ packs })} min={1} max={99} />
            </View>
            <View style={styles.inline}>
              <Text style={styles.label}>Packs opened</Text>
              <Stepper value={source.packs_opened} onChange={(packs_opened) => change({ packs_opened })} min={0} max={source.packs} />
            </View>
            <Pressable style={styles.inline} onPress={() => change({ finished: source.finished ? 0 : 1 })}>
              <Text style={styles.label}>Finished opening</Text>
              <Text style={[styles.toggle, source.finished ? styles.toggleOn : null]}>{source.finished ? 'Yes' : 'No'}</Text>
            </Pressable>
          </>
        )}
        {source.kind === 'pack' && (
          <View style={styles.inline}>
            <Text style={styles.label}>Packs</Text>
            <Stepper value={source.packs} onChange={(packs) => change({ packs, packs_opened: packs })} min={1} max={99} />
          </View>
        )}
      </View>

      <View style={styles.sectionRow}>
        <Text style={[styles.section, { flex: 1 }]}>
          {copies} CARD{copies === 1 ? '' : 'S'}
        </Text>
        {editing ? (
          <Pressable hitSlop={8} onPress={() => setEditing(null)}>
            <Text style={styles.link}>Done</Text>
          </Pressable>
        ) : (
          <>
            <Pressable hitSlop={8} onPress={() => router.push({ pathname: '/history', params: { into: String(source.id) } })}>
              <Text style={styles.link}>Add cards</Text>
            </Pressable>
            {priced.length > 0 && (
              <Pressable hitSlop={8} onPress={() => setEditing(new Set())}>
                <Text style={styles.link}>Edit</Text>
              </Pressable>
            )}
          </>
        )}
      </View>
    </View>
  );

  const toggle = (id: number) =>
    setEditing((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const removeSelected = () => {
    const ids = [...(editing ?? [])];
    const n = priced.filter((c) => ids.includes(c.id)).reduce((k, c) => k + c.copies, 0);
    Alert.alert(`Remove ${n} card${n === 1 ? '' : 's'} from this ${noun}?`, 'They stay in your collection and show as not in a pack in History.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: async () => {
          await removeFromSource(source.id, ids);
          setEditing(null);
          await load();
        },
      },
    ]);
  };

  return (
    <View style={styles.container}>
      <Stack.Screen options={{ title: source.name }} />
      <FlatList
        data={priced}
        keyExtractor={(c) => String(c.id)}
        ListHeaderComponent={header}
        contentContainerStyle={[{ padding: 12, paddingBottom: insets.bottom + 40 }, readable]}
        keyboardShouldPersistTaps="handled"
        ItemSeparatorComponent={() => <View style={{ height: 8 }} />}
        renderItem={({ item }) => (
          <Pressable
            style={[styles.row, editing?.has(item.id) && styles.rowOn]}
            onPress={() => {
              if (editing) return toggle(item.id);
              setBrowseList(priced.map((c) => c.id));
              router.push({ pathname: '/card/[id]', params: { id: String(item.id) } });
            }}
          >
            {item.image_uri ? (
              <Image source={{ uri: item.image_uri }} style={styles.thumb} contentFit="contain" />
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
                {langLabel(item.lang) ? ` · ${langLabel(item.lang)}` : ''}
                {item.copies > 1 ? ` · ×${item.copies}` : ''}
              </Text>
            </View>
            <Text style={styles.price}>{formatCents(item.unit == null ? null : item.unit * item.copies)}</Text>
            {editing && (
              <View style={[styles.check, editing.has(item.id) && styles.checkOn]}>
                {editing.has(item.id) && <Text style={styles.checkMark}>✓</Text>}
              </View>
            )}
          </Pressable>
        )}
        ListEmptyComponent={<Text style={styles.empty}>No cards from this {noun} in your collection.</Text>}
        ListFooterComponent={
          editing ? undefined : (
            <Pressable onPress={forget} style={{ alignSelf: 'center', padding: 16, marginTop: 8 }}>
              <Text style={{ color: colors.danger, fontWeight: '600' }}>Forget this {noun}</Text>
            </Pressable>
          )
        }
      />
      {editing && editing.size > 0 && (
        <View style={[styles.footer, { paddingBottom: insets.bottom + 12 }]}>
          <Pressable style={styles.removeButton} onPress={removeSelected}>
            <Text style={styles.removeText}>Remove {editing.size} from this {noun}</Text>
          </Pressable>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  summary: { flexDirection: 'row', gap: 10 },
  stat: { flex: 1, backgroundColor: colors.surface, borderRadius: 12, borderWidth: 1, borderColor: colors.border, padding: 12, gap: 2 },
  statLabel: { color: colors.textMuted, fontSize: 12, fontWeight: '600' },
  statValue: { color: colors.text, fontSize: 18, fontWeight: '800' },
  statFoot: { color: colors.textMuted, fontSize: 12 },
  form: { backgroundColor: colors.surface, borderRadius: 14, borderWidth: 1, borderColor: colors.border, padding: 12, gap: 12 },
  field: { gap: 6 },
  inline: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  label: { color: colors.textMuted, fontWeight: '600' },
  input: {
    backgroundColor: colors.bg,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    color: colors.text,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 16,
  },
  toggle: { color: colors.textMuted, fontWeight: '700', paddingHorizontal: 14, paddingVertical: 8, borderRadius: 10, borderWidth: 1, borderColor: colors.border },
  toggleOn: { color: '#fff', backgroundColor: colors.accent, borderColor: colors.accent },
  section: { color: colors.textMuted, fontWeight: '700', fontSize: 12, letterSpacing: 0.5 },
  sectionRow: { flexDirection: 'row', alignItems: 'center', gap: 18, marginTop: 8 },
  link: { color: colors.accent, fontWeight: '600' },
  rowOn: { borderWidth: 1, borderColor: colors.accent },
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
  removeButton: { paddingVertical: 14, borderRadius: 12, alignItems: 'center', backgroundColor: colors.danger },
  removeText: { color: '#fff', fontWeight: '700' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: colors.surface, borderRadius: 12, padding: 10 },
  thumb: { width: 44, height: 62, borderRadius: 4, backgroundColor: colors.surfaceHigh },
  name: { color: colors.text, fontWeight: '700' },
  sub: { color: colors.textMuted, fontSize: 12 },
  price: { color: colors.price, fontWeight: '700' },
  empty: { color: colors.textMuted, textAlign: 'center', marginTop: 24 },
});
