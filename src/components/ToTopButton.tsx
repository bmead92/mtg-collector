import { Pressable, StyleSheet, Text } from 'react-native';
import { colors } from './theme';

export function ToTopButton({ onPress, bottom }: { onPress: () => void; bottom: number }) {
  return (
    <Pressable style={[styles.button, { bottom }]} onPress={onPress} hitSlop={8} accessibilityLabel="Back to top">
      <Text style={styles.arrow}>↑</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    position: 'absolute',
    right: 20,
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: colors.surfaceHigh,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 6,
  },
  arrow: { color: colors.text, fontSize: 22, fontWeight: '700' },
});
