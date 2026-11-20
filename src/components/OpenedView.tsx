import { router, useFocusEffect } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, Text, View, Pressable } from 'react-native';
import { listSales, listSourceCards, listSources } from '../lib/db';
import { soldBySource } from '../lib/sales';
import { cachedPrice, type HeadlineSource } from '../lib/prices';
import { cardCount, formatCents } from '../lib/pricing';
import {
  boxProgress,
  formatGain,
  gainPercent,
  groupOpened,
  summarizeSources,
  totals,
  type SourceSummary,
} from '../lib/sources';
import { colors, readable } from './theme';

interface Props {
  priceSource: HeadlineSource;
  header?: React.ReactNode;
}

const gainColor = (g: number | null) => (g == null ? colors.textMuted : g >= 0 ? colors.price : colors.danger);

export function OpenedView({ priceSource, header }: Props) {
  const [list, setList] = useState<SourceSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [looseOpen, setLooseOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [sources, rows, sales] = await Promise.all([listSources(), listSourceCards(), listSales()]);
      setList(
        summarizeSources(
          sources,
          rows.map((r) => ({ source_id: r.source_id, copies: r.copies, priceCents: cachedPrice(r, priceSource) })),
          soldBySource(sales),
        ),
      );
    } finally {
      setLoading(false);
    }
  }, [priceSource]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  const all = useMemo(() => totals(list), [list]);
  const { loose, looseTotals, boxes, precons } = useMemo(() => groupOpened(list), [list]);
  const open = (id: number) => router.push({ pathname: '/source/[id]', params: { id: String(id) } });

  const entry = (s: SourceSummary, sub?: string, divider = false) => (
    <Pressable
      key={s.source.id}
      style={({ pressed }) => [styles.row, divider && styles.divider, pressed && styles.pressed]}
      onPress={() => open(s.source.id)}
    >
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={styles.name} numberOfLines={1}>
          {s.source.name}
        </Text>
        <Text style={styles.sub} numberOfLines={1}>
          {sub ?? ''}
          {s.cards} card{s.cards === 1 ? '' : 's'}
          {s.soldCards > 0 ? ` · ${s.soldCards} sold` : ''} · {new Date(s.source.created_at).toLocaleDateString()}
        </Text>
      </View>
      <View style={{ alignItems: 'flex-end', gap: 2 }}>
        <Text style={styles.value}>{formatCents(s.valueCents)}</Text>
        <Text style={[styles.gain, { color: gainColor(s.gainCents) }]}>
          {s.source.cost_cents == null ? 'no price' : `${formatGain(s.gainCents)} on ${formatCents(s.source.cost_cents)}`}
        </Text>
      </View>
      <Text style={styles.chevron}>›</Text>
    </Pressable>
  );

  return (
    <ScrollView
      contentContainerStyle={[{ paddingBottom: 120 }, readable]}
      refreshControl={<RefreshControl refreshing={loading} onRefresh={load} tintColor={colors.text} />}
    >
      {header}
      <View style={styles.summary}>
        <View style={styles.stat}>
          <Text style={styles.statLabel}>Spent</Text>
          <Text numberOfLines={1} adjustsFontSizeToFit style={styles.statValue}>{formatCents(all.spentCents)}</Text>
        </View>
        <View style={styles.stat}>
          <Text style={styles.statLabel}>Worth now</Text>
          <Text numberOfLines={1} adjustsFontSizeToFit style={[styles.statValue, { color: colors.price }]}>{formatCents(all.valueCents)}</Text>
          {all.soldCents > 0 && <Text style={styles.statFoot}>+{formatCents(all.soldCents)} sold</Text>}
        </View>
        <View style={styles.stat}>
          <Text style={styles.statLabel}>Gain</Text>
          <Text numberOfLines={1} adjustsFontSizeToFit style={[styles.statValue, { color: gainColor(all.gainCents) }]}>
            {formatGain(all.gainCents)}
          </Text>
          <Text style={styles.statFoot}>{gainPercent(all.gainCents, all.spentCents)}</Text>
        </View>
      </View>
      <Text style={styles.note}>
        {all.packs} pack{all.packs === 1 ? '' : 's'} opened · {cardCount(all.cards)}
        {priceSource === 'tcgplayer' ? ' · TCGplayer prices' : ''}
      </Text>

      {loose.length > 0 && (
        <>
          <Text style={styles.section}>LOOSE PACKS</Text>
          <View style={styles.card}>
            <Pressable
              style={({ pressed }) => [styles.row, pressed && styles.pressed]}
              onPress={() => setLooseOpen((v) => !v)}
            >
              <View style={{ flex: 1, gap: 2 }}>
                <Text style={styles.name}>
                  {looseTotals.packs} pack{looseTotals.packs === 1 ? '' : 's'}
                </Text>
                <Text style={styles.sub}>
                  {formatCents(looseTotals.spentCents)} spent · {cardCount(looseTotals.cards)}
                </Text>
              </View>
              <View style={{ alignItems: 'flex-end', gap: 2 }}>
                <Text style={styles.value}>{formatCents(looseTotals.valueCents)}</Text>
                <Text style={[styles.gain, { color: gainColor(looseTotals.gainCents) }]}>
                  {formatGain(looseTotals.gainCents)}
                </Text>
              </View>
              <Text style={styles.chevron}>{looseOpen ? '⌄' : '›'}</Text>
            </Pressable>
            {looseOpen &&
              loose.map((s) => (
                <View key={s.source.id} style={styles.nested}>
                  {entry(s, s.source.packs > 1 ? `${s.source.packs} packs · ` : '')}
                </View>
              ))}
          </View>
        </>
      )}

      {boxes.length > 0 && (
        <>
          <Text style={styles.section}>BOXES & BUNDLES</Text>
          <View style={styles.card}>
            {boxes.map((s, i) => entry(s, `${s.source.finished ? 'Done' : boxProgress(s.source)} · `, i > 0))}
          </View>
        </>
      )}

      {precons.length > 0 && (
        <>
          <Text style={styles.section}>PRECONS</Text>
          <View style={styles.card}>{precons.map((s, i) => entry(s, undefined, i > 0))}</View>
        </>
      )}

      {list.length === 0 && !loading && (
        <Text style={styles.empty}>
          Nothing opened yet. When you save scanned cards, choose &quot;Opened packs&quot; or &quot;Opened a box&quot;
          to track what you paid against what you pulled.
        </Text>
      )}
    </ScrollView>
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
  note: { color: colors.textMuted, marginHorizontal: 16, marginTop: 8, fontSize: 12 },
  section: { color: colors.textMuted, fontWeight: '700', fontSize: 12, marginHorizontal: 16, marginTop: 20, marginBottom: 8, letterSpacing: 0.5 },
  card: {
    marginHorizontal: 12,
    backgroundColor: colors.surface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 14 },
  pressed: { backgroundColor: colors.surfaceHigh },
  divider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  nested: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border, paddingLeft: 12, backgroundColor: colors.bg },
  name: { color: colors.text, fontWeight: '700', fontSize: 15 },
  sub: { color: colors.textMuted, fontSize: 12 },
  value: { color: colors.price, fontWeight: '700' },
  gain: { fontSize: 12, fontWeight: '600' },
  chevron: { color: colors.textMuted, fontSize: 20, width: 14, textAlign: 'center' },
  empty: { color: colors.textMuted, textAlign: 'center', marginHorizontal: 32, marginTop: 40, lineHeight: 20 },
});
