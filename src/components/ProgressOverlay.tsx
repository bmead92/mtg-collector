import { ActivityIndicator, Modal, StyleSheet, Text, View } from "react-native";
import { colors } from "./theme";

interface Props {
  progress: { label: string; done?: number; total?: number } | null;
}

export function ProgressOverlay({ progress }: Props) {
  const total = progress?.total ?? 0;
  const frac = total > 0 ? Math.min(1, (progress?.done ?? 0) / total) : null;
  return (
    <Modal
      visible={!!progress}
      transparent
      animationType="fade"
      onRequestClose={() => {}}
    >
      <View style={styles.backdrop}>
        <View style={styles.card}>
          <Text style={styles.label}>{progress?.label}</Text>
          {frac == null ? (
            <ActivityIndicator color={colors.accent} />
          ) : (
            <>
              <View style={styles.track}>
                <View style={[styles.fill, { width: `${frac * 100}%` }]} />
              </View>
              <Text style={styles.count}>
                {progress?.done?.toLocaleString()} of {total.toLocaleString()} ·{" "}
                {Math.round(frac * 100)}%
              </Text>
            </>
          )}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.6)",
    justifyContent: "center",
    padding: 32,
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 20,
    gap: 12,
  },
  label: { color: colors.text, fontSize: 16, fontWeight: "600" },
  track: {
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.surfaceHigh,
    overflow: "hidden",
  },
  fill: { height: 8, borderRadius: 4, backgroundColor: colors.accent },
  count: { color: colors.textMuted, fontSize: 13 },
});
