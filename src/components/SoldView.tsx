import { Image } from 'expo-image';
import { useFocusEffect } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { Alert, FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { listSales, undoSale } from '../lib/db';
import { formatCents } from '../lib/pricing';
import { formatOwned, soldTotals, summarizeSale, type Sale } from '../lib/sales';
import { frontName } from '../lib/scryfall';
import { formatGain, gainPercent } from '../lib/sources';
import { colors, readable } from './theme';

interface Props {
  header?: React.ReactElement;
  onChange: () => void;
}

const gainColor = (g: number | null) => (g == null ? colors.textMuted : g >= 0 ? colors.price : colors.danger);

export function SoldView({ header, onChange }: Props) {
  const [sales, setSales] = useState<Sale[]>([]);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setSales(await listSales());
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  const all = useMemo(() => soldTotals(sales), [sales]);

  const open = (s: Sale) =>
    Alert.alert(
      frontName(s.card.name),
      `Sold ${s.quantity > 1 ? `${s.quantity} for` : 'for'} ${formatCents(s.sold_cents)} on ${new Date(s.sold_at).toLocaleDateString()}`,
      [
        { text: 'Close', style: 'cancel' },
        {
          text: 'Undo sale',
          onPress: async () => {
            await undoSale(s.id);
            await load();
            onChange();
          },
        },
      ],
    );

  const summary = (
    <>
      {header}
      <View style={styles.summary}>
        <View style={styles.stat}>
          <Text style={styles.statLabel}>Sold for</Text>
          <Text numberOfLines={1} adjustsFontSizeToFit style={[styles.statValue, { color: colors.price }]}>{formatCents(all.soldCents)}</Text>
        </View>
        <View style={styles.stat}>
          <Text style={styles.statLabel}>Worth when added</Text>
          <Text numberOfLines={1} adjustsFontSizeToFit style={styles.statValue}>{formatCents(all.addedCents)}</Text>
        </View>
        <View style={styles.stat}>
          <Text style={styles.statLabel}>Gain</Text>
          <Text numberOfLines={1} adjustsFontSizeToFit style={[styles.statValue, { color: gainColor(all.gainCents) }]}>{formatGain(all.gainCents)}</Text>
          <Text style={styles.statFoot}>{gainPercent(all.gainCents, all.addedCents)}</Text>
        </View>
      </View>
      <Text style={styles.note}>
        {all.copies} card{all.copies === 1 ? '' : 's'} sold
      </Text>
    </>
  );

  return (
    <FlatList
      data={sales}
      keyExtractor={(s) => String(s.id)}
      ListHeaderComponent={summary}
      contentContainerStyle={[{ paddingBottom: 120 }, readable]}
      refreshControl={<RefreshControl refreshing={loading} onRefresh={load} tintColor={colors.text} />}
      ListEmptyComponent={loading ? undefined : <Text style={styles.empty}>Nothing sold yet.</Text>}
      renderItem={({ item: s }) => {
        const sum = summarizeSale(s);
        return (
          <Pressable style={({ pressed }) => [styles.row, pressed && styles.pressed]} onPress={() => open(s)}>
            <View style={styles.thumbWrap}>
              <Image source={{ uri: s.card.image_uri ?? undefined }} style={styles.thumb} />
            </View>
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={styles.name} numberOfLines={1}>
                {frontName(s.card.name)}
              </Text>
              <Text style={styles.sub} numberOfLines={1}>
                {s.card.set_code.toUpperCase()} #{s.card.collector_number}
                {s.quantity > 1 ? ` · ×${s.quantity}` : ''} · {new Date(s.sold_at).toLocaleDateString()}
              </Text>
              <Text style={styles.sub} numberOfLines={1}>
                Owned {formatOwned(sum.ownedMs)}
              </Text>
            </View>
            <View style={{ alignItems: 'flex-end', gap: 2 }}>
              <Text style={styles.value}>{formatCents(s.sold_cents)}</Text>
              <Text style={[styles.gain, { color: gainColor(sum.gainCents) }]}>
                {sum.addedCents == null ? '' : `${formatGain(sum.gainCents)} on ${formatCents(sum.addedCents)}`}
              </Text>
            </View>
          </Pressable>
        );
      }}
    />
  );
}

const styles = StyleSheet.create({
  summary: { flexDirection: 'row', marginHorizontal: 16, marginTop: 8, gap: 10 },
  stat: {
    flex: 1,
    backgroundColor: colors.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 12,
    gap: 2,
  },
  statLabel: { color: colors.textMuted, fontSize: 12, fontWeight: '600' },
  statValue: { color: colors.text, fontSize: 18, fontWeight: '800' },
  statFoot: { color: colors.textMuted, fontSize: 12 },
  note: { color: colors.textMuted, marginHorizontal: 16, marginTop: 8, marginBottom: 8, fontSize: 12 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  pressed: { backgroundColor: colors.surfaceHigh },
  thumbWrap: { opacity: 0.45, filter: [{ grayscale: 1 }] },
  thumb: { width: 48, height: 67, borderRadius: 4, backgroundColor: colors.surfaceHigh },
  name: { color: colors.textMuted, fontWeight: '700', fontSize: 15 },
  sub: { color: colors.textMuted, fontSize: 12 },
  value: { color: colors.text, fontWeight: '700' },
  gain: { fontSize: 12, fontWeight: '600' },
  empty: { color: colors.textMuted, textAlign: 'center', marginTop: 40 },
});
