import { useEffect, useState } from "react";
import { View, Text, StyleSheet, FlatList, ActivityIndicator, Pressable, Alert } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import { api } from "../../lib/api";
import { getDeviceId } from "../../lib/device";
import { colors, fmtHM, statusColor, statusLabel, statusIcon, type SessionType } from "../../lib/theme";
import { ProgressBar } from "../../components/ProgressBar";
import { subscribeTransitionSent } from "../../lib/location-task";

type SessionRow = {
  id: number;
  type: SessionType;
  source: "auto" | "manual";
  startTime: string;
  endTime: string | null;
};

const CATEGORIES: SessionType[] = ["driving", "work", "availability", "rest"];

function startOfToday() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

export default function History() {
  const [deviceId, setDeviceId] = useState<string | null>(null);
  const queryClient = useQueryClient();

  useEffect(() => {
    getDeviceId().then(setDeviceId);
  }, []);

  const history = useQuery({
    queryKey: ["history", deviceId],
    enabled: !!deviceId,
    refetchInterval: 5000,
    queryFn: async () => {
      const res = await api.trucking.history.$get({ query: { deviceId: deviceId!, days: "1" } });
      const body = (await res.json()) as any;
      return body.sessions as SessionRow[];
    },
  });

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
      queryClient.invalidateQueries({ queryKey: ["history", deviceId] });
      setTimeout(() => {
        queryClient.invalidateQueries({ queryKey: ["status", deviceId] });
        queryClient.invalidateQueries({ queryKey: ["history", deviceId] });
      }, 800);
    });
  }, [deviceId, queryClient]);

  const remove = useMutation({
    mutationFn: async (id: number) => {
      const response = await api.trucking.sessions[":deviceId"][":id"].$delete({
        param: { deviceId: deviceId!, id: String(id) },
      });
      if (!response.ok) throw new Error("Záznam sa nepodarilo zmazať");
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["history", deviceId] }),
  });

  if (!deviceId || history.isLoading || status.isLoading) {
    return (
      <SafeAreaView style={styles.center} edges={["top", "left", "right"]}>
        <ActivityIndicator color={colors.primary} size="large" />
      </SafeAreaView>
    );
  }

  const todayStart = startOfToday();
  const now = new Date();
  const rows = (history.data ?? [])
    .filter((r) => new Date(r.startTime) >= todayStart)
    .sort((a, b) => new Date(b.startTime).getTime() - new Date(a.startTime).getTime());

  const totals: Record<SessionType, number> = { driving: 0, work: 0, availability: 0, rest: 0 };
  for (const r of rows) {
    const start = new Date(r.startTime);
    const end = r.endTime ? new Date(r.endTime) : now;
    totals[r.type] += Math.max(0, (end.getTime() - start.getTime()) / 1000);
  }

  const s = status.data;
  const drivingRemaining = s ? Math.max(0, s.dailyDrivingLimit - s.dailyDrivingSeconds) : null;
  const continuousRemaining = s ? Math.max(0, s.continuousDrivingLimit - s.continuousDrivingSeconds) : null;
  const weeklyRemaining = s ? Math.max(0, s.weeklyDrivingLimit - s.weeklyDrivingSeconds) : null;

  return (
    <SafeAreaView style={styles.container} edges={["top", "left", "right"]}>
      <FlatList
        data={rows}
        keyExtractor={(item) => String(item.id)}
        contentContainerStyle={{ padding: 20, paddingBottom: 40 }}
        ListHeaderComponent={
          <View>
            <Text style={styles.heading}>História</Text>
            <Text style={styles.subheading}>Dnešný deň, {todayStart.toLocaleDateString("sk-SK", { weekday: "long", day: "numeric", month: "long" })}</Text>

            <View style={styles.card}>
              <Text style={styles.cardTitle}>Prehľad dňa</Text>
              {CATEGORIES.map((type) => (
                <View key={type} style={styles.statRow}>
                  <View style={[styles.statIconWrap, { borderColor: statusColor(type) }]}>
                    <MaterialCommunityIcons name={statusIcon(type) as any} size={16} color={statusColor(type)} />
                  </View>
                  <Text style={styles.statLabel}>{statusLabel(type)}</Text>
                  <Text style={[styles.statValue, { color: statusColor(type) }]}>{fmtHM(totals[type])}</Text>
                </View>
              ))}
            </View>

            {s && (
              <View style={styles.card}>
                <Text style={styles.cardTitle}>Koľko ešte ostáva</Text>
                <ProgressBar
                  label="Denná jazda"
                  valueLabel={`zostáva ${fmtHM(drivingRemaining!)}`}
                  ratio={s.dailyDrivingSeconds / s.dailyDrivingLimit}
                />
                <ProgressBar
                  label="Nepretržitá jazda do prestávky"
                  valueLabel={`zostáva ${fmtHM(continuousRemaining!)}`}
                  ratio={s.continuousDrivingSeconds / s.continuousDrivingLimit}
                />
                <ProgressBar
                  label="Prestávka (cieľ 45 min)"
                  valueLabel={`vyčerpané ${fmtHM(s.breakAccumSeconds)} · zostáva ${fmtHM(s.breakRemainingSeconds)}`}
                  ratio={s.breakAccumSeconds / s.breakRequiredSeconds}
                  warnRatio={1.1}
                  dangerRatio={1.2}
                />
                <ProgressBar
                  label="Týždenná jazda"
                  valueLabel={`zostáva ${fmtHM(weeklyRemaining!)}`}
                  ratio={s.weeklyDrivingSeconds / s.weeklyDrivingLimit}
                />
                <Text style={styles.hint}>
                  Prehľad zobrazuje zaznamenané aktivity. Aplikácia nenahrádza tachograf ani úplnú evidenciu pracovného času.
                </Text>
              </View>
            )}

            <Text style={styles.sectionTitle}>Záznamy dnes</Text>
          </View>
        }
        ListEmptyComponent={
          <View style={styles.emptyBox}>
            <Text style={styles.emptyText}>Dnes zatiaľ žiadne záznamy</Text>
          </View>
        }
        renderItem={({ item }) => {
          const start = new Date(item.startTime);
          const end = item.endTime ? new Date(item.endTime) : null;
          const durationSeconds = ((end ?? now).getTime() - start.getTime()) / 1000;
          return (
            <View style={styles.row}>
              <View style={[styles.typeIconWrap, { borderColor: statusColor(item.type) }]}>
                <MaterialCommunityIcons name={statusIcon(item.type) as any} size={16} color={statusColor(item.type)} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.rowType, { color: statusColor(item.type) }]}>{statusLabel(item.type)}</Text>
                <Text style={styles.rowTime}>
                  {start.toLocaleTimeString("sk-SK", { hour: "2-digit", minute: "2-digit" })} –{" "}
                  {end ? end.toLocaleTimeString("sk-SK", { hour: "2-digit", minute: "2-digit" }) : "prebieha"}
                  {item.source === "manual" ? "  (upravené)" : ""}
                </Text>
              </View>
              <Text style={styles.rowDuration}>{fmtHM(durationSeconds)}</Text>
              <Pressable
                onPress={() =>
                  Alert.alert("Zmazať záznam?", "Táto akcia sa nedá vrátiť späť.", [
                    { text: "Zrušiť", style: "cancel" },
                    { text: "Zmazať", style: "destructive", onPress: () => remove.mutate(item.id) },
                  ])
                }
                style={{ padding: 8 }}
              >
                <Ionicons name="trash-outline" size={18} color={colors.textSecondary} />
              </Pressable>
            </View>
          );
        }}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  center: { flex: 1, backgroundColor: colors.background, alignItems: "center", justifyContent: "center" },
  heading: { color: colors.textPrimary, fontFamily: "Poppins_700Bold", fontSize: 24 },
  subheading: { color: colors.textSecondary, fontFamily: "Poppins_500Medium", fontSize: 13, marginTop: 2, marginBottom: 16, textTransform: "capitalize" },
  emptyBox: { alignItems: "center", justifyContent: "center", paddingVertical: 30 },
  emptyText: { color: colors.textSecondary, fontFamily: "Poppins_500Medium" },
  sectionTitle: { color: colors.textPrimary, fontFamily: "Poppins_600SemiBold", fontSize: 15, marginBottom: 10, marginTop: 4 },
  card: {
    backgroundColor: colors.surface,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 18,
    marginBottom: 14,
  },
  cardTitle: { color: colors.textPrimary, fontFamily: "Poppins_600SemiBold", fontSize: 15, marginBottom: 12 },
  statRow: { flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 10 },
  statIconWrap: { width: 28, height: 28, borderRadius: 14, borderWidth: 1.5, alignItems: "center", justifyContent: "center" },
  statLabel: { flex: 1, color: colors.textPrimary, fontFamily: "Poppins_500Medium", fontSize: 13 },
  statValue: { fontFamily: "Poppins_700Bold", fontSize: 14 },
  hint: { color: colors.textSecondary, fontFamily: "Poppins_500Medium", fontSize: 12, marginTop: 4, lineHeight: 17 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 14,
    marginBottom: 8,
    gap: 12,
  },
  typeIconWrap: {
    width: 30,
    height: 30,
    borderRadius: 15,
    borderWidth: 1.5,
    alignItems: "center",
    justifyContent: "center",
  },
  rowType: { fontFamily: "Poppins_600SemiBold", fontSize: 14 },
  rowTime: { color: colors.textSecondary, fontFamily: "Poppins_500Medium", fontSize: 12, marginTop: 2 },
  rowDuration: { color: colors.textPrimary, fontFamily: "Poppins_600SemiBold", fontSize: 14, marginRight: 4 },
});
