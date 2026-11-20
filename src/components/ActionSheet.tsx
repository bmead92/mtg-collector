import type { ReactNode } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, sheetWidth } from './theme';

export interface SheetOption {
  label: string;
  description?: string;
  icon?: string | ReactNode;
  selected?: boolean;
  destructive?: boolean;
  onPress: () => void;
}

interface Props {
  visible: boolean;
  title?: string;
  subtitle?: string;
  options: SheetOption[];
  onClose: () => void;
}

export function ActionSheet({ visible, title, subtitle, options, onClose }: Props) {
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={[styles.sheet, sheetWidth, { paddingBottom: insets.bottom + 12 }]} onPress={() => {}}>
          <View style={styles.handle} />
          {title && <Text style={styles.title}>{title}</Text>}
          {subtitle && <Text style={styles.subtitle}>{subtitle}</Text>}
          <View style={styles.list}>
            {options.map((o, i) => (
              <Pressable
                key={o.label}
                style={({ pressed }) => [styles.row, i > 0 && styles.rowDivider, pressed && styles.rowPressed]}
                onPress={() => {
                  onClose();
                  o.onPress();
                }}
              >
                {o.icon !== undefined && (
                  <View style={[styles.iconWrap, o.destructive && styles.iconWrapDanger]}>
                    {typeof o.icon === 'string' ? (
                      <Text style={[styles.icon, o.destructive && styles.danger]}>{o.icon}</Text>
                    ) : (
                      o.icon
                    )}
                  </View>
                )}
                <View style={{ flex: 1 }}>
                  <Text style={[styles.label, o.destructive && styles.danger]}>{o.label}</Text>
                  {o.description && <Text style={styles.description}>{o.description}</Text>}
                </View>
                {o.selected && <Text style={styles.check}>✓</Text>}
              </Pressable>
            ))}
          </View>
          <Pressable style={({ pressed }) => [styles.cancel, pressed && styles.rowPressed]} onPress={onClose}>
            <Text style={styles.cancelText}>Cancel</Text>
          </Pressable>
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
    marginBottom: 12,
  },
  title: { color: colors.text, fontSize: 18, fontWeight: '700', paddingHorizontal: 4 },
  subtitle: { color: colors.textMuted, fontSize: 13, marginTop: 2, paddingHorizontal: 4 },
  list: {
    marginTop: 12,
    backgroundColor: colors.bg,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 14, paddingHorizontal: 14 },
  rowDivider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  rowPressed: { backgroundColor: colors.surfaceHigh },
  iconWrap: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: colors.surfaceHigh,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconWrapDanger: { backgroundColor: 'rgba(248,113,113,0.12)' },
  icon: { color: colors.accent, fontSize: 18, fontWeight: '700' },
  label: { color: colors.text, fontSize: 16, fontWeight: '600' },
  description: { color: colors.textMuted, fontSize: 13, marginTop: 2 },
  danger: { color: colors.danger },
  check: { color: colors.accent, fontSize: 18, fontWeight: '800' },
  cancel: {
    marginTop: 10,
    paddingVertical: 14,
    borderRadius: 14,
    alignItems: 'center',
    backgroundColor: colors.bg,
    borderWidth: 1,
    borderColor: colors.border,
  },
  cancelText: { color: colors.text, fontSize: 16, fontWeight: '600' },
});
