import { useState } from 'react';
import { Alert, KeyboardAvoidingView, Modal, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { Scan } from '../lib/db';
import { formatCents, sellCard } from '../lib/pricing';
import { frontName } from '../lib/scryfall';
import { parseDollars } from '../lib/sources';
import { Stepper } from './Stepper';
import { colors, sheetWidth } from './theme';

interface Props {
  scan: Scan;
  unitCents: number | null;
  onClose: () => void;
  onSold: (result: 'sold-all' | 'sold-some') => void;
}

const dollars = (cents: number) => (cents / 100).toFixed(2);

export function SellSheet({ scan, unitCents, onClose, onSold }: Props) {
  const insets = useSafeAreaInsets();
  const owned = scan.quantity ?? 1;
  const [copies, setCopies] = useState(1);
  const [price, setPrice] = useState(unitCents != null ? dollars(unitCents) : '');
  const [edited, setEdited] = useState(false);
  const [saving, setSaving] = useState(false);
  const cents = parseDollars(price);
  const name = frontName(scan.name);

  const changeCopies = (n: number) => {
    setCopies(n);
    if (!edited && unitCents != null) setPrice(dollars(unitCents * n));
  };

  const commit = async () => {
    setSaving(true);
    try {
      onSold(await sellCard(scan, copies, cents ?? 0));
    } catch (e) {
      Alert.alert('Could not sell', String(e));
      setSaving(false);
    }
  };

  const sell = () => {
    if (cents == null) return;
    const warnings = [
      ...(cents === 0 ? ['Sold for $0.00? If it was added by mistake, delete it instead.'] : []),
      ...(copies >= owned ? ['It leaves your collection and moves to Sold.'] : []),
    ];
    if (warnings.length === 0) return commit();
    Alert.alert(`Sell ${name}?`, warnings.join('\n\n'), [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Sell', onPress: commit },
    ]);
  };

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <KeyboardAvoidingView behavior="padding" style={{ flex: 1 }}>
        <Pressable style={styles.backdrop} onPress={onClose}>
          <Pressable style={[styles.sheet, sheetWidth, { paddingBottom: insets.bottom + 12 }]} onPress={() => {}}>
            <View style={styles.handle} />
            <Text style={styles.title}>Sell {name}</Text>
            <Text style={styles.subtitle}>
              {scan.set_name} · #{scan.collector_number} · worth {formatCents(unitCents)}
              {owned > 1 ? ' each' : ''}
            </Text>

            {owned > 1 && (
              <View style={styles.inline}>
                <Text style={styles.label}>Copies</Text>
                <Stepper value={copies} onChange={changeCopies} max={owned} disabled={saving} />
              </View>
            )}

            <View style={styles.field}>
              <Text style={styles.label}>Sold for</Text>
              <TextInput
                value={price}
                onChangeText={(t) => {
                  setPrice(t);
                  setEdited(true);
                }}
                placeholder="0.00"
                placeholderTextColor={colors.textMuted}
                keyboardType="decimal-pad"
                selectTextOnFocus
                autoFocus
                style={[styles.input, cents == null && styles.inputBad]}
              />
            </View>

            <View style={styles.buttons}>
              <Pressable style={styles.secondary} onPress={onClose}>
                <Text style={styles.secondaryText}>Cancel</Text>
              </Pressable>
              <Pressable
                style={[styles.primary, (cents == null || saving) && { opacity: 0.5 }]}
                disabled={cents == null || saving}
                onPress={sell}
              >
                <Text style={styles.primaryText}>
                  Sell{copies > 1 ? ` ${copies}` : ''} for {cents == null ? '—' : formatCents(cents)}
                </Text>
              </Pressable>
            </View>
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
    gap: 14,
  },
  handle: { alignSelf: 'center', width: 40, height: 4, borderRadius: 2, backgroundColor: colors.border },
  title: { color: colors.text, fontSize: 18, fontWeight: '700' },
  subtitle: { color: colors.textMuted, fontSize: 13, marginTop: -10 },
  inline: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  field: { gap: 6 },
  label: { color: colors.textMuted, fontWeight: '600' },
  input: {
    backgroundColor: colors.bg,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    color: colors.text,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 18,
  },
  inputBad: { borderColor: colors.danger },
  buttons: { flexDirection: 'row', gap: 10 },
  secondary: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
  },
  secondaryText: { color: colors.text, fontWeight: '600' },
  primary: { flex: 2, paddingVertical: 14, borderRadius: 12, backgroundColor: colors.price, alignItems: 'center' },
  primaryText: { color: '#0d0d12', fontWeight: '800' },
});
