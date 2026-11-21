import { router } from 'expo-router';
import { useEffect, useRef, useState, type ComponentRef } from 'react';
import { ActivityIndicator, Alert, FlatList, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { PrintingPicker } from '../components/PrintingPicker';
import { colors, readable } from '../components/theme';
import { autocompleteNames, cardByExactName, type ScryfallCard } from '../lib/scryfall';
import { enqueueCard, useStack } from '../lib/stack';

export default function AddScreen() {
  const stack = useStack();
  const [query, setQuery] = useState('');
  const [names, setNames] = useState<string[]>([]);
  const [loading, setLoading] = useState<string | null>(null);
  const [card, setCard] = useState<ScryfallCard | null>(null);
  const [added, setAdded] = useState<string | null>(null);
  const input = useRef<ComponentRef<typeof TextInput>>(null);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) return;
    let live = true;
    const t = setTimeout(() => {
      autocompleteNames(q)
        .then((n) => live && setNames(n))
        .catch(() => {});
    }, 250);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [query]);

  const open = async (name: string) => {
    setLoading(name);
    try {
      const c = await cardByExactName(name);
      if (c) setCard(c);
      else Alert.alert('Not found', name);
    } catch (e) {
      Alert.alert('Search failed', e instanceof Error ? e.message : String(e));
    }
    setLoading(null);
  };

  const add = (c: ScryfallCard) => {
    enqueueCard(c);
    setCard(null);
    setAdded(`${c.name} · ${c.set.toUpperCase()} #${c.collector_number}`);
    setQuery('');
    setNames([]);
    setTimeout(() => input.current?.focus(), 300);
  };

  return (
    <View style={styles.container}>
      <View style={[styles.top, readable]}>
        <View style={styles.searchRow}>
          <TextInput
            ref={input}
            value={query}
            onChangeText={setQuery}
            autoFocus
            autoCorrect={false}
            placeholder="Card name"
            placeholderTextColor={colors.textMuted}
            style={styles.input}
            returnKeyType="search"
            onSubmitEditing={() => query.trim().length >= 2 && names[0] && open(names[0])}
          />
          {stack.length > 0 && (
            <Pressable style={styles.review} onPress={() => router.replace('/stack')}>
              <Text style={styles.buttonText}>Review {stack.length}</Text>
            </Pressable>
          )}
        </View>
        {added && <Text style={styles.added}>Added {added}</Text>}
      </View>
      <FlatList
        data={query.trim().length < 2 ? [] : names}
        keyExtractor={(n) => n}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={[{ paddingHorizontal: 12, paddingBottom: 120 }, readable]}
        renderItem={({ item }) => (
          <Pressable style={styles.row} onPress={() => open(item)} disabled={loading != null}>
            <Text style={styles.name}>{item}</Text>
            {loading === item ? <ActivityIndicator color={colors.text} /> : <Text style={styles.chevron}>›</Text>}
          </Pressable>
        )}
      />
      <PrintingPicker visible={card != null} card={card} onSelect={add} onClose={() => setCard(null)} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  top: { padding: 12, gap: 8 },
  searchRow: { flexDirection: 'row', gap: 8 },
  review: { backgroundColor: colors.accent, paddingHorizontal: 16, borderRadius: 10, justifyContent: 'center' },
  input: {
    flex: 1,
    backgroundColor: colors.surface,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    color: colors.text,
    paddingHorizontal: 12,
    paddingVertical: 12,
    fontSize: 16,
  },
  added: { color: colors.price, fontWeight: '600' },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 14,
    paddingHorizontal: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  name: { color: colors.text, fontSize: 16, flex: 1 },
  chevron: { color: colors.textMuted, fontSize: 20 },
  buttonText: { color: '#fff', fontWeight: '700' },
});
