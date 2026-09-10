import { useEffect, useState } from "react";
import { View, Text, StyleSheet } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import { colors } from "../lib/theme";
import { getGpsSnapshot, getWarmupRemainingMs } from "../lib/location-task";
import { setDayPhase } from "../lib/day-phase";

export default function Warmup() {
  const router = useRouter();
  const [remainingMs, setRemainingMs] = useState(getWarmupRemainingMs());
  const [gps, setGps] = useState(getGpsSnapshot());

  useEffect(() => {
    const interval = setInterval(() => {
      const remaining = getWarmupRemainingMs();
      setRemainingMs(remaining);
      setGps(getGpsSnapshot());
      if (remaining <= 0) {
        clearInterval(interval);
        setDayPhase("active");
        router.replace("/(tabs)");
      }
    }, 1000);
    return () => clearInterval(interval);
  }, [router]);

  const seconds = Math.ceil(remainingMs / 1000);
  const gpsColor = gps.status === "ok" ? colors.secondary : gps.status === "weak" ? colors.warning : colors.danger;
  const gpsLabel = gps.status === "ok" ? "GPS OK" : gps.status === "weak" ? "Slabý GPS" : "Hľadám signál…";

  return (
    <SafeAreaView style={styles.container} edges={["top", "left", "right", "bottom"]}>
      <View style={styles.center}>
        <MaterialCommunityIcons name="satellite-variant" size={64} color={colors.availability} />
        <Text style={styles.heading}>GPS sa zohrieva</Text>
        <Text style={styles.subheading}>Počkaj, kým zariadenie zachytí presnú polohu.{"\n"}Automatické sledovanie jazdy začne za chvíľu.</Text>

        <Text style={styles.countdown}>{seconds}s</Text>

        <View style={styles.gpsChip}>
          <Ionicons name={gps.status === "ok" ? "checkmark-circle" : gps.status === "weak" ? "alert-circle" : "close-circle"} size={20} color={gpsColor} />
          <Text style={[styles.gpsText, { color: gpsColor }]}>{gpsLabel}</Text>
          {gps.accuracy !== null && <Text style={styles.gpsAccuracy}>±{Math.round(gps.accuracy)} m</Text>}
        </View>

        <Text style={styles.restHint}>Počas zahrievania sa počíta odpočinok</Text>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: 30 },
  heading: { color: colors.textPrimary, fontFamily: "Poppins_700Bold", fontSize: 22, marginTop: 20 },
  subheading: {
    color: colors.textSecondary,
    fontFamily: "Poppins_500Medium",
    fontSize: 14,
    textAlign: "center",
    marginTop: 10,
    lineHeight: 20,
  },
  countdown: { color: colors.availability, fontFamily: "Poppins_700Bold", fontSize: 56, marginTop: 30 },
  gpsChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 999,
    paddingHorizontal: 16,
    paddingVertical: 10,
    marginTop: 24,
  },
  gpsText: { fontFamily: "Poppins_600SemiBold", fontSize: 14 },
  gpsAccuracy: { color: colors.textSecondary, fontFamily: "Poppins_500Medium", fontSize: 13 },
  restHint: { color: colors.textSecondary, fontFamily: "Poppins_500Medium", fontSize: 12, marginTop: 24 },
});
