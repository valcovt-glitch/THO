import { View, Text, StyleSheet } from "react-native";
import { colors } from "../lib/theme";

export function ProgressBar({
  label,
  valueLabel,
  ratio,
  dangerRatio = 0.9,
  warnRatio = 0.7,
}: {
  label: string;
  valueLabel: string;
  ratio: number; // 0..1+
  dangerRatio?: number;
  warnRatio?: number;
}) {
  const clamped = Math.min(1, Math.max(0, ratio));
  const barColor = ratio >= dangerRatio ? colors.danger : ratio >= warnRatio ? colors.warning : colors.secondary;

  return (
    <View style={styles.container}>
      <View style={styles.headerRow}>
        <Text style={styles.label}>{label}</Text>
        <Text style={[styles.value, { color: barColor }]}>{valueLabel}</Text>
      </View>
      <View style={styles.track}>
        <View style={[styles.fill, { width: `${clamped * 100}%`, backgroundColor: barColor }]} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { marginBottom: 16 },
  headerRow: { flexDirection: "row", justifyContent: "space-between", marginBottom: 6 },
  label: { color: colors.textSecondary, fontFamily: "Poppins_500Medium", fontSize: 13 },
  value: { fontFamily: "Poppins_600SemiBold", fontSize: 13 },
  track: { height: 10, borderRadius: 6, backgroundColor: colors.surfaceElevated, overflow: "hidden" },
  fill: { height: "100%", borderRadius: 6 },
});
