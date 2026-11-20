import { useRef, useState } from 'react';
import { KeyboardAvoidingView, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { sourceFromProduct, type Opening } from '../lib/opening';
import { formatCents } from '../lib/pricing';
import { cardsPerPack, packsIn, productPrice, type Suggestion } from '../lib/sealed';
import type { SaveTarget } from '../lib/stack';
import { boxProgress, estimatePacks, parseDollars, type Source } from '../lib/sources';
import { ProductBrowser } from './ProductBrowser';
import { Stepper } from './Stepper';
import { colors, sheetWidth } from './theme';

interface Props {
  visible: boolean;
  cardCount: number;
  valueCents: number;
  openBoxes: Source[];
  opening: Opening | null;
  suggestions: { pack: Suggestion[]; box: Suggestion[] } | null;
  setCodes: string[];
  onSave: (target: SaveTarget) => void;
  onClose: () => void;
}

type Step =
  | { kind: 'choose' }
  | { kind: 'pack' }
  | { kind: 'box' }
  | { kind: 'browse'; back: 'pack' | 'box' }
  | { kind: 'continue'; box: Source };

const DEFAULT_BOX_PACKS = 30; // play booster box; collector boxes have 12

export function SaveSheet({ visible, cardCount, valueCents, openBoxes, opening, suggestions, setCodes, onSave, onClose }: Props) {
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const browseBack = useRef<(() => boolean) | null>(null);
  const packsGuess = estimatePacks(cardCount);
  const [step, setStep] = useState<Step>({ kind: 'choose' });
  const [name, setName] = useState('');
  const [price, setPrice] = useState('');
  const [packs, setPacks] = useState(packsGuess);
  const [boxPacks, setBoxPacks] = useState(DEFAULT_BOX_PACKS);
  const [product, setProduct] = useState<Suggestion | null>(null);

  const pickProduct = (s: Suggestion, kind: 'pack' | 'box') => {
    setProduct(s);
    setName(s.product.name);
    const each = productPrice(s.product);
    if (kind === 'pack') {
      const n = Math.max(1, Math.round(cardCount / cardsPerPack(s.type)));
      setPacks(n);
      setPrice(each == null ? '' : ((each * n) / 100).toFixed(2));
    } else {
      const inBox = packsIn(s.type);
      setBoxPacks(inBox);
      setPacks(Math.min(inBox, Math.max(1, Math.round(cardCount / cardsPerPack(s.type)))));
      setPrice(each == null ? '' : (each / 100).toFixed(2));
    }
  };
  const productFields = product ? { set_code: product.product.set_code, product_id: product.product.product_id || null } : {};
  const extra = product && step.kind !== 'browse' && !(suggestions?.[step.kind as 'pack' | 'box'] ?? []).some((s) => s.product === product.product) ? [product] : [];

  const cost = parseDollars(price);
  const priceInvalid = price.trim() !== '' && cost == null;
  const cards = `${cardCount} card${cardCount === 1 ? '' : 's'}`;

  const save = () => {
    if (step.kind === 'pack') {
      onSave({
        kind: 'new',
        source: {
          kind: 'pack',
          name: name.trim() || (packs > 1 ? 'Booster packs' : 'Booster pack'),
          cost_cents: cost,
          packs,
          packs_opened: packs,
          ...productFields,
        },
      });
    } else if (step.kind === 'box') {
      onSave({
        kind: 'new',
        source: {
          kind: 'box',
          name: name.trim() || 'Booster box',
          cost_cents: cost,
          packs: boxPacks,
          packs_opened: Math.min(packs, boxPacks),
          ...productFields,
        },
      });
    } else if (step.kind === 'continue') {
      onSave({ kind: 'existing', sourceId: step.box.id, packsOpened: packs });
    }
  };

  const onBack = () => {
    if (step.kind !== 'browse') return onClose();
    if (!browseBack.current?.()) setStep({ kind: step.back });
  };

  const option = (label: string, description: string, onPress: () => void, icon: string) => (
    <Pressable key={label} style={({ pressed }) => [styles.row, pressed && styles.pressed]} onPress={onPress}>
      <View style={styles.iconWrap}>
        <Text style={styles.icon}>{icon}</Text>
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.label}>{label}</Text>
        <Text style={styles.description}>{description}</Text>
      </View>
      <Text style={styles.chevron}>›</Text>
    </Pressable>
  );

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onBack} statusBarTranslucent>
      <KeyboardAvoidingView behavior="padding" style={{ flex: 1 }}>
        <Pressable style={styles.backdrop} onPress={onClose}>
          <Pressable style={[styles.sheet, sheetWidth, { paddingBottom: insets.bottom + 12 }]} onPress={() => {}}>
            <View style={styles.handle} />
            {step.kind === 'browse' ? (
              <View style={{ height: height * 0.75, gap: 12 }}>
                <Text style={styles.title}>{step.back === 'pack' ? 'Which packs?' : 'Which box or bundle?'}</Text>
                <ProductBrowser
                  backRef={browseBack}
                  setCodes={setCodes}
                  want={step.back}
                  onPick={(s) => {
                    pickProduct(s, step.back);
                    setStep({ kind: step.back });
                  }}
                />
                <Pressable style={[styles.secondary, { flex: 0 }]} onPress={() => setStep({ kind: step.back })}>
                  <Text style={styles.secondaryText}>Back</Text>
                </Pressable>
              </View>
            ) : (
            <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ gap: 12 }}>
              {step.kind === 'choose' ? (
                <>
                  <Text style={styles.title}>Where are these {cards} from?</Text>
                  <Text style={styles.subtitle}>Worth {formatCents(valueCents)} now</Text>
                  <View style={styles.list}>
                    {opening &&
                      (() => {
                        const src = sourceFromProduct(opening, cardCount);
                        return option(
                          `Opened: ${src.name}`,
                          src.kind === 'box'
                            ? `New box · ${src.packs_opened}/${src.packs} packs · paid ${formatCents(src.cost_cents)} (change later)`
                            : `${src.packs} pack${src.packs === 1 ? '' : 's'} · paid ${formatCents(src.cost_cents)} (change later)`,
                          () => onSave({ kind: 'new', source: src }),
                          '★',
                        );
                      })()}
                    {option('Already owned', 'Singles, trades, cards you had', () => onSave({ kind: 'owned' }), '✓')}
                    {openBoxes.map((b) =>
                      option(`Continue: ${b.name}`, `${boxProgress(b)} opened so far`, () => {
                        setPacks(Math.max(1, Math.min(packsGuess, b.packs - b.packs_opened || packsGuess)));
                        setStep({ kind: 'continue', box: b });
                      }, '▣'),
                    )}
                    {option('Opened packs', 'Loose boosters', () => setStep({ kind: 'pack' }), '◇')}
                    {option('Opened a box or bundle', 'Booster box, collector box, bundle', () => setStep({ kind: 'box' }), '▣')}
                  </View>
                </>
              ) : (
                <>
                  <Text style={styles.title}>
                    {step.kind === 'pack' ? 'Opened packs' : step.kind === 'box' ? 'New box or bundle' : step.box.name}
                  </Text>
                  <Text style={styles.subtitle}>
                    {cards} · worth {formatCents(valueCents)} now
                    {step.kind === 'continue' ? ` · ${boxProgress(step.box)} opened before` : ''}
                  </Text>

                  {step.kind !== 'continue' && (
                    <View style={styles.field}>
                      <Text style={styles.fieldLabel}>
                        {suggestions == null ? 'Finding the product…' : 'Product'}
                      </Text>
                      <View style={styles.chips}>
                        {[...extra, ...(suggestions?.[step.kind] ?? [])].map((s) => {
                          const on = product?.product === s.product;
                          return (
                            <Pressable
                              key={s.product.product_id || s.product.name}
                              style={[styles.chip, on && styles.chipOn]}
                              onPress={() => pickProduct(s, step.kind as 'pack' | 'box')}
                            >
                              <Text style={[styles.chipText, on && styles.chipTextOn]} numberOfLines={1}>
                                {s.product.name}
                              </Text>
                              <Text style={[styles.chipPrice, on && styles.chipTextOn]}>
                                {productPrice(s.product) == null ? '' : formatCents(productPrice(s.product))}
                              </Text>
                            </Pressable>
                          );
                        })}
                        <Pressable style={styles.chip} onPress={() => setStep({ kind: 'browse', back: step.kind as 'pack' | 'box' })}>
                          <Text style={[styles.chipText, { color: colors.accent }]}>Other set…</Text>
                        </Pressable>
                      </View>
                    </View>
                  )}

                  {step.kind !== 'continue' && (
                    <View style={styles.field}>
                      <Text style={styles.fieldLabel}>Name</Text>
                      <TextInput
                        value={name}
                        onChangeText={setName}
                        placeholder={step.kind === 'pack' ? 'e.g. Spider-Man Play Booster' : 'e.g. Foundations Play Booster Box'}
                        placeholderTextColor={colors.textMuted}
                        style={styles.input}
                      />
                    </View>
                  )}

                  {step.kind === 'box' && (
                    <View style={styles.inline}>
                      <Text style={styles.fieldLabel}>Packs in the box</Text>
                      <Stepper value={boxPacks} onChange={setBoxPacks} min={1} max={99} />
                    </View>
                  )}

                  <View style={styles.inline}>
                    <Text style={styles.fieldLabel}>
                      {step.kind === 'pack' ? 'Packs opened' : 'Packs opened now'}
                    </Text>
                    <Stepper value={packs} onChange={setPacks} min={1} max={step.kind === 'box' ? boxPacks : 99} />
                  </View>

                  {step.kind !== 'continue' && (
                    <View style={styles.field}>
                      <Text style={styles.fieldLabel}>
                        What you paid{step.kind === 'pack' && packs > 1 ? ' (all packs)' : ''}
                      </Text>
                      <TextInput
                        value={price}
                        onChangeText={setPrice}
                        placeholder="$0.00"
                        placeholderTextColor={colors.textMuted}
                        keyboardType="decimal-pad"
                        style={[styles.input, priceInvalid && styles.inputBad]}
                      />
                    </View>
                  )}

                  <View style={styles.buttons}>
                    <Pressable style={styles.secondary} onPress={() => setStep({ kind: 'choose' })}>
                      <Text style={styles.secondaryText}>Back</Text>
                    </Pressable>
                    <Pressable style={[styles.primary, priceInvalid && { opacity: 0.5 }]} disabled={priceInvalid} onPress={save}>
                      <Text style={styles.primaryText}>Save {cards}</Text>
                    </Pressable>
                  </View>
                </>
              )}
            </ScrollView>
            )}
          </Pressable>
        </Pressable>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: 16,
    paddingTop: 8,
    maxHeight: '90%',
  },
  handle: { alignSelf: 'center', width: 40, height: 4, borderRadius: 2, backgroundColor: colors.border, marginBottom: 12 },
  title: { color: colors.text, fontSize: 18, fontWeight: '700' },
  subtitle: { color: colors.textMuted, marginTop: -6 },
  list: { backgroundColor: colors.bg, borderRadius: 14, borderWidth: 1, borderColor: colors.border, overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  pressed: { backgroundColor: colors.surfaceHigh },
  iconWrap: { width: 34, height: 34, borderRadius: 17, backgroundColor: colors.surfaceHigh, alignItems: 'center', justifyContent: 'center' },
  icon: { color: colors.accent, fontSize: 16, fontWeight: '700' },
  label: { color: colors.text, fontWeight: '600', fontSize: 15 },
  description: { color: colors.textMuted, fontSize: 12, marginTop: 2 },
  chevron: { color: colors.textMuted, fontSize: 22 },
  field: { gap: 6 },
  inline: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  fieldLabel: { color: colors.textMuted, fontWeight: '600' },
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
  inputBad: { borderColor: colors.danger },
  chips: { gap: 8 },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.bg,
  },
  chipOn: { backgroundColor: colors.accent, borderColor: colors.accent },
  chipText: { flex: 1, color: colors.text, fontWeight: '600' },
  chipPrice: { color: colors.price, fontWeight: '700' },
  chipTextOn: { color: '#fff' },
  buttons: { flexDirection: 'row', gap: 10, marginTop: 4 },
  secondary: { flex: 1, paddingVertical: 14, borderRadius: 12, borderWidth: 1, borderColor: colors.border, alignItems: 'center' },
  secondaryText: { color: colors.text, fontWeight: '600' },
  primary: { flex: 2, paddingVertical: 14, borderRadius: 12, backgroundColor: colors.accent, alignItems: 'center' },
  primaryText: { color: '#fff', fontWeight: '700' },
});
