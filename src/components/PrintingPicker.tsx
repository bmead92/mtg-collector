import { Image } from 'expo-image';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, Modal, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { getSinglesByScryfallId, headlinePrice, quoteFor, type ManaPoolSingle } from '../lib/manapool';
import { formatCents } from '../lib/pricing';
import { printingTags, searchPrintings } from '../lib/printings';
import { allPrintings, cardImage, type ScryfallCard } from '../lib/scryfall';
import { getSets } from '../lib/setCatalog';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors } from './theme';

interface Props {
  visible: boolean;
  card: ScryfallCard | null;
  onSelect: (card: ScryfallCard) => void;
  onClose: () => void;
}

export function PrintingPicker({ visible, card, onSelect, onClose }: Props) {
  const [prints, setPrints] = useState<ScryfallCard[] | null>(null);
  const [singles, setSingles] = useState<Map<string, ManaPoolSingle>>(new Map());
  const [loadedFor, setLoadedFor] = useState<string | null>(null);
  const fetched = useRef<string | null>(null);
  const [query, setQuery] = useState('');
  const insets = useSafeAreaInsets();
  const [icons, setIcons] = useState<Map<string, string>>(new Map());

  useEffect(() => {
    if (!visible || icons.size > 0) return;
    getSets()
      .then((sets) => setIcons(new Map(sets.flatMap((s) => (s.icon ? [[s.code, s.icon] as const] : [])))))
      .catch(() => {});
  }, [visible, icons.size]);

  const close = () => {
    setQuery('');
    onClose();
  };
  const select = (c: ScryfallCard) => {
    setQuery('');
    onSelect(c);
  };

  const shown = useMemo(() => searchPrintings(prints ?? [], query), [prints, query]);

  useEffect(() => {
    if (!visible || !card || fetched.current === card.prints_search_uri) return;
    const uri = card.prints_search_uri;
    fetched.current = uri;
    let cancelled = false;
    let done = false;
    (async () => {
      try {
        const all = await allPrintings(card);
        if (cancelled) return;
        setPrints(all);
        setLoadedFor(uri);
        const m = await getSinglesByScryfallId(all.map((p) => p.id));
        if (!cancelled) setSingles(m);
        done = true;
      } catch (e) {
        if (!cancelled) Alert.alert('Could not load printings', String(e));
      }
    })();
    return () => {
      cancelled = true;
      if (!done) fetched.current = null; // closed before it finished: load again next time
    };
  }, [visible, card]);

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={close}>
      <View style={[styles.container, { paddingTop: insets.top + 12 }]}>
        <View style={styles.header}>
          <Text style={styles.title}>Pick printing</Text>
          <Pressable onPress={close} hitSlop={12}>
            <Text style={styles.link}>Done</Text>
          </Pressable>
        </View>
        {!prints || loadedFor !== card?.prints_search_uri ? (
          <ActivityIndicator color={colors.text} style={{ marginTop: 40 }} />
        ) : (
          <FlatList
            data={shown}
            extraData={[singles, icons]} // prices and set symbols arrive after the printings
            keyExtractor={(p) => p.id}
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={{ padding: 12, gap: 8 }}
            ListHeaderComponent={
              prints.length > 6 ? (
                <TextInput
                  value={query}
                  onChangeText={setQuery}
                  placeholder={`Search ${prints.length} printings`}
                  placeholderTextColor={colors.textMuted}
                  style={styles.input}
                  autoCorrect={false}
                  returnKeyType="search"
                />
              ) : undefined
            }
            ListEmptyComponent={<Text style={styles.empty}>No printing matches.</Text>}
            renderItem={({ item }) => {
              const s = singles.get(item.id);
              const finish = item.finishes.includes('nonfoil') ? 'nonfoil' : item.finishes[0];
              const nm = s ? headlinePrice(quoteFor(s, finish, 'NM')) : null;
              const tags = printingTags(item);
              const icon = icons.get(item.set.toUpperCase());
              return (
                <Pressable
                  style={[styles.item, item.id === card?.id && { borderColor: colors.accent }]}
                  onPress={() => select(item)}
                >
                  <Image source={{ uri: cardImage(item, 'small') ?? undefined }} style={styles.thumb} />
                  <View style={{ flex: 1, gap: 2 }}>
                    <View style={styles.setLine}>
                      {icon && <Image source={{ uri: icon }} style={styles.icon} contentFit="contain" tintColor={colors.text} />}
                      <Text style={styles.setName} numberOfLines={1}>
                        {item.set_name}
                      </Text>
                    </View>
                    <Text style={styles.muted}>
                      {item.set.toUpperCase()} #{item.collector_number} · {item.released_at.slice(0, 4)} ·{' '}
                      {item.finishes.join('/')}
                    </Text>
                    {tags.length > 0 && (
                      <Text style={styles.tags} numberOfLines={1}>
                        {tags.join(' · ')}
                      </Text>
                    )}
                  </View>
                  <Text style={styles.price}>{formatCents(nm)}</Text>
                </Pressable>
              );
            }}
          />
        )}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 16 },
  title: { color: colors.text, fontSize: 20, fontWeight: '700' },
  link: { color: colors.accent, fontWeight: '600' },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: colors.surface,
    borderRadius: 10,
    padding: 8,
    borderWidth: 1,
    borderColor: colors.border,
  },
  thumb: { width: 48, height: 67, borderRadius: 4, backgroundColor: colors.surfaceHigh },
  setLine: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  icon: { width: 16, height: 16 },
  setName: { flexShrink: 1, color: colors.text },
  tags: { color: colors.accent, fontSize: 12 },
  input: {
    backgroundColor: colors.surface,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    color: colors.text,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 16,
    marginBottom: 4,
  },
  empty: { color: colors.textMuted, textAlign: 'center', marginTop: 24 },
  muted: { color: colors.textMuted },
  price: { color: colors.price, fontWeight: '700' },
});
