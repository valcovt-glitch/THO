import { useEffect } from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { api } from "../lib/api";
import { getDeviceId } from "../lib/device";
import { getDayPhase, hydrateDayPhase, setDayPhase } from "../lib/day-phase";
import { colors } from "../lib/theme";

export default function Bootstrap() {
  const router = useRouter();

  useEffect(() => {
    let cancelled = false;

    (async () => {
      await hydrateDayPhase();

      try {
        const deviceId = await getDeviceId();
        const response = await api.trucking.shift.current.$get({ query: { deviceId } });
        if (!response.ok) throw new Error("Unable to restore local shift");

        const body = (await response.json()) as any;
        if (cancelled) return;

        if (body.shift) {
          setDayPhase("active");
          router.replace("/(tabs)");
        } else {
          setDayPhase("intro");
          router.replace("/onboarding");
        }
      } catch (error) {
        console.warn("Shift restore failed", error);
        if (cancelled) return;

        // Local fallback: preserve the last active phase if the stored shift cannot be read.
        router.replace(getDayPhase() === "active" ? "/(tabs)" : "/onboarding");
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [router]);

  return (
    <View style={styles.container}>
      <ActivityIndicator color={colors.primary} size="large" />
      <Text style={styles.text}>Obnovujem rozbehnutý deň…</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 14,
    backgroundColor: colors.background,
  },
  text: {
    color: colors.textSecondary,
    fontFamily: "Poppins_500Medium",
    fontSize: 13,
  },
});
