import { Image } from 'expo-image';
import { router } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { PrintingPicker } from '../components/PrintingPicker';
import { Segmented } from '../components/Segmented';
import { Stepper } from '../components/Stepper';
import { colors, readable } from '../components/theme';
import { insertScan, quantityOwned } from '../lib/db';
import { isForeign, pricingPrinting } from '../lib/language';
import { defaultFinish, identify, type MatchMethod } from '../lib/identify';
import {
  CONDITIONS,
  getSinglesByScryfallId,
  headlinePrice,
  quoteFor,
  type Condition,
  type ManaPoolSingle,
} from '../lib/manapool';
import { logFailure, logMatch } from '../lib/diag';
import { getPendingScan, setPendingScan } from '../lib/pendingScan';
import { deletePhoto } from '../lib/photos';
import { formatCents } from '../lib/pricing';
import { formatMoney, scryfallCents, serializePrices } from '../lib/prices';
import { cardByFuzzyName, cardImage, cardMeta, faceImages, type Finish, type ScryfallCard } from '../lib/scryfall';

const METHOD_LABEL: Record<MatchMethod, string> = {
  'set+number': 'Matched by set + collector number',
  'name+set': 'Matched by name + set — check the collector number',
  name: 'Matched by name only — pick the right printing',
  none: 'Could not identify — search by name below',
};

export default function ConfirmScreen() {
  const [pending] = useState(getPendingScan);

  const [loading, setLoading] = useState(true);
  const [card, setCard] = useState<ScryfallCard | null>(null);
  const [method, setMethod] = useState<MatchMethod>('none');
  const [finish, setFinish] = useState<Finish>('nonfoil');
  const [condition, setCondition] = useState<Condition>('NM');
  const [singles, setSingles] = useState<Map<string, ManaPoolSingle>>(new Map());
  const [priceCard, setPriceCard] = useState<ScryfallCard | null>(null);
  const [priceError, setPriceError] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [face, setFace] = useState(0);
  const [search, setSearch] = useState(pending?.guess.name ?? '');
  const [showRaw, setShowRaw] = useState(false);
  const [saving, setSaving] = useState(false);
  const [copies, setCopies] = useState(1);
  const [owned, setOwned] = useState(0); // copies of this exact printing/finish/condition already saved

  const selectCard = useCallback(
    (c: ScryfallCard, preferredFinish?: Finish) => {
      setCard(c);
      setPriceError(null);
      setFinish((f) => {
        const want = preferredFinish ?? f;
        return c.finishes.includes(want) ? want : defaultFinish(c, pending?.guess.foil);
      });
    },
    [pending],
  );

  useEffect(() => {
    if (!pending) {
      router.back();
      return;
    }
    identify(pending.guess)
      .then((r) => {
        logMatch('single', r);
        if (r.card) selectCard(r.card, defaultFinish(r.card, r.foil));
        setMethod(r.method);
      })
      .catch((e) => {
        logFailure('single-lookup', e);
        Alert.alert('Lookup failed', String(e));
      })
      .finally(() => setLoading(false));
  }, [pending, selectCard]);

  useEffect(
    () => () => {
      if (pending) deletePhoto(pending.photoUri);
    },
    [pending],
  );

  useEffect(() => {
    if (!card) return;
    let cancelled = false;
    pricingPrinting(card)
      .then((pc) => {
        if (cancelled) return;
        setPriceCard(pc);
        if (singles.has(pc.id)) return;
        getSinglesByScryfallId([pc.id])
          .then((m) => setSingles((prev) => new Map([...prev, ...m])))
          .catch((e) => setPriceError(String(e)));
      })
      .catch((e) => !cancelled && setPriceError(String(e)));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [card]);

  useEffect(() => {
    if (!card) return;
    let cancelled = false;
    quantityOwned(card.id, finish, condition)
      .then((n) => !cancelled && setOwned(n))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [card, finish, condition]);

  const runSearch = async () => {
    if (!search.trim()) return;
    setLoading(true);
    try {
      const c = await cardByFuzzyName(search.trim());
      if (!c) Alert.alert('No match', `Scryfall couldn't find "${search}".`);
      else {
        selectCard(c);
        setMethod('name');
      }
    } catch (e) {
      Alert.alert('Search failed', String(e));
    } finally {
      setLoading(false);
    }
  };

  const pc = priceCard && card && (priceCard.id === card.id || isForeign(card)) ? priceCard : card;
  const single = pc ? singles.get(pc.id) : undefined;
  const quote = single ? quoteFor(single, finish, condition) : null;

  const save = async () => {
    if (!card || !pending) return;
    setSaving(true);
    try {
      await insertScan({
        photo_uri: '', // photos aren't kept; the Scryfall image is shown instead
        quantity: copies,
        scryfall_id: card.id,
        name: card.name,
        set_code: card.set,
        set_name: card.set_name,
        collector_number: card.collector_number,
        image_uri: cardImage(card, 'normal'),
        ...cardMeta(card),
        sf_prices: serializePrices((pc ?? card).prices),
        price_id: pc && pc.id !== card.id ? pc.id : null,
        finish,
        condition,
        price_cents: quote ? headlinePrice(quote) : null,
        market_cents: quote?.marketCents ?? null,
        low_cents: quote?.lowCents ?? null,
        manapool_url: quote?.url ?? null,
        price_updated_at: quote ? new Date().toISOString() : null,
      });
      setPendingScan(null);
      router.dismissTo('/');
    } catch (e) {
      Alert.alert('Save failed', String(e));
      setSaving(false);
    }
  };

  if (!pending) return null;

  return (
    <ScrollView style={styles.container} contentContainerStyle={[{ padding: 16, gap: 16, paddingBottom: 48 }, readable]}>
      <View style={styles.row}>
        <View style={styles.imageCol}>
          <Text style={styles.caption}>Your photo</Text>
          <Image source={{ uri: pending.photoUri }} style={styles.cardImg} contentFit="cover" />
        </View>
        <View style={styles.imageCol}>
          <Text style={styles.caption}>
            {card && faceImages(card).length > 1
              ? `Match · ${face % 2 === 0 ? 'front' : 'back'} (tap to flip)`
              : 'Match'}
          </Text>
          {loading ? (
            <View style={[styles.cardImg, styles.center]}>
              <ActivityIndicator color={colors.text} />
            </View>
          ) : card ? (
            <Pressable onPress={() => setFace((f) => f + 1)} disabled={faceImages(card).length < 2}>
              <Image
                source={{ uri: faceImages(card)[face % Math.max(1, faceImages(card).length)]?.uri }}
                style={styles.cardImg}
                contentFit="contain"
              />
            </Pressable>
          ) : (
            <View style={[styles.cardImg, styles.center]}>
              <Text style={styles.muted}>No match</Text>
            </View>
          )}
        </View>
      </View>

      {!loading && <Text style={styles.method}>{METHOD_LABEL[card ? method : 'none']}</Text>}

      {card && (
        <View style={styles.panel}>
          <Text style={styles.name}>{card.name}</Text>
          <Pressable onPress={() => setPickerOpen(true)} style={styles.printingRow}>
            <Text style={styles.printing}>
              {card.set_name} ({card.set.toUpperCase()}) #{card.collector_number}
            </Text>
            <Text style={styles.link}>Change</Text>
          </Pressable>

          <Text style={styles.label}>Finish</Text>
          <Segmented
            options={card.finishes}
            value={finish}
            onChange={setFinish}
            labels={{ nonfoil: 'Non-foil', foil: 'Foil', etched: 'Etched' }}
          />

          <Text style={styles.label}>Condition</Text>
          <Segmented options={CONDITIONS} value={condition} onChange={setCondition} />

          <View style={styles.copiesRow}>
            <View style={{ flex: 1 }}>
              <Text style={[styles.label, { marginTop: 0 }]}>Copies to add</Text>
              {owned > 0 && <Text style={styles.owned}>Already in your collection: {owned}</Text>}
            </View>
            <Stepper value={copies} onChange={setCopies} />
          </View>
        </View>
      )}

      {card && (
        <View style={styles.panel}>
          <Text style={styles.label}>Mana Pool</Text>
          {priceError ? (
            <Text style={styles.error}>{priceError}</Text>
          ) : !single ? (
            singles.size === 0 ? (
              <ActivityIndicator color={colors.text} />
            ) : (
              <Text style={styles.muted}>Not listed on Mana Pool</Text>
            )
          ) : (
            <>
              <Text style={styles.bigPrice}>{formatCents(quote ? headlinePrice(quote) : null)}</Text>
              <Text style={styles.muted}>{condition === 'NM' && quote?.marketCents != null ? 'Market price' : `Lowest ${condition} listing`}</Text>
              <Text style={styles.muted}>
                Lowest {condition} {finish} listing: {formatCents(quote?.lowCents ?? null)} · {quote?.listingsAvailable ?? 0} available
              </Text>
              {quote && quote.recentSales.length > 0 && (
                <Text style={styles.muted}>
                  Recent sales:{' '}
                  {quote.recentSales
                    .slice(0, 5)
                    .map((s) => formatCents(s.price))
                    .join(', ')}
                </Text>
              )}
              <Pressable onPress={() => Linking.openURL(single.url)}>
                <Text style={[styles.link, { marginTop: 8 }]}>Open on Mana Pool ↗</Text>
              </Pressable>
            </>
          )}
        </View>
      )}

      {pc && pc.prices && (
        <View style={styles.panel}>
          <Text style={styles.label}>Other prices</Text>
          <Text style={styles.muted}>
            TCGplayer {formatMoney(scryfallCents(pc.prices, 'tcgplayer', finish), 'USD')} · Cardmarket{' '}
            {formatMoney(scryfallCents(pc.prices, 'cardmarket', finish), 'EUR')}
          </Text>
        </View>
      )}

      <View style={styles.panel}>
        <Text style={styles.label}>Wrong card? Search by name</Text>
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <TextInput
            value={search}
            onChangeText={setSearch}
            onSubmitEditing={runSearch}
            placeholder="Card name"
            placeholderTextColor={colors.textMuted}
            style={styles.input}
            returnKeyType="search"
          />
          <Pressable style={styles.smallButton} onPress={runSearch}>
            <Text style={styles.buttonText}>Search</Text>
          </Pressable>
        </View>
        <Pressable onPress={() => setShowRaw((s) => !s)}>
          <Text style={[styles.link, { marginTop: 8 }]}>{showRaw ? 'Hide' : 'Show'} OCR details</Text>
        </Pressable>
        {showRaw && (
          <Text style={styles.raw}>
            name: {pending.guess.name ?? '∅'} | set: {pending.guess.setCode ?? '∅'} | #:{' '}
            {pending.guess.collectorNumber ?? '∅'}
            {'\n\n'}
            {pending.guess.rawText}
          </Text>
        )}
      </View>

      <View style={{ flexDirection: 'row', gap: 12 }}>
        <Pressable style={[styles.button, styles.secondary]} onPress={() => router.back()}>
          <Text style={styles.buttonText}>Retake</Text>
        </Pressable>
        <Pressable
          style={[styles.button, (!card || saving) && { opacity: 0.5 }]}
          onPress={save}
          disabled={!card || saving}
        >
          <Text style={styles.buttonText}>{saving ? 'Saving…' : 'Save'}</Text>
        </Pressable>
      </View>

      <PrintingPicker
        visible={pickerOpen}
        card={card}
        onSelect={(c) => {
          selectCard(c);
          setPickerOpen(false);
        }}
        onClose={() => setPickerOpen(false)}
      />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  row: { flexDirection: 'row', gap: 12 },
  imageCol: { flex: 1, gap: 6 },
  caption: { color: colors.textMuted, fontSize: 12 },
  cardImg: { width: '100%', aspectRatio: 63 / 88, borderRadius: 10, backgroundColor: colors.surface },
  center: { alignItems: 'center', justifyContent: 'center' },
  method: { color: colors.textMuted, fontSize: 13, textAlign: 'center' },
  panel: {
    backgroundColor: colors.surface,
    borderRadius: 12,
    padding: 14,
    gap: 8,
    borderWidth: 1,
    borderColor: colors.border,
  },
  name: { color: colors.text, fontSize: 20, fontWeight: '700' },
  copiesRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 10 },
  owned: { color: colors.price, fontSize: 12, marginTop: 2 },
  printingRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
  printing: { color: colors.text, flexShrink: 1 },
  label: { color: colors.textMuted, fontSize: 12, textTransform: 'uppercase', marginTop: 6 },
  link: { color: colors.accent, fontWeight: '600' },
  muted: { color: colors.textMuted },
  error: { color: colors.danger },
  bigPrice: { color: colors.price, fontSize: 34, fontWeight: '800' },
  price: { color: colors.price, fontWeight: '700' },
  input: {
    flex: 1,
    backgroundColor: colors.surfaceHigh,
    color: colors.text,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  raw: { color: colors.textMuted, fontFamily: 'monospace', fontSize: 11, marginTop: 6 },
  button: { flex: 1, backgroundColor: colors.accent, paddingVertical: 14, borderRadius: 12, alignItems: 'center' },
  secondary: { backgroundColor: colors.surfaceHigh },
  smallButton: { backgroundColor: colors.accent, paddingHorizontal: 16, borderRadius: 8, justifyContent: 'center' },
  buttonText: { color: '#fff', fontWeight: '700' },
});
