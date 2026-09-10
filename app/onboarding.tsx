import { useEffect, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TextInput,
  Pressable,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Alert,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { useQueryClient } from "@tanstack/react-query";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { api } from "../lib/api";
import { getDeviceId } from "../lib/device";
import { colors } from "../lib/theme";
import { markTrackingStarted } from "../lib/location-task";
import { setDayPhase } from "../lib/day-phase";

export default function Onboarding() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [deviceId, setDeviceId] = useState<string | null>(null);
  const [driverName, setDriverName] = useState("");
  const [plate, setPlate] = useState("");
  const [startKm, setStartKm] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    getDeviceId().then(setDeviceId);
  }, []);

  const canStart = driverName.trim().length > 0 && plate.trim().length > 0 && !submitting;

  const handleStart = async () => {
    if (!deviceId || !canStart) return;
    setSubmitting(true);
    try {
      const parsedKm = startKm.trim() ? Number(startKm.trim()) : undefined;
      const response = await api.trucking.shift.start.$post({
        json: {
          deviceId,
          driverName: driverName.trim(),
          plate: plate.trim(),
          startKm: parsedKm !== undefined && !Number.isNaN(parsedKm) ? parsedKm : undefined,
          timestamp: new Date().toISOString(),
        },
      });
      if (!response.ok) {
        const body = (await response.json()) as any;
        throw new Error(body?.error ?? "Nepodarilo sa spustiť deň");
      }
      queryClient.invalidateQueries({ queryKey: ["status", deviceId] });
      markTrackingStarted();
      setDayPhase("warmup");
      router.replace("/warmup");
    } catch (err: any) {
      Alert.alert("Chyba", err?.message ?? "Nepodarilo sa spustiť deň");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <SafeAreaView style={styles.container} edges={["top", "left", "right", "bottom"]}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : "height"} keyboardVerticalOffset={0}>
        <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 40, flexGrow: 1, justifyContent: "center" }} keyboardShouldPersistTaps="handled">
          <Text style={styles.heading}>Truck Driver Hours</Text>
          <Text style={styles.subheading}>Zadaj údaje pred začiatkom dňa</Text>

          <View style={styles.card}>
            <Text style={styles.label}>Meno a priezvisko vodiča</Text>
            <TextInput
              style={styles.input}
              value={driverName}
              onChangeText={setDriverName}
              placeholder="napr. Ján Novák"
              placeholderTextColor={colors.textSecondary}
            />

            <Text style={[styles.label, { marginTop: 14 }]}>ŠPZ vozidla</Text>
            <TextInput
              style={styles.input}
              value={plate}
              onChangeText={setPlate}
              placeholder="napr. BA123XY"
              placeholderTextColor={colors.textSecondary}
              autoCapitalize="characters"
            />

            <Text style={[styles.label, { marginTop: 14 }]}>Kilometre (voliteľné)</Text>
            <TextInput
              style={styles.input}
              value={startKm}
              onChangeText={setStartKm}
              placeholder="stav km na začiatku"
              placeholderTextColor={colors.textSecondary}
              keyboardType="numeric"
            />
          </View>
        </ScrollView>

        <View style={styles.footer}>
          <Pressable
            disabled={!canStart}
            onPress={handleStart}
            style={({ pressed }) => [styles.startButton, { opacity: canStart ? (pressed ? 0.85 : 1) : 0.4 }]}
          >
            {submitting ? (
              <ActivityIndicator color="#0B1220" />
            ) : (
              <>
                <MaterialCommunityIcons name="play-circle" size={22} color="#0B1220" />
                <Text style={styles.startButtonText}>Začať deň</Text>
              </>
            )}
          </Pressable>
          {!canStart && !submitting && (
            <Text style={styles.footerHint}>Zadaj meno vodiča a ŠPZ pre spustenie dňa</Text>
          )}
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  heading: { color: colors.textPrimary, fontFamily: "Poppins_700Bold", fontSize: 24, marginBottom: 4 },
  subheading: { color: colors.textSecondary, fontFamily: "Poppins_500Medium", fontSize: 13, marginBottom: 18 },
  card: {
    backgroundColor: colors.surface,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 18,
    marginBottom: 14,
  },
  label: { color: colors.textSecondary, fontFamily: "Poppins_500Medium", fontSize: 13, marginBottom: 6 },
  input: {
    backgroundColor: colors.surfaceElevated,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 14,
    paddingVertical: 12,
    color: colors.textPrimary,
    fontFamily: "Poppins_500Medium",
    fontSize: 15,
  },
  footer: {
    padding: 20,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.background,
  },
  startButton: {
    backgroundColor: colors.primary,
    borderRadius: 18,
    paddingVertical: 16,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
  },
  startButtonText: { color: "#0B1220", fontFamily: "Poppins_700Bold", fontSize: 16 },
  footerHint: { color: colors.textSecondary, textAlign: "center", marginTop: 8, fontFamily: "Poppins_500Medium", fontSize: 12 },
});
