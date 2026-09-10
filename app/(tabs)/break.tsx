import { useEffect, useState } from "react";
import { View, Text, StyleSheet, ScrollView, ActivityIndicator } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import { api } from "../../lib/api";
import { getDeviceId } from "../../lib/device";
import { colors, fmtHM } from "../../lib/theme";
import { ProgressBar } from "../../components/ProgressBar";
import { BreakSlotCard, type SlotState } from "../../components/BreakSlotCard";
import { subscribeTransitionSent } from "../../lib/location-task";

export default function BreakScreen() {
  const [deviceId, setDeviceId] = useState<string | null>(null);
  const queryClient = useQueryClient();

  useEffect(() => {
    getDeviceId().then(setDeviceId);
  }, []);

  const status = useQuery({
    queryKey: ["status", deviceId],
    enabled: !!deviceId,
    refetchInterval: 5000,
    queryFn: async () => {
      const res = await api.trucking.status.$get({
        query: {
          deviceId: deviceId!,
          timezoneOffsetMinutes: String(new Date().getTimezoneOffset()),
        },
      });
      const body = (await res.json()) as any;
      return body.status;
    },
  });

  useEffect(() => {
    if (!deviceId) return;
    return subscribeTransitionSent(() => {
      queryClient.invalidateQueries({ queryKey: ["status", deviceId] });
      setTimeout(() => queryClient.invalidateQueries({ queryKey: ["status", deviceId] }), 800);
    });
  }, [deviceId, queryClient]);

  if (!deviceId || status.isLoading) {
    return (
      <SafeAreaView style={styles.center} edges={["top", "left", "right"]}>
        <ActivityIndicator color={colors.primary} size="large" />
      </SafeAreaView>
    );
  }

  if (status.isError || !status.data) {
    return (
      <SafeAreaView style={styles.center} edges={["top", "left", "right"]}>
        <Ionicons name="phone-portrait-outline" size={40} color={colors.textSecondary} />
        <Text style={[styles.bodyText, { marginTop: 12, textAlign: "center", paddingHorizontal: 30 }]}>
          Nepodarilo sa načítať lokálne údaje z telefónu.
        </Text>
      </SafeAreaView>
    );
  }

  const s = status.data;
  const extendedRemaining = s.extendedDrivingDaysRemaining as number;
  const extendedUsed = s.extendedDrivingDaysUsed as number;
  const extendedLimit = s.extendedDrivingDaysLimit as number;
  const completedToday = s.breaksCompletedToday as number;

  const slot1State: SlotState = completedToday >= 1 ? "done" : "live";
  const slot2State: SlotState | null = !s.secondBreakAvailable
    ? null
    : completedToday >= 2
      ? "done"
      : completedToday === 1
        ? "live"
        : "locked";

  return (
    <SafeAreaView style={styles.container} edges={["top", "left", "right"]}>
      <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 40 }}>
        <Text style={styles.heading}>Pauza</Text>
        <Text style={styles.subheading}>Povinná prestávka 45 min — jeden blok, alebo rozdelená 15 + 30 min</Text>

        <BreakSlotCard title="Prvá prestávka" slotState={slot1State} s={s} />

        {slot2State && <BreakSlotCard title="Druhá prestávka (10h deň)" slotState={slot2State} s={s} />}

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Nepretržitá jazda</Text>
          <ProgressBar
            label="Od poslednej prestávky"
            valueLabel={`${fmtHM(s.continuousDrivingSeconds)} / ${fmtHM(s.continuousDrivingLimit)}`}
            ratio={s.continuousDrivingSeconds / s.continuousDrivingLimit}
          />
          {s.breakOverdue && <Text style={[styles.hint, { color: colors.danger }]}>Prestávka je nutná ihneď!</Text>}
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Predĺžená jazda (10 h)</Text>
          <ProgressBar
            label={`Použité tento týždeň`}
            valueLabel={`${extendedUsed} / ${extendedLimit}`}
            ratio={extendedLimit > 0 ? extendedUsed / extendedLimit : 0}
            warnRatio={0.5}
            dangerRatio={1}
          />
          <Text style={styles.hint}>
            {extendedRemaining > 0
              ? `Ešte môžeš ${extendedRemaining}× predĺžiť jazdu na 10 h tento týždeň.`
              : "Tento týždeň si už vyčerpal obe predĺžené (10h) jazdy."}
          </Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Ako to funguje</Text>

          <Text style={styles.exampleTitle}>Príklad 1 — bežný deň</Text>
          <View style={styles.stepsRow}>
            <MaterialCommunityIcons name="steering" size={18} color={colors.primary} />
            <Text style={styles.stepText}>4,5 h jazda</Text>
          </View>
          <View style={styles.stepsRow}>
            <MaterialCommunityIcons name="cup" size={18} color={colors.availability} />
            <Text style={styles.stepText}>45 min pauza</Text>
          </View>
          <View style={styles.stepsRow}>
            <MaterialCommunityIcons name="steering" size={18} color={colors.primary} />
            <Text style={styles.stepText}>4,5 h jazda</Text>
          </View>
          <View style={styles.stepsRow}>
            <MaterialCommunityIcons name="bed" size={18} color={colors.secondary} />
            <Text style={styles.stepText}>Denný odpočinok</Text>
          </View>

          <Text style={[styles.exampleTitle, { marginTop: 16 }]}>Príklad 2 — predĺžený 10h deň</Text>
          <View style={styles.stepsRow}>
            <MaterialCommunityIcons name="steering" size={18} color={colors.primary} />
            <Text style={styles.stepText}>4,5 h jazda</Text>
          </View>
          <View style={styles.stepsRow}>
            <MaterialCommunityIcons name="cup" size={18} color={colors.availability} />
            <Text style={styles.stepText}>45 min pauza (1.)</Text>
          </View>
          <View style={styles.stepsRow}>
            <MaterialCommunityIcons name="steering" size={18} color={colors.primary} />
            <Text style={styles.stepText}>4,5 h jazda</Text>
          </View>
          <View style={styles.stepsRow}>
            <MaterialCommunityIcons name="cup" size={18} color={colors.availability} />
            <Text style={styles.stepText}>45 min pauza (2.)</Text>
          </View>
          <View style={styles.stepsRow}>
            <MaterialCommunityIcons name="steering" size={18} color={colors.primary} />
            <Text style={styles.stepText}>1 h jazda</Text>
          </View>

          <Text style={[styles.hint, { marginTop: 12 }]}>
            Denná jazda je normálne max. 9 h, ale 2× za týždeň môžeš ísť až 10 h (prepínač v
            Nastaveniach) — vtedy sa počas dňa sledujú dve samostatné prestávky za sebou. Prvá
            časť (15 min) sa uzná automaticky presne vo chvíli, keď reálne uplynie 15 min
            súvislej pauzy — nie skôr. Zvyšných 30 min si môžeš dobrať aj neskôr (jazda medzi
            oboma časťami je povolená).
          </Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  center: { flex: 1, backgroundColor: colors.background, alignItems: "center", justifyContent: "center" },
  heading: { color: colors.textPrimary, fontFamily: "Poppins_700Bold", fontSize: 24, marginBottom: 4 },
  subheading: { color: colors.textSecondary, fontFamily: "Poppins_500Medium", fontSize: 13, marginBottom: 18 },
  bodyText: { color: colors.textPrimary, fontFamily: "Poppins_500Medium", fontSize: 14 },
  card: {
    backgroundColor: colors.surface,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 18,
    marginBottom: 14,
  },
  cardTitle: { color: colors.textPrimary, fontFamily: "Poppins_600SemiBold", fontSize: 15, marginBottom: 12 },
  hint: { color: colors.textSecondary, fontFamily: "Poppins_500Medium", fontSize: 12, marginTop: 4, lineHeight: 17 },
  exampleTitle: { color: colors.textPrimary, fontFamily: "Poppins_600SemiBold", fontSize: 13, marginBottom: 8 },
  stepsRow: { flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 8, paddingLeft: 4 },
  stepText: { color: colors.textPrimary, fontFamily: "Poppins_500Medium", fontSize: 13 },
});
