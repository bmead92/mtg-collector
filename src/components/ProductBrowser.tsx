import { Image } from 'expo-image';
import { useEffect, useMemo, useState, type MutableRefObject } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { formatCents } from '../lib/pricing';
import { productPrice, type MatchInput, type SealedProduct, type Suggestion } from '../lib/sealed';
import { getSealedCatalog } from '../lib/sealedCatalog';
import { getSets } from '../lib/setCatalog';
import { buildSetList, productsFor, searchSets, withCardSetsFirst, type SetEntry } from '../lib/setList';
import { colors } from './theme';

interface Props {
  setCodes: string[];
  want?: MatchInput['want'];
  onPick: (s: Suggestion) => void;
  backRef?: MutableRefObject<(() => boolean) | null>;
}

type Row = { kind: 'header'; title: string } | { kind: 'set'; set: SetEntry };

export function ProductBrowser({ setCodes, want = 'any', onPick, backRef }: Props) {
  const [data, setData] = useState<{ sets: SetEntry[]; catalog: SealedProduct[] } | null>(null);
  const [query, setQuery] = useState('');
  const [set, setSet] = useState<SetEntry | null>(null);

  useEffect(() => {
    let live = true;
    Promise.all([getSets(), getSealedCatalog().catch(() => [])])
      .then(([sets, catalog]) => {
        if (live) setData({ sets: buildSetList(sets, catalog), catalog });
      })
      .catch(() => {
        if (live) setData({ sets: [], catalog: [] });
      });
    return () => {
      live = false;
    };
  }, []);

  useEffect(() => {
    if (!backRef) return;
    backRef.current = () => {
      if (!set) return false;
      setSet(null);
      return true;
    };
    return () => {
      backRef.current = null;
    };
  }, [backRef, set]);

  const rows = useMemo<Row[]>(() => {
    if (!data) return [];
    if (query.trim()) return searchSets(data.sets, query).map((s) => ({ kind: 'set', set: s }));
    const { fromCards, rest } = withCardSetsFirst(data.sets, setCodes);
    if (fromCards.length === 0) return rest.map((s) => ({ kind: 'set', set: s }));
    return [
      { kind: 'header', title: 'From your cards' },
      ...fromCards.map((s): Row => ({ kind: 'set', set: s })),
      { kind: 'header', title: 'All sets' },
      ...rest.map((s): Row => ({ kind: 'set', set: s })),
    ];
  }, [data, query, setCodes]);

  if (!data) return <ActivityIndicator color={colors.text} style={{ marginTop: 32 }} />;

  if (data.sets.length === 0)
    return <Text style={styles.empty}>{"Couldn't load the set list. Check your connection."}</Text>;

  if (set) {
    const products = productsFor(set, data.catalog, want);
    return (
      <View style={{ flex: 1, gap: 12 }}>
        <Pressable onPress={() => setSet(null)} hitSlop={8} style={styles.back}>
          <Text style={styles.backText}>‹ Sets</Text>
        </Pressable>
        <View style={styles.setTitle}>
          <SetIcon set={set} size={28} />
          <Text style={styles.title} numberOfLines={2}>
            {set.name}
          </Text>
        </View>
        <FlatList
          data={products}
          keyExtractor={(p) => p.product.product_id || p.product.name}
          keyboardShouldPersistTaps="handled"
          ItemSeparatorComponent={() => <View style={{ height: 8 }} />}
          renderItem={({ item }) => (
            <Pressable style={({ pressed }) => [styles.product, pressed && styles.pressed]} onPress={() => onPick(item)}>
              <Text style={styles.productIcon}>{item.type.endsWith('-pack') ? '◇' : '▣'}</Text>
              <Text style={styles.productName} numberOfLines={2}>
                {item.product.name.startsWith(set.name) ? item.product.name.slice(set.name.length).trim() : item.product.name}
              </Text>
              <Text style={styles.price}>{productPrice(item.product) == null ? '' : formatCents(productPrice(item.product))}</Text>
            </Pressable>
          )}
          ListEmptyComponent={<Text style={styles.empty}>Nothing to pick for this set.</Text>}
        />
      </View>
    );
  }

  return (
    <View style={{ flex: 1, gap: 12 }}>
      <TextInput
        value={query}
        onChangeText={setQuery}
        placeholder="Search sets"
        placeholderTextColor={colors.textMuted}
        style={styles.input}
        autoCorrect={false}
        returnKeyType="search"
      />
      <FlatList
        data={rows}
        keyExtractor={(r) => (r.kind === 'header' ? `h:${r.title}` : r.set.code)}
        keyboardShouldPersistTaps="handled"
        initialNumToRender={20}
        renderItem={({ item }) =>
          item.kind === 'header' ? (
            <Text style={styles.section}>{item.title.toUpperCase()}</Text>
          ) : (
            <Pressable style={({ pressed }) => [styles.setRow, pressed && styles.pressed]} onPress={() => setSet(item.set)}>
              <SetIcon set={item.set} size={22} />
              <View style={{ flex: 1 }}>
                <Text style={styles.setName} numberOfLines={1}>
                  {item.set.name}
                </Text>
                <Text style={styles.setSub}>
                  {item.set.code}
                  {item.set.released ? ` · ${item.set.released.slice(0, 4)}` : ''}
                </Text>
              </View>
              <Text style={styles.chevron}>›</Text>
            </Pressable>
          )
        }
        ListEmptyComponent={<Text style={styles.empty}>No set matches.</Text>}
      />
    </View>
  );
}

function SetIcon({ set, size }: { set: SetEntry; size: number }) {
  if (!set.icon) return <View style={{ width: size, height: size }} />;
  return <Image source={{ uri: set.icon }} style={{ width: size, height: size }} contentFit="contain" tintColor={colors.text} />;
}

const styles = StyleSheet.create({
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
  section: { color: colors.textMuted, fontWeight: '700', fontSize: 12, letterSpacing: 0.5, marginTop: 12, marginBottom: 4 },
  setRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10, paddingHorizontal: 4, borderRadius: 8 },
  pressed: { backgroundColor: colors.surfaceHigh },
  setName: { color: colors.text, fontWeight: '600', fontSize: 15 },
  setSub: { color: colors.textMuted, fontSize: 12 },
  chevron: { color: colors.textMuted, fontSize: 22 },
  back: { alignSelf: 'flex-start' },
  backText: { color: colors.accent, fontWeight: '600', fontSize: 15 },
  setTitle: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  title: { flex: 1, color: colors.text, fontSize: 18, fontWeight: '700' },
  product: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.bg,
  },
  productIcon: { color: colors.accent, fontSize: 16, fontWeight: '700' },
  productName: { flex: 1, color: colors.text, fontWeight: '600', fontSize: 15 },
  price: { color: colors.price, fontWeight: '700' },
  empty: { color: colors.textMuted, textAlign: 'center', marginTop: 24 },
});
