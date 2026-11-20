import { useFocusEffect } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LineChart } from '../components/LineChart';
import { Segmented } from '../components/Segmented';
import { colors, readable } from '../components/theme';
import {
  listAdditions,
  listAdditionsWithCard,
  listSales,
  listSnapshots,
  listSources,
  type Addition,
  type AdditionWithCard,
} from '../lib/db';
import type { Source } from '../lib/sources';
import { formatGain, gainPercent } from '../lib/sources';
import {
  addedSince,
  breakdown,
  dailyLine,
  growthSeries,
  startOfMonth,
  startOfWeek,
  type GrowthAddition,
  type Snapshot,
} from '../lib/growth';
import { cachedPrice } from '../lib/prices';
import { cardCount, formatCents } from '../lib/pricing';
import { useGalleryPrefs } from '../lib/prefs';
import { paidSummary, soldGrowthAdds, soldTotals, type Sale } from '../lib/sales';

export default function GrowthScreen() {
  const [{ priceSource }] = useGalleryPrefs();
  const insets = useSafeAreaInsets();
  const [rows, setRows] = useState<AdditionWithCard[]>([]);
  const [sales, setSales] = useState<Sale[]>([]);
  const [costs, setCosts] = useState<{ sources: Source[]; additions: Addition[] }>({ sources: [], additions: [] });
  const [snaps, setSnaps] = useState<{ day: string; value_cents: number; tcg_cents: number | null; copies: number }[]>([]);
  const [metric, setMetric] = useState<'value' | 'cards'>('value');
  const [selected, setSelected] = useState<number | null>(null);
  const [now, setNow] = useState(0);

  useFocusEffect(
    useCallback(() => {
      Promise.all([listAdditionsWithCard(), listSnapshots(), listSales(), listSources(), listAdditions()])
        .then(([a, s, sold, sources, additions]) => {
          setNow(Date.now());
          setRows(a);
          setSnaps(s);
          setSales(sold);
          setCosts({ sources, additions });
        })
        .catch(() => {});
    }, []),
  );

  const adds: GrowthAddition[] = useMemo(
    () => [
      ...rows.map((r) => ({
        added_at: r.added_at,
        quantity: r.quantity,
        source_id: r.source_id,
        unitCents: cachedPrice(r, priceSource),
      })),
      ...soldGrowthAdds(sales, (c) => cachedPrice(c, priceSource)),
    ],
    [rows, sales, priceSource],
  );
  const sold = useMemo(() => soldTotals(sales), [sales]);
  const paid = useMemo(() => {
    const held = breakdown(adds);
    return paidSummary({
      sources: costs.sources,
      ownedAdditions: costs.additions.filter((a) => a.source_id == null),
      sales,
      worthCents: held.owned.valueCents + held.opened.valueCents,
    });
  }, [costs, sales, adds]);
  const daily = useMemo(() => growthSeries(adds, now, 'day'), [adds, now]);
  const split = useMemo(() => breakdown(adds), [adds]);
  const total = split.owned.valueCents + split.opened.valueCents;
  const copies = split.owned.copies + split.opened.copies;
  const week = useMemo(() => addedSince(adds, startOfWeek(now)), [adds, now]);
  const month = useMemo(() => addedSince(adds, startOfMonth(now)), [adds, now]);
  const snapshots: Snapshot[] = useMemo(
    () =>
      snaps.map((s) => ({
        day: s.day,
        value_cents: priceSource === 'tcgplayer' ? (s.tcg_cents ?? s.value_cents) : s.value_cents,
        copies: s.copies,
      })),
    [snaps, priceSource],
  );
  const line = useMemo(() => dailyLine(adds, snapshots, now), [adds, snapshots, now]);

  if (line.length === 0) {
    return (
      <View style={styles.container}>
        <Text style={styles.empty}>No cards yet. Your collection&apos;s growth shows here once you save some.</Text>
      </View>
    );
  }

  const first = daily[0].start;
  const days = line.length;
  const selIndex = Math.min(selected ?? line.length - 1, line.length - 1);
  const sel = line[selIndex];
  const addedThatDay = daily[selIndex]?.copies ?? 0;
  const soldThatDay = daily[selIndex]?.removedCopies ?? 0;
  const thisYear = new Date().getFullYear();
  const fmtDay = (key: string, style: 'day' | 'axis' = 'day') => {
    const [y, m, d] = key.split('-').map(Number);
    const date = new Date(y, m - 1, d);
    if (style === 'axis' && days > 330) return date.toLocaleDateString(undefined, { month: 'short', year: 'numeric' });
    return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', ...(y !== thisYear && style === 'day' ? { year: 'numeric' } : {}) });
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={[{ padding: 16, gap: 14, paddingBottom: insets.bottom + 40 }, readable]}>
      <View style={styles.hero}>
        <Text style={styles.heroLabel}>
          Collecting since {new Date(first).toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' })}
          {' · '}
          {days} day{days === 1 ? '' : 's'}
        </Text>
        <Text style={styles.heroValue}>{formatCents(total)}</Text>
        <Text style={styles.heroSub}>
          {cardCount(copies)}{priceSource === 'tcgplayer' ? ' · TCGplayer prices' : ''}
        </Text>
      </View>

      <View style={styles.row2}>
        <View style={styles.stat}>
          <Text style={styles.statLabel}>This week</Text>
          <Text numberOfLines={1} adjustsFontSizeToFit style={styles.statValue}>+{cardCount(week.copies)}</Text>
          <Text style={styles.statFoot}>{formatCents(week.valueCents)} now</Text>
        </View>
        <View style={styles.stat}>
          <Text style={styles.statLabel}>This month</Text>
          <Text numberOfLines={1} adjustsFontSizeToFit style={styles.statValue}>+{cardCount(month.copies)}</Text>
          <Text style={styles.statFoot}>{formatCents(month.valueCents)} now</Text>
        </View>
      </View>

      <View style={styles.card}>
        <View style={styles.chartHead}>
          <Text style={styles.cardTitle}>Over time</Text>
          <View style={{ width: 150 }}>
            <Segmented options={['value', 'cards'] as const} value={metric} onChange={setMetric} labels={{ value: 'Value', cards: 'Cards' }} />
          </View>
        </View>
        <Text style={styles.selLine}>
          {fmtDay(sel.day)}: {formatCents(sel.valueCents)} · {cardCount(sel.copies)}
          {addedThatDay > 0 ? ` · +${addedThatDay} added` : ''}
          {soldThatDay > 0 ? ` · ${soldThatDay} sold` : ''}
        </Text>
        <LineChart
          values={line.map((p) => (metric === 'value' ? p.valueCents : p.copies))}
          labels={line.map((p) => fmtDay(p.day, 'axis'))}
          selected={selIndex}
          onSelect={setSelected}
          formatY={(v) => (metric === 'value' ? formatCents(v) : `${v}`)}
          color={metric === 'value' ? colors.price : colors.accent}
        />
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Where your cards came from</Text>
        <View style={styles.splitRow}>
          <Text style={styles.splitLabel}>Already owned</Text>
          <Text style={styles.splitValue}>
            {cardCount(split.owned.copies)} · {formatCents(split.owned.valueCents)}
          </Text>
        </View>
        <View style={styles.splitRow}>
          <Text style={styles.splitLabel}>Packs, boxes & precons</Text>
          <Text style={styles.splitValue}>
            {cardCount(split.opened.copies)} · {formatCents(split.opened.valueCents)}
          </Text>
        </View>
        {sold.copies > 0 && (
          <View style={styles.splitRow}>
            <Text style={styles.splitLabel}>Sold</Text>
            <Text style={styles.splitValue}>
              {cardCount(sold.copies)} · {formatCents(sold.soldCents)}
            </Text>
          </View>
        )}
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Paid</Text>
        <View style={styles.splitRow}>
          <Text style={styles.splitLabel}>Singles</Text>
          <Text style={styles.splitValue}>{formatCents(paid.singlesCents)}</Text>
        </View>
        <View style={styles.splitRow}>
          <Text style={styles.splitLabel}>Packs & boxes</Text>
          <Text style={styles.splitValue}>{formatCents(paid.sealedCents)}</Text>
        </View>
        {paid.preconsCents > 0 && (
          <View style={styles.splitRow}>
            <Text style={styles.splitLabel}>Precons</Text>
            <Text style={styles.splitValue}>{formatCents(paid.preconsCents)}</Text>
          </View>
        )}
        <View style={[styles.splitRow, styles.totalRow]}>
          <Text style={styles.splitLabel}>Total</Text>
          <Text style={styles.splitValue}>{formatCents(paid.totalCents)}</Text>
        </View>
        <View style={styles.splitRow}>
          <Text style={styles.splitLabel}>Worth now{sold.soldCents > 0 ? ' + sold' : ''}</Text>
          <Text style={styles.splitValue}>{formatCents(paid.returnCents)}</Text>
        </View>
        <View style={styles.splitRow}>
          <Text style={styles.splitLabel}>Gain</Text>
          <Text style={[styles.splitValue, { color: paid.gainCents >= 0 ? colors.price : colors.danger }]}>
            {formatGain(paid.gainCents)} {gainPercent(paid.gainCents, paid.totalCents)}
          </Text>
        </View>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  empty: { color: colors.textMuted, textAlign: 'center', margin: 32, lineHeight: 20 },
  hero: { gap: 4 },
  heroLabel: { color: colors.textMuted },
  heroValue: { color: colors.price, fontSize: 36, fontWeight: '800' },
  heroSub: { color: colors.textMuted },
  row2: { flexDirection: 'row', gap: 10 },
  stat: { flex: 1, backgroundColor: colors.surface, borderRadius: 12, borderWidth: 1, borderColor: colors.border, padding: 12, gap: 2 },
  statLabel: { color: colors.textMuted, fontSize: 12, fontWeight: '600' },
  statValue: { color: colors.text, fontSize: 17, fontWeight: '800' },
  statFoot: { color: colors.textMuted, fontSize: 12 },
  card: { backgroundColor: colors.surface, borderRadius: 14, borderWidth: 1, borderColor: colors.border, padding: 14, gap: 10 },
  cardTitle: { color: colors.text, fontWeight: '700', fontSize: 15 },
  chartHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  selLine: { color: colors.textMuted, fontSize: 13 },
  splitRow: { flexDirection: 'row', justifyContent: 'space-between' },
  totalRow: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border, paddingTop: 8, marginTop: 2 },
  splitLabel: { color: colors.textMuted },
  splitValue: { color: colors.text, fontWeight: '600' },
});
