import { Image } from 'expo-image';
import { router, Stack } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Segmented } from '../components/Segmented';
import { colors, readable } from '../components/theme';
import { getPreconList, importTotals, loadPrecon, resolveDeckLines, saveImport, type ImportItem } from '../lib/deckImport';
import { parseDeckText, type DeckLine } from '../lib/deckText';
import { preconProduct, searchPrecons, type PreconEntry } from '../lib/precons';
import { formatCents } from '../lib/pricing';
import { cardImage, frontName } from '../lib/scryfall';
import { getSealedCatalog } from '../lib/sealedCatalog';
import { parseDollars } from '../lib/sources';

type Preview = {
  title: string;
  items: ImportItem[];
  missing: string[];
  precon: { entry: PreconEntry; productId: string | null } | null;
};

const lineText = (l: DeckLine) => `${l.quantity} ${l.name}${l.set ? ` (${l.set.toUpperCase()})${l.number ? ` ${l.number}` : ''}` : ''}`;

export default function ImportScreen() {
  const insets = useSafeAreaInsets();
  const [mode, setMode] = useState<'precon' | 'list'>('precon');
  const [precons, setPrecons] = useState<PreconEntry[] | null>(null);
  const [query, setQuery] = useState('');
  const [text, setText] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [paid, setPaid] = useState('');

  useEffect(() => {
    getPreconList()
      .then(setPrecons)
      .catch((e) => {
        setPrecons([]);
        Alert.alert('Could not load precons', String(e));
      });
  }, []);

  const shown = useMemo(() => searchPrecons(precons ?? [], query).slice(0, 200), [precons, query]);

  const openPrecon = async (entry: PreconEntry) => {
    setBusy(`Loading ${entry.name}…`);
    try {
      const [items, catalog] = await Promise.all([loadPrecon(entry), getSealedCatalog().catch(() => [])]);
      const product = preconProduct(catalog, entry);
      setPaid(product?.low_price != null ? (product.low_price / 100).toFixed(2) : '');
      setPreview({ title: entry.name, items, missing: [], precon: { entry, productId: product?.product_id ?? null } });
    } catch (e) {
      Alert.alert('Could not load that deck', String(e));
    } finally {
      setBusy(null);
    }
  };

  const readList = async () => {
    const { lines, unreadable } = parseDeckText(text);
    if (lines.length === 0) {
      Alert.alert('No cards found', 'Paste a list with one card per line, like "1 Sol Ring (CMR) 472".');
      return;
    }
    setBusy(`Looking up ${lines.length} cards…`);
    try {
      const { items, missing } = await resolveDeckLines(lines);
      setPreview({ title: 'Deck list', items, missing: [...missing.map(lineText), ...unreadable], precon: null });
    } catch (e) {
      Alert.alert('Could not look up cards', String(e));
    } finally {
      setBusy(null);
    }
  };

  const save = async (onlyMissing: boolean) => {
    if (!preview) return;
    const cost = parseDollars(paid);
    if (preview.precon && paid.trim() !== '' && cost == null) {
      Alert.alert('Price not understood', 'Type an amount like 35 or 4.99.');
      return;
    }
    setBusy('Saving…');
    try {
      const p = preview.precon;
      const n = await saveImport(
        preview.items,
        onlyMissing,
        p
          ? {
              kind: 'precon',
              name: p.entry.name,
              cost_cents: cost,
              packs: 1,
              set_code: p.entry.code || null,
              product_id: p.productId,
            }
          : null,
      );
      router.back();
      Alert.alert('Added', `${n} card${n === 1 ? '' : 's'} added to your collection.`);
    } catch (e) {
      Alert.alert('Could not save', String(e));
      setBusy(null);
    }
  };

  if (busy) {
    return (
      <View style={[styles.container, styles.center]}>
        <Stack.Screen options={{ title: 'Import deck' }} />
        <ActivityIndicator color={colors.text} />
        <Text style={[styles.muted, { marginTop: 12 }]}>{busy}</Text>
      </View>
    );
  }

  if (preview) {
    const t = importTotals(preview.items);
    return (
      <View style={styles.container}>
        <Stack.Screen options={{ title: preview.title }} />
        <FlatList
          data={preview.items}
          keyExtractor={(i) => `${i.card.id}|${i.finish}`}
          contentContainerStyle={[{ padding: 16, gap: 8, paddingBottom: 16 }, readable]}
          ListHeaderComponent={
            <View style={{ gap: 10, marginBottom: 6 }}>
              <Text style={styles.big}>{formatCents(t.valueCents)}</Text>
              <Text style={styles.muted}>
                {t.copies} cards{t.owned > 0 ? ` · ${t.owned} already in your collection` : ''}
              </Text>
              {preview.precon && (
                <View style={styles.inline}>
                  <Text style={styles.label}>What you paid</Text>
                  <TextInput
                    value={paid}
                    onChangeText={setPaid}
                    placeholder="$0.00"
                    placeholderTextColor={colors.textMuted}
                    keyboardType="decimal-pad"
                    style={[styles.input, styles.paid]}
                  />
                </View>
              )}
              {preview.missing.length > 0 && (
                <Text style={styles.warn}>
                  Not found ({preview.missing.length}): {preview.missing.slice(0, 8).join(', ')}
                  {preview.missing.length > 8 ? '…' : ''}
                </Text>
              )}
            </View>
          }
          renderItem={({ item }) => (
            <View style={styles.row}>
              <Image source={{ uri: cardImage(item.card, 'small') ?? undefined }} style={styles.thumb} />
              <View style={{ flex: 1, gap: 2 }}>
                <Text style={styles.name} numberOfLines={1}>
                  {item.quantity > 1 ? `${item.quantity}× ` : ''}
                  {frontName(item.card.name)}
                </Text>
                <Text style={styles.muted} numberOfLines={1}>
                  {item.card.set.toUpperCase()} #{item.card.collector_number}
                  {item.finish !== 'nonfoil' ? ` · ${item.finish}` : ''}
                  {item.owned > 0 ? ` · have ${item.owned}` : ''}
                </Text>
              </View>
              <Text style={styles.price}>{formatCents(item.priceCents)}</Text>
            </View>
          )}
        />
        <View style={[styles.buttons, { paddingBottom: insets.bottom + 12 }]}>
          <Pressable style={styles.secondary} onPress={() => setPreview(null)}>
            <Text style={styles.secondaryText}>Back</Text>
          </Pressable>
          {t.owned > 0 && t.owned < t.copies && (
            <Pressable style={styles.secondary} onPress={() => save(true)}>
              <Text style={styles.secondaryText}>Add {t.copies - t.owned} missing</Text>
            </Pressable>
          )}
          <Pressable style={[styles.primary, t.copies === 0 && { opacity: 0.5 }]} disabled={t.copies === 0} onPress={() => save(false)}>
            <Text style={styles.primaryText}>Add all {t.copies}</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Stack.Screen options={{ title: 'Import deck' }} />
      <View style={{ padding: 16, paddingBottom: 8 }}>
        <Segmented options={['precon', 'list'] as const} value={mode} onChange={setMode} labels={{ precon: 'Precon', list: 'Paste a list' }} />
      </View>
      {mode === 'precon' ? (
        <FlatList
          data={shown}
          keyExtractor={(p) => p.fileName}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={[{ paddingHorizontal: 16, paddingBottom: insets.bottom + 24, gap: 6 }, readable]}
          ListHeaderComponent={
            <TextInput
              value={query}
              onChangeText={setQuery}
              placeholder="Search precons"
              placeholderTextColor={colors.textMuted}
              style={[styles.input, { marginBottom: 6 }]}
              autoCorrect={false}
            />
          }
          ListEmptyComponent={
            precons == null ? <ActivityIndicator color={colors.text} style={{ marginTop: 24 }} /> : <Text style={styles.muted}>No match.</Text>
          }
          renderItem={({ item }) => (
            <Pressable style={({ pressed }) => [styles.row, pressed && styles.pressed]} onPress={() => openPrecon(item)}>
              <View style={{ flex: 1, gap: 2 }}>
                <Text style={styles.name} numberOfLines={1}>
                  {item.name}
                </Text>
                <Text style={styles.muted} numberOfLines={1}>
                  {item.code} · {item.releaseDate.slice(0, 4)} · {item.type}
                </Text>
              </View>
              <Text style={styles.chevron}>›</Text>
            </Pressable>
          )}
        />
      ) : (
        <View style={{ flex: 1, padding: 16, paddingTop: 8, gap: 10, paddingBottom: insets.bottom + 12 }}>
          <Text style={styles.muted}>On Moxfield or Archidekt, export the deck as text, copy it, and paste it here.</Text>
          <TextInput
            value={text}
            onChangeText={setText}
            multiline
            placeholder={'1 Sol Ring (CMR) 472\n1 Arcane Signet\n…'}
            placeholderTextColor={colors.textMuted}
            style={[styles.input, styles.paste]}
            autoCorrect={false}
            autoCapitalize="none"
            textAlignVertical="top"
          />
          <Pressable style={[styles.primary, { flex: 0 }, !text.trim() && { opacity: 0.5 }]} disabled={!text.trim()} onPress={readList}>
            <Text style={styles.primaryText}>Read list</Text>
          </Pressable>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  center: { alignItems: 'center', justifyContent: 'center' },
  muted: { color: colors.textMuted },
  big: { color: colors.price, fontSize: 30, fontWeight: '800' },
  warn: { color: colors.danger, fontSize: 13 },
  label: { color: colors.textMuted, fontWeight: '600' },
  inline: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  input: {
    backgroundColor: colors.surface,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    color: colors.text,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 16,
  },
  paid: { minWidth: 120, textAlign: 'right' },
  paste: { flex: 1, fontFamily: 'monospace', fontSize: 14 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: colors.surface,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 10,
  },
  pressed: { backgroundColor: colors.surfaceHigh },
  thumb: { width: 36, height: 50, borderRadius: 3, backgroundColor: colors.surfaceHigh },
  name: { color: colors.text, fontWeight: '600' },
  price: { color: colors.price, fontWeight: '700' },
  chevron: { color: colors.textMuted, fontSize: 20 },
  buttons: {
    flexDirection: 'row',
    gap: 8,
    paddingHorizontal: 16,
    paddingTop: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  secondary: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
  },
  secondaryText: { color: colors.text, fontWeight: '600' },
  primary: { flex: 1.4, paddingVertical: 14, borderRadius: 12, backgroundColor: colors.accent, alignItems: 'center' },
  primaryText: { color: '#fff', fontWeight: '700' },
});
