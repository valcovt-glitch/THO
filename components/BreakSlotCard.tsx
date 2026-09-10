import { View, Text, StyleSheet } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { colors, fmtHM } from "../lib/theme";

export type SlotState = "live" | "done" | "locked";

const TOTAL = 45 * 60;
const FIRST_PART = 15 * 60;

function BreakBar({ elapsedSeconds }: { elapsedSeconds: number }) {
  const elapsed = Math.min(Math.max(elapsedSeconds, 0), TOTAL);
  const firstZoneWidth = (Math.min(elapsed, FIRST_PART) / TOTAL) * 100;
  const secondZoneWidth = (Math.max(0, elapsed - FIRST_PART) / TOTAL) * 100;
  const markerPos = (FIRST_PART / TOTAL) * 100;

  return (
    <View style={styles.track}>
      <View style={{ width: `${firstZoneWidth}%`, height: "100%", backgroundColor: colors.availability }} />
      <View style={{ width: `${secondZoneWidth}%`, height: "100%", backgroundColor: colors.secondary }} />
      <View style={[styles.marker, { left: `${markerPos}%` }]} />
    </View>
  );
}

export function BreakSlotCard({ title, slotState, s }: { title: string; slotState: SlotState; s: any }) {
  // Elapsed time within the unified 0-45 min bar, regardless of which internal backend state
  // ("none" before 15 min, "firstDone" after) is currently active.
  const elapsedSeconds =
    s.breakState === "firstDone"
      ? FIRST_PART + (s.breakSecondPartAccumSeconds ?? 0)
      : s.breakState === "firstPending"
        ? s.breakFirstPartAccumSeconds ?? 0
        : s.breakAccumSeconds ?? 0;
  const pastFirstPart = elapsedSeconds >= FIRST_PART;

  return (
    <View style={styles.card}>
      <Text style={styles.cardTitle}>{title}</Text>

      {slotState === "locked" && (
        <View style={styles.partBadge}>
          <Ionicons name="lock-closed" size={16} color={colors.textSecondary} />
          <Text style={[styles.partBadgeText, { color: colors.textSecondary }]}>Dostupné po prvej prestávke</Text>
        </View>
      )}

      {slotState === "done" && (
        <View style={styles.partBadge}>
          <Ionicons name="checkmark-circle" size={16} color={colors.secondary} />
          <Text style={[styles.partBadgeText, { color: colors.secondary }]}>Splnená dnes ✓</Text>
        </View>
      )}

      {slotState === "live" && (
        <>
          <View style={styles.headerRow}>
            <Text style={styles.label}>Prestávka (cieľ 45 min)</Text>
            <Text style={[styles.value, { color: pastFirstPart ? colors.secondary : colors.availability }]}>
              {fmtHM(elapsedSeconds)} / {fmtHM(TOTAL)}
            </Text>
          </View>
          <BreakBar elapsedSeconds={elapsedSeconds} />
          {pastFirstPart ? (
            <Text style={[styles.hint, { color: colors.secondary }]}>
              Môžeš vyraziť, ak chceš — prvých 15 min je splnených. Ak počkáš, ostáva ti už len
              {" "}
              {fmtHM(Math.max(0, TOTAL - elapsedSeconds))} do celej prestávky.
            </Text>
          ) : (
            <Text style={styles.hint}>
              Prvých 15 min súvislej pauzy sa počíta ako prvá časť prestávky — po jej splnení
              môžeš vyraziť, ak chceš, alebo pokojne počkať na celú 45-min prestávku.
            </Text>
          )}
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 18,
    marginBottom: 14,
  },
  cardTitle: { color: colors.textPrimary, fontFamily: "Poppins_600SemiBold", fontSize: 15, marginBottom: 12 },
  headerRow: { flexDirection: "row", justifyContent: "space-between", marginBottom: 6 },
  label: { color: colors.textSecondary, fontFamily: "Poppins_500Medium", fontSize: 13 },
  value: { fontFamily: "Poppins_600SemiBold", fontSize: 13 },
  track: {
    flexDirection: "row",
    height: 10,
    borderRadius: 6,
    backgroundColor: colors.surfaceElevated,
    overflow: "hidden",
    position: "relative",
  },
  marker: {
    position: "absolute",
    top: 0,
    bottom: 0,
    width: 2,
    backgroundColor: colors.background,
  },
  hint: { color: colors.textSecondary, fontFamily: "Poppins_500Medium", fontSize: 12, marginTop: 8, lineHeight: 17 },
  partBadge: { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 4 },
  partBadgeText: { fontFamily: "Poppins_600SemiBold", fontSize: 13 },
});
