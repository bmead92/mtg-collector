import { Image } from 'expo-image';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { PrintingPicker } from '../../components/PrintingPicker';
import { SellSheet } from '../../components/SellSheet';
import { Segmented } from '../../components/Segmented';
import { Stepper } from '../../components/Stepper';
import { colors, readable } from '../../components/theme';
import { getScan, setQuantity, updateScanDetails, type Scan, type ScanEdits } from '../../lib/db';
import { CONDITIONS, type Condition } from '../../lib/manapool';
import { useGalleryPrefs } from '../../lib/prefs';
import { formatCents, refreshPrices, removeScan } from '../../lib/pricing';
import { cachedPrice, formatMoney, PRICE_SOURCES, priceFrom, type PriceSource } from '../../lib/prices';
import { browseListFor } from '../../lib/browse';
import { langLabel, pricingPrinting } from '../../lib/language';
import { cardById, cardImage, cardMeta, faceImages, type Finish, type ScryfallCard } from '../../lib/scryfall';

export default function CardDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { width } = useWindowDimensions();
  const [ids] = useState(() => browseListFor(Number(id)));
  const [index, setIndex] = useState(() => ids.indexOf(Number(id)));
  return (
    <FlatList
      horizontal
      pagingEnabled
      data={ids}
      keyExtractor={String}
      initialScrollIndex={index}
      getItemLayout={(_, i) => ({ length: width, offset: width * i, index: i })}
      initialNumToRender={1}
      maxToRenderPerBatch={2}
      windowSize={3}
      showsHorizontalScrollIndicator={false}
      style={styles.container}
      onMomentumScrollEnd={(e) => setIndex(Math.round(e.nativeEvent.contentOffset.x / width))}
      renderItem={({ item, index: i }) => (
        <View style={{ width }}>
          <CardPage id={item} active={i === index} />
        </View>
      )}
    />
  );
}

function CardPage({ id, active }: { id: number; active: boolean }) {
  const { width: winW } = useWindowDimensions();
  const imageWidth = Math.min(winW - 32, 440);
  const [scan, setScan] = useState<Scan | null>(null);
  const [card, setCard] = useState<ScryfallCard | null>(null);
  const [view, setView] = useState(0);
  const [busy, setBusy] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [selling, setSelling] = useState(false);
  const [prefs] = useGalleryPrefs();

  const load = useCallback(async () => {
    const s = await getScan(id);
    setScan(s);
    return s;
  }, [id]);

  useEffect(() => {
    let cancelled = false;
    getScan(id)
      .then((s) => {
        if (cancelled) return;
        setScan(s);
        if (s)
          cardById(s.scryfall_id)
            .then((c) => !cancelled && setCard(c))
            .catch(() => {});
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [id]);

  if (!scan) return <ActivityIndicator color={colors.text} style={{ marginTop: 60 }} />;

  const applyEdit = async (patch: Partial<ScanEdits>) => {
    setBusy(true);
    try {
      const next: ScanEdits = {
        scryfall_id: scan.scryfall_id,
        name: scan.name,
        set_code: scan.set_code,
        set_name: scan.set_name,
        collector_number: scan.collector_number,
        image_uri: scan.image_uri,
        finish: scan.finish,
        condition: scan.condition,
        price_id: scan.price_id,
        ...patch,
      };
      await updateScanDetails(scan.id, next);
      const updated = await load();
      if (updated) await refreshPrices([updated]);
      await load();
    } catch (e) {
      Alert.alert('Could not update card', String(e));
    } finally {
      setBusy(false);
    }
  };

  const changePrinting = async (c: ScryfallCard) => {
    setPickerOpen(false);
    setCard(c);
    const priceCard = await pricingPrinting(c);
    const finish: Finish = c.finishes.includes(scan.finish)
      ? scan.finish
      : c.finishes.includes('nonfoil')
        ? 'nonfoil'
        : c.finishes[0];
    applyEdit({
      scryfall_id: c.id,
      name: c.name,
      set_code: c.set,
      set_name: c.set_name,
      collector_number: c.collector_number,
      image_uri: cardImage(c, 'normal'),
      ...cardMeta(c),
      finish,
      price_id: priceCard.id === c.id ? null : priceCard.id,
    });
  };

  const changeQuantity = async (q: number) => {
    await setQuantity(scan.id, q);
    await load();
  };

  const remove = () =>
    Alert.alert(`Delete ${scan.name}?`, 'This permanently removes it from your collection.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          await removeScan(scan);
          router.back();
        },
      },
    ]);

  const cardFaces = card ? faceImages(card) : [];
  const faces = cardFaces.length ? cardFaces : scan.image_uri ? [{ name: scan.name, uri: scan.image_uri }] : [];
  const views = [
    ...faces.map((f, i) => ({
      uri: f.uri,
      label: faces.length > 1 ? (i === 0 ? 'Front' : 'Back') : 'Card image',
      photo: false,
    })),
    ...(scan.photo_uri ? [{ uri: scan.photo_uri, label: 'Your photo', photo: true }] : []),
  ];
  const current = views.length ? views[view % views.length] : null;

  const sources = PRICE_SOURCES.filter((s) => prefs.cardPageSources.includes(s.key) || s.key === prefs.priceSource).sort(
    (a, b) => Number(b.key === prefs.priceSource) - Number(a.key === prefs.priceSource),
  );
  const linkFor = (k: PriceSource): string | null =>
    k === 'manapool' ? scan.manapool_url : (card?.purchase_uris?.[k] ?? null);
  const noteFor = (k: PriceSource): string =>
    k === 'manapool'
      ? scan.condition === 'NM' && scan.market_cents != null
        ? `Market price · lowest listing ${formatCents(scan.low_cents)}`
        : `Lowest ${scan.condition} listing · market ${formatCents(scan.market_cents)}`
      : 'Near-mint market price';
  const finishes: Finish[] = card?.finishes ?? [scan.finish];

  return (
    <ScrollView style={styles.container} contentContainerStyle={[{ padding: 16, gap: 16, paddingBottom: 48 }, readable]}>
      {active && <Stack.Screen options={{ title: scan.name }} />}

      <Pressable onPress={() => setView((v) => (v + 1) % views.length)} disabled={views.length < 2}>
        {current ? (
          <Image
            source={{ uri: current.uri }}
            style={[styles.image, { width: imageWidth }]}
            contentFit={current.photo ? 'cover' : 'contain'}
            transition={150}
          />
        ) : (
          <View style={[styles.image, styles.noImage, { width: imageWidth }]}>
            <Text style={styles.noImageText}>No picture for this card</Text>
          </View>
        )}
        {current && views.length > 1 && (
          <Text style={styles.caption}>
            {current.label} · tap for {views[(view + 1) % views.length].label.toLowerCase()}
          </Text>
        )}
      </Pressable>

      <View style={styles.panel}>
        <Text style={styles.name}>{scan.name}</Text>
        <Pressable onPress={() => card && setPickerOpen(true)} style={styles.printingRow} disabled={!card || busy}>
          <Text style={styles.printing}>
            {scan.set_name} ({scan.set_code.toUpperCase()}) #{scan.collector_number}
            {langLabel(scan.lang) ? ` · ${langLabel(scan.lang)}` : ''}
          </Text>
          <Text style={[styles.link, !card && { opacity: 0.4 }]}>Change</Text>
        </Pressable>

        <Text style={styles.label}>Finish</Text>
        <Segmented
          options={finishes}
          value={scan.finish}
          onChange={(f) => f !== scan.finish && applyEdit({ finish: f })}
          labels={{ nonfoil: 'Non-foil', foil: 'Foil', etched: 'Etched' }}
        />

        <Text style={styles.label}>Condition</Text>
        <Segmented
          options={CONDITIONS}
          value={scan.condition}
          onChange={(c: Condition) => c !== scan.condition && applyEdit({ condition: c })}
        />

        <View style={styles.copiesRow}>
          <Text style={[styles.label, { marginTop: 0 }]}>Copies</Text>
          <Stepper value={scan.quantity ?? 1} onChange={changeQuantity} disabled={busy} />
        </View>
      </View>

      <View style={styles.panel}>
        <Text style={styles.label}>Prices</Text>
        {busy ? (
          <ActivityIndicator color={colors.text} style={{ alignSelf: 'flex-start', marginVertical: 12 }} />
        ) : (
          sources.map((s, i) => {
            const link = linkFor(s.key);
            return (
              <Pressable
                key={s.key}
                style={[styles.priceRow, i > 0 && styles.priceRowDivider]}
                onPress={() => link && Linking.openURL(link)}
                disabled={!link}
              >
                <View style={{ flex: 1 }}>
                  <Text style={styles.sourceName}>
                    {s.label}
                    {link ? <Text style={styles.sourceLink}> ↗</Text> : null}
                  </Text>
                  <Text style={styles.sourceNote}>{noteFor(s.key)}</Text>
                </View>
                <Text style={i === 0 ? styles.bigPrice : styles.price}>
                  {formatMoney(priceFrom(scan, s.key), s.currency)}
                </Text>
              </Pressable>
            );
          })
        )}
        <Text style={[styles.muted, { marginTop: 4 }]}>
          Updated {scan.price_updated_at ? new Date(scan.price_updated_at).toLocaleString() : 'never'}
        </Text>
        <Pressable onPress={() => applyEdit({})} disabled={busy} style={{ marginTop: 4 }}>
          <Text style={styles.link}>Refresh prices</Text>
        </Pressable>
      </View>

      <View style={styles.actions}>
        <Pressable style={styles.sell} onPress={() => setSelling(true)} disabled={busy}>
          <Text style={styles.sellText}>Sell</Text>
        </Pressable>
        <Pressable style={styles.delete} onPress={remove}>
          <Text style={styles.deleteText}>Delete</Text>
        </Pressable>
      </View>

      {selling && (
        <SellSheet
          scan={scan}
          unitCents={cachedPrice(scan, prefs.priceSource)}
          onClose={() => setSelling(false)}
          onSold={async (result) => {
            setSelling(false);
            if (result === 'sold-all') router.back();
            else await load();
          }}
        />
      )}

      <PrintingPicker visible={pickerOpen} card={card} onSelect={changePrinting} onClose={() => setPickerOpen(false)} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  noImage: { alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surface },
  noImageText: { color: colors.textMuted },
  image: {
    alignSelf: 'center',
    aspectRatio: 63 / 88,
    borderRadius: 14,
    backgroundColor: colors.surface,
  },
  caption: { color: colors.textMuted, fontSize: 12, textAlign: 'center', marginTop: 6 },
  panel: {
    backgroundColor: colors.surface,
    borderRadius: 12,
    padding: 14,
    gap: 8,
    borderWidth: 1,
    borderColor: colors.border,
  },
  name: { color: colors.text, fontSize: 20, fontWeight: '700' },
  copiesRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 10 },
  printingRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
  printing: { color: colors.text, flexShrink: 1 },
  label: { color: colors.textMuted, fontSize: 12, textTransform: 'uppercase', marginTop: 6 },
  muted: { color: colors.textMuted },
  bigPrice: { color: colors.price, fontSize: 30, fontWeight: '800' },
  price: { color: colors.text, fontSize: 20, fontWeight: '700' },
  priceRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 8 },
  priceRowDivider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  sourceName: { color: colors.text, fontSize: 15, fontWeight: '700' },
  sourceLink: { color: colors.accent },
  sourceNote: { color: colors.textMuted, fontSize: 12, marginTop: 2 },
  link: { color: colors.accent, fontWeight: '600' },
  actions: { flexDirection: 'row', gap: 10 },
  sell: { flex: 2, paddingVertical: 14, alignItems: 'center', borderRadius: 12, backgroundColor: colors.price },
  sellText: { color: colors.bg, fontWeight: '800' },
  delete: {
    flex: 1,
    paddingVertical: 14,
    alignItems: 'center',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.danger,
  },
  deleteText: { color: colors.danger, fontWeight: '700' },
});
