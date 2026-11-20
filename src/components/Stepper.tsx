import { Pressable, StyleSheet, Text, View } from 'react-native';
import { colors } from './theme';

interface Props {
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  disabled?: boolean;
}

export function Stepper({ value, onChange, min = 1, max = 999, disabled }: Props) {
  const dec = () => value > min && onChange(value - 1);
  const inc = () => value < max && onChange(value + 1);
  return (
    <View style={[styles.wrap, disabled && { opacity: 0.5 }]}>
      <Pressable
        onPress={dec}
        disabled={disabled || value <= min}
        hitSlop={8}
        style={styles.btn}
        accessibilityLabel="Fewer"
      >
        <Text style={[styles.btnText, value <= min && styles.btnTextOff]}>−</Text>
      </Pressable>
      <Text style={styles.value}>{value}</Text>
      <Pressable
        onPress={inc}
        disabled={disabled || value >= max}
        hitSlop={8}
        style={styles.btn}
        accessibilityLabel="More"
      >
        <Text style={[styles.btnText, value >= max && styles.btnTextOff]}>+</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.bg,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
  },
  btn: { width: 40, height: 38, alignItems: 'center', justifyContent: 'center' },
  btnText: { color: colors.accent, fontSize: 22, fontWeight: '700' },
  btnTextOff: { color: colors.textMuted, opacity: 0.5 },
  value: { color: colors.text, fontSize: 16, fontWeight: '700', minWidth: 32, textAlign: 'center' },
});
