import { Modal, Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { TYPE_CHIPS } from '../lib/filter';
import { ALL_PRICE_THRESHOLDS, DEFAULT_PREFS, HIDE_BELOW_OPTIONS, type GalleryPrefs } from '../lib/prefs';
import { HEADLINE_SOURCES, PRICE_SOURCES } from '../lib/prices';
import { colors } from './theme';

interface Props {
  visible: boolean;
  prefs: GalleryPrefs;
  onChange: (patch: Partial<GalleryPrefs>) => void;
  onClose: () => void;
}

function toggleIn<T>(list: T[], v: T, order: T[]): T[] {
  const next = list.includes(v) ? list.filter((x) => x !== v) : [...list, v];
  return order.filter((x) => next.includes(x));
}

function Row({
  label,
  hint,
  value,
  onValueChange,
  disabled,
  indent,
}: {
  label: string;
  hint?: string;
  value: boolean;
  onValueChange: (v: boolean) => void;
  disabled?: boolean;
  indent?: boolean;
}) {
  return (
    <Pressable
      style={[styles.row, indent && styles.rowIndent, disabled && { opacity: 0.4 }]}
      onPress={() => !disabled && onValueChange(!value)}
    >
      <View style={{ flex: 1 }}>
        <Text style={[styles.rowLabel, indent && styles.rowLabelIndent]}>{label}</Text>
        {hint && <Text style={styles.rowHint}>{hint}</Text>}
      </View>
      <Switch
        value={value}
        onValueChange={onValueChange}
        disabled={disabled}
        trackColor={{ false: colors.border, true: colors.accent }}
        thumbColor="#fff"
      />
    </Pressable>
  );
}

export function FilterSettingsSheet({ visible, prefs, onChange, onClose }: Props) {
  const insets = useSafeAreaInsets();
  const typeKeys = TYPE_CHIPS.map((t) => t.key);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={[styles.sheet, { paddingBottom: insets.bottom + 12 }]} onPress={() => {}}>
          <View style={styles.handle} />
          <View style={styles.header}>
            <Text style={styles.title}>Customize</Text>
            <Pressable onPress={onClose} hitSlop={12}>
              <Text style={styles.done}>Done</Text>
            </Pressable>
          </View>

          <ScrollView style={{ maxHeight: 520 }} contentContainerStyle={{ paddingBottom: 8 }}>
            <Text style={styles.section}>Main price</Text>
            <View style={styles.choiceGroup}>
              {HEADLINE_SOURCES.map((k) => {
                const on = prefs.priceSource === k;
                return (
                  <Pressable
                    key={k}
                    style={[styles.choice, on && styles.choiceOn]}
                    onPress={() => onChange({ priceSource: k })}
                  >
                    <Text style={[styles.choiceText, on && styles.choiceTextOn]}>
                      {PRICE_SOURCES.find((s) => s.key === k)!.label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
            <Text style={styles.footnote}>Used for card tiles, the total, price filters and sorting.</Text>

            <Text style={styles.section}>Card page prices</Text>
            <View style={styles.group}>
              {PRICE_SOURCES.map((s) => (
                <Row
                  key={s.key}
                  label={s.label}
                  hint={s.currency === 'EUR' ? 'Euro prices' : undefined}
                  value={prefs.cardPageSources.includes(s.key)}
                  onValueChange={() =>
                    onChange({
                      cardPageSources: toggleIn(
                        prefs.cardPageSources,
                        s.key,
                        PRICE_SOURCES.map((x) => x.key),
                      ),
                    })
                  }
                />
              ))}
            </View>

            <Text style={styles.section}>Display</Text>
            <View style={styles.group}>
              <Row
                label="Rarity badges"
                value={prefs.rarityBadges}
                onValueChange={(v) => onChange({ rarityBadges: v })}
              />
            </View>

            <Text style={styles.section}>Hide cards under</Text>
            <View style={styles.choiceGroup}>
              {[null, ...HIDE_BELOW_OPTIONS].map((c) => {
                const on = prefs.hideBelowCents === c;
                return (
                  <Pressable
                    key={String(c)}
                    style={[styles.choice, on && styles.choiceOn]}
                    onPress={() => onChange({ hideBelowCents: c })}
                  >
                    <Text style={[styles.choiceText, on && styles.choiceTextOn]}>
                      {c == null ? 'Off' : `$${(c / 100).toFixed(2)}`}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
            <Text style={styles.footnote}>Cheaper cards are left out of the gallery and its total.</Text>

            <Text style={styles.section}>Price filter</Text>
            <View style={styles.group}>
              <Row
                label="Show price filter"
                value={prefs.showPrice}
                onValueChange={(v) => onChange({ showPrice: v })}
              />
              {ALL_PRICE_THRESHOLDS.map((c) => (
                <Row
                  key={c}
                  indent
                  label={`$${c / 100}+`}
                  value={prefs.priceThresholds.includes(c)}
                  disabled={!prefs.showPrice}
                  onValueChange={() =>
                    onChange({ priceThresholds: toggleIn(prefs.priceThresholds, c, ALL_PRICE_THRESHOLDS) })
                  }
                />
              ))}
            </View>

            <Text style={styles.section}>Color filter</Text>
            <View style={styles.group}>
              <Row
                label="Show color filter"
                hint="Filters by color identity"
                value={prefs.showColors}
                onValueChange={(v) => onChange({ showColors: v })}
              />
            </View>

            <Text style={styles.section}>Card type filter</Text>
            <View style={styles.group}>
              <Row label="Show type filter" value={prefs.showTypes} onValueChange={(v) => onChange({ showTypes: v })} />
              {TYPE_CHIPS.map((t) => (
                <Row
                  key={t.key}
                  indent
                  label={t.label}
                  value={prefs.types.includes(t.key)}
                  disabled={!prefs.showTypes}
                  onValueChange={() => onChange({ types: toggleIn(prefs.types, t.key, typeKeys) })}
                />
              ))}
            </View>

            <Pressable onPress={() => onChange(DEFAULT_PREFS)} style={styles.reset}>
              <Text style={styles.resetText}>Reset to defaults</Text>
            </Pressable>
          </ScrollView>
        </Pressable>
      </Pressable>
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
  },
  handle: {
    alignSelf: 'center',
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.border,
    marginBottom: 8,
  },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 4 },
  title: { color: colors.text, fontSize: 18, fontWeight: '700' },
  done: { color: colors.accent, fontSize: 16, fontWeight: '700' },
  section: {
    color: colors.textMuted,
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    marginTop: 18,
    marginBottom: 6,
    paddingHorizontal: 4,
  },
  group: {
    backgroundColor: colors.bg,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  rowIndent: { paddingLeft: 28, paddingVertical: 6 },
  rowLabel: { color: colors.text, fontSize: 15, fontWeight: '600' },
  rowLabelIndent: { fontWeight: '500', color: colors.textMuted },
  rowHint: { color: colors.textMuted, fontSize: 12, marginTop: 2 },
  choiceGroup: {
    flexDirection: 'row',
    padding: 3,
    borderRadius: 12,
    backgroundColor: colors.bg,
    borderWidth: 1,
    borderColor: colors.border,
  },
  choice: { flex: 1, paddingVertical: 8, borderRadius: 9, alignItems: 'center' },
  choiceOn: { backgroundColor: colors.accent },
  choiceText: { color: colors.textMuted, fontSize: 13, fontWeight: '600' },
  choiceTextOn: { color: '#fff' },
  footnote: { color: colors.textMuted, fontSize: 12, marginTop: 6, paddingHorizontal: 4 },
  reset: { alignSelf: 'center', paddingVertical: 16 },
  resetText: { color: colors.textMuted, fontWeight: '600' },
});
