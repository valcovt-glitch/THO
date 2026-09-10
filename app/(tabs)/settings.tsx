import { useEffect, useState } from "react";
import { View, Text, StyleSheet, Switch, ActivityIndicator, ScrollView } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../../lib/api";
import { getDeviceId } from "../../lib/device";
import { colors } from "../../lib/theme";

export default function Settings() {
  const [deviceId, setDeviceId] = useState<string | null>(null);
  const queryClient = useQueryClient();

  useEffect(() => {
    getDeviceId().then(setDeviceId);
  }, []);

  const settings = useQuery({
    queryKey: ["settings", deviceId],
    enabled: !!deviceId,
    queryFn: async () => {
      const res = await api.trucking.settings.$get({ query: { deviceId: deviceId! } });
      const body = (await res.json()) as any;
      return body.settings;
    },
  });

  const update = useMutation({
    mutationFn: async (patch: { extendedDrivingEnabled?: boolean; reducedRestEnabled?: boolean }) => {
      const res = await api.trucking.settings.$put({ json: { deviceId: deviceId!, ...patch } });
      const body = (await res.json()) as any;
      return body.settings;
    },
    onSuccess: (data) => queryClient.setQueryData(["settings", deviceId], data),
  });

  if (!deviceId || settings.isLoading) {
    return (
      <SafeAreaView style={styles.center} edges={["top", "left", "right"]}>
        <ActivityIndicator color={colors.primary} size="large" />
      </SafeAreaView>
    );
  }

  const s = settings.data;

  return (
    <SafeAreaView style={styles.container} edges={["top", "left", "right"]}>
      <ScrollView contentContainerStyle={{ padding: 20 }}>
        <Text style={styles.heading}>Nastavenia</Text>

        <View style={styles.card}>
          <View style={styles.rowBetween}>
            <View style={{ flex: 1, paddingRight: 12 }}>
              <Text style={styles.rowTitle}>Predĺžená denná jazda (10 h)</Text>
              <Text style={styles.rowDesc}>Povolené max 2× v týždni podľa nariadenia — potvrď len ak dnes túto výnimku využívaš.</Text>
            </View>
            <Switch
              value={!!s?.extendedDrivingEnabled}
              onValueChange={(v) => update.mutate({ extendedDrivingEnabled: v })}
              trackColor={{ false: colors.surfaceElevated, true: colors.primary }}
            />
          </View>
        </View>

        <View style={styles.card}>
          <View style={styles.rowBetween}>
            <View style={{ flex: 1, paddingRight: 12 }}>
              <Text style={styles.rowTitle}>Skrátený denný odpočinok (9 h)</Text>
              <Text style={styles.rowDesc}>Povolené max 3× medzi dvoma týždennými odpočinkami — potvrď len ak túto výnimku využívaš.</Text>
            </View>
            <Switch
              value={!!s?.reducedRestEnabled}
              onValueChange={(v) => update.mutate({ reducedRestEnabled: v })}
              trackColor={{ false: colors.surfaceElevated, true: colors.primary }}
            />
          </View>
        </View>

        <View style={styles.card}>
          <Text style={styles.rowTitle}>Dáta a aktualizácie</Text>
          <Text style={styles.rowDesc}>
            Všetky zmeny, prestávky, história a nastavenia zostávajú iba v tomto telefóne.
            Pri otvorení aplikácia kontroluje novú verziu na GitHube; aktualizáciu potom potvrdíš v Androide.
          </Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.rowTitle}>ID lokálneho zariadenia</Text>
          <Text style={styles.rowDesc}>{deviceId}</Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.rowTitle}>O aplikácii</Text>
          <Text style={styles.rowDesc}>
            Appka je pomocník na orientačné sledovanie jazdy a odpočinku podľa nariadenia EÚ 561/2006.
            Strážca týždenného odpočinku automaticky sleduje pravidelný a skrátený odpočinok,
            kompenzáciu aj základné dvojtýždenné pravidlo. Nejde o certifikovaný tachograf;
            medzinárodné a osobitné výnimky vyžadujú ďalšie údaje a odborné posúdenie.
          </Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  center: { flex: 1, backgroundColor: colors.background, alignItems: "center", justifyContent: "center" },
  heading: { color: colors.textPrimary, fontFamily: "Poppins_700Bold", fontSize: 24, marginBottom: 16 },
  card: {
    backgroundColor: colors.surface,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 18,
    marginBottom: 14,
  },
  rowBetween: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  rowTitle: { color: colors.textPrimary, fontFamily: "Poppins_600SemiBold", fontSize: 15, marginBottom: 6 },
  rowDesc: { color: colors.textSecondary, fontFamily: "Poppins_500Medium", fontSize: 13, lineHeight: 19 },
});
