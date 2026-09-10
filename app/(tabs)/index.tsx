import { useEffect, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, Alert, Modal, TextInput, KeyboardAvoidingView, Platform } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { MaterialCommunityIcons, Ionicons } from "@expo/vector-icons";
import * as FileSystem from "expo-file-system/legacy";
import * as Sharing from "expo-sharing";
import { api } from "../../lib/api";
import { getDeviceId } from "../../lib/device";
import { colors, fmtHM, statusColor, statusLabel, statusIcon, type SessionType } from "../../lib/theme";
import { ProgressBar } from "../../components/ProgressBar";
import { ActivitySwitcher } from "../../components/ActivitySwitcher";
import { BreakSlotCard, type SlotState } from "../../components/BreakSlotCard";
import { checkStatusAndNotify } from "../../lib/notifications";
import { getGpsSnapshot, subscribeTransitionSent } from "../../lib/location-task";
import { useDayPhase, setDayPhase } from "../../lib/day-phase";
import { buildShiftReportText } from "../../lib/report";

function useGpsSnapshot() {
  const [snapshot, setSnapshot] = useState(getGpsSnapshot());
  useEffect(() => {
    const interval = setInterval(() => setSnapshot(getGpsSnapshot()), 1000);
    return () => clearInterval(interval);
  }, []);
  return snapshot;
}

function fmtDateTime(value: string) {
  return new Date(value).toLocaleString("sk-SK", { dateStyle: "medium", timeStyle: "short" });
}

export default function Home() {
  const router = useRouter();
  const [deviceId, setDeviceId] = useState<string | null>(null);
  const queryClient = useQueryClient();
  const gps = useGpsSnapshot();
  const dayPhase = useDayPhase();
  const dayEnded = dayPhase === "ended";
  const [endDayModalOpen, setEndDayModalOpen] = useState(false);
  const [endKm, setEndKm] = useState("");

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

  // Refresh the instant an auto driving/work switch is decided, instead of waiting for the
  // next scheduled poll — the extra delayed refetch catches up once the write has landed.
  useEffect(() => {
    if (!deviceId) return;
    return subscribeTransitionSent(() => {
      queryClient.invalidateQueries({ queryKey: ["status", deviceId] });
      setTimeout(() => queryClient.invalidateQueries({ queryKey: ["status", deviceId] }), 800);
    });
  }, [deviceId, queryClient]);

  const shift = useQuery({
    queryKey: ["shift-current", deviceId],
    enabled: !!deviceId,
    queryFn: async () => {
      const res = await api.trucking.shift.current.$get({ query: { deviceId: deviceId! } });
      const body = (await res.json()) as any;
      return body.shift as {
        id: number;
        driverName: string | null;
        plate: string | null;
        startKm: number | null;
        startedAt: string;
      } | null;
    },
  });

  useEffect(() => {
    if (status.data) void checkStatusAndNotify(status.data as any);
  }, [status.data]);

  useEffect(() => {
    if (!deviceId || shift.isLoading || shift.isError || shift.data) return;
    setDayPhase("intro");
    router.replace("/onboarding");
  }, [deviceId, router, shift.data, shift.isError, shift.isLoading]);

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["status", deviceId] });
    queryClient.invalidateQueries({ queryKey: ["history", deviceId] });
    queryClient.invalidateQueries({ queryKey: ["shift-current", deviceId] });
  };

  const onActionError = (err: any) => Alert.alert("Chyba", err?.message ?? "Akcia sa nepodarila");

  const finishWork = useMutation({
    mutationFn: async () => {
      const res = await api.trucking["finish-work"].$post({ json: { deviceId: deviceId! } });
      if (!res.ok) throw new Error(((await res.json()) as any)?.error ?? "Chyba");
      return res.json();
    },
    onSuccess: invalidate,
    onError: onActionError,
  });

  const setActivity = useMutation({
    mutationFn: async (type: SessionType) => {
      const res = await api.trucking["set-activity"].$post({ json: { deviceId: deviceId!, type } });
      if (!res.ok) throw new Error(((await res.json()) as any)?.error ?? "Chyba");
      return res.json();
    },
    onSuccess: invalidate,
    onError: onActionError,
  });

  const endDay = useMutation({
    mutationFn: async () => {
      const parsedKm = endKm.trim() ? Number(endKm.trim()) : undefined;
      if (!shift.data) throw new Error("Nepodarilo sa načítať rozbehnutý deň");

      // Snapshot driver/plate/km + category totals before ending the day, so the
      // saved report reflects this shift even after the shift record closes.
      const driverName = shift.data?.driverName ?? null;
      const plate = shift.data?.plate ?? null;
      const startKm = shift.data?.startKm ?? null;
      const startedAt = shift.data?.startedAt ? new Date(shift.data.startedAt) : new Date();
      const endedAt = new Date();

      const historyRes = await api.trucking.history.$get({
        query: { deviceId: deviceId!, from: startedAt.toISOString() },
      });
      if (!historyRes.ok) throw new Error("Nepodarilo sa načítať záznamy zmeny");
      const historyBody = (await historyRes.json()) as any;
      const totals: Record<SessionType, number> = { driving: 0, work: 0, availability: 0, rest: 0 };
      for (const row of historyBody.sessions ?? []) {
        const rowStart = new Date(row.startTime);
        const rowEnd = row.endTime ? new Date(row.endTime) : endedAt;
        const clippedStart = rowStart > startedAt ? rowStart : startedAt;
        const clippedEnd = rowEnd < endedAt ? rowEnd : endedAt;
        if (clippedEnd > clippedStart) {
          totals[row.type as SessionType] += (clippedEnd.getTime() - clippedStart.getTime()) / 1000;
        }
      }

      const response = await api.trucking.shift.end.$post({
        json: {
          deviceId: deviceId!,
          endKm: parsedKm !== undefined && !Number.isNaN(parsedKm) ? parsedKm : undefined,
          timestamp: endedAt.toISOString(),
        },
      });
      if (!response.ok) throw new Error(((await response.json()) as any)?.error ?? "Chyba");

      // Save + share a plain-text summary of the exact shift interval (including overnight shifts).
      try {
        const reportText = buildShiftReportText({
          driverName,
          plate,
          startKm,
          endKm: parsedKm !== undefined && !Number.isNaN(parsedKm) ? parsedKm : null,
          totals,
          startedAt,
          endedAt,
        });
        const fileName = `truck-report-${endedAt.toISOString().slice(0, 10)}-${endedAt.getTime()}.txt`;
        const fileUri = `${FileSystem.documentDirectory}${fileName}`;
        await FileSystem.writeAsStringAsync(fileUri, reportText, { encoding: "utf8" });
        if (await Sharing.isAvailableAsync()) {
          await Sharing.shareAsync(fileUri, { mimeType: "text/plain", dialogTitle: "Uložiť súhrn dňa" });
        }
      } catch (err) {
        console.warn("Failed to save/share shift report", err);
      }

      return response.json();
    },
    onSuccess: () => {
      invalidate();
      setDayPhase("intro");
      setEndDayModalOpen(false);
      setEndKm("");
      router.replace("/onboarding");
    },
    onError: onActionError,
  });

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
        <Text style={[styles.bodyText, { marginTop: 12, marginBottom: 16, textAlign: "center", paddingHorizontal: 30 }]}>
          Nepodarilo sa načítať lokálne údaje z telefónu.
        </Text>
        <Pressable
          onPress={() => status.refetch()}
          style={{ backgroundColor: colors.primary, borderRadius: 14, paddingVertical: 12, paddingHorizontal: 24 }}
        >
          <Text style={{ color: "#0B1220", fontFamily: "Poppins_700Bold" }}>Skúsiť znova</Text>
        </Pressable>
      </SafeAreaView>
    );
  }

  const s = status.data;
  const current = s.currentSession;
  const isDriving = current?.type === "driving";
  const isAvailability = current?.type === "availability";
  const isWork = current?.type === "work";
  const isResting = current?.type === "rest";
  const canFinishWork = !dayEnded && (isAvailability || isWork);
  const pending = finishWork.isPending;
  const weeklyGuardianDanger = s.weeklyRestOverdue || s.compensationOverdue || s.weeklyRestTwoWeekViolation;
  const weeklyGuardianWarning = !weeklyGuardianDanger && (s.weeklyRestWarning || s.compensationWarning);
  const weeklyGuardianColor = weeklyGuardianDanger
    ? colors.danger
    : weeklyGuardianWarning
      ? colors.warning
      : colors.secondary;

  return (
    <SafeAreaView style={styles.container} edges={["top", "left", "right"]}>
      <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 220 }}>
        <Text style={styles.heading}>Truck Driver Hours</Text>

        {shift.data && (shift.data.driverName || shift.data.plate) && (
          <View style={styles.driverRow}>
            {shift.data.driverName && (
              <View style={styles.driverChip}>
                <View style={styles.avatarCircle}>
                  <Ionicons name="person" size={16} color={colors.background} />
                </View>
                <Text style={styles.driverChipText} numberOfLines={1}>
                  {shift.data.driverName}
                </Text>
              </View>
            )}
            {shift.data.plate && (
              <View style={styles.driverChip}>
                <View style={[styles.avatarCircle, { backgroundColor: colors.primary }]}>
                  <MaterialCommunityIcons name="truck" size={16} color={colors.background} />
                </View>
                <Text style={styles.driverChipText} numberOfLines={1}>
                  {shift.data.plate}
                </Text>
              </View>
            )}
          </View>
        )}

        {dayEnded && (
          <View style={styles.endedBanner}>
            <MaterialCommunityIcons name="moon-waning-crescent" size={18} color={colors.secondary} />
            <Text style={styles.endedText}>Deň ukončený — počíta sa už len odpočinok</Text>
          </View>
        )}

        <View style={styles.metaRow}>
          <View style={styles.metaChip}>
            <Ionicons
              name={gps.status === "ok" ? "checkmark-circle" : gps.status === "weak" ? "alert-circle" : "close-circle"}
              size={18}
              color={gps.status === "ok" ? colors.secondary : gps.status === "weak" ? colors.warning : colors.danger}
            />
            <Text
              style={[
                styles.metaText,
                { color: gps.status === "ok" ? colors.secondary : gps.status === "weak" ? colors.warning : colors.danger },
              ]}
            >
              {gps.status === "ok" ? "GPS OK" : gps.status === "weak" ? "Slabý GPS" : "Bez GPS"}
            </Text>
          </View>
          <View style={styles.metaChip}>
            <MaterialCommunityIcons name="crosshairs-gps" size={18} color={colors.textPrimary} />
            <Text style={styles.metaText}>{gps.accuracy !== null ? `±${Math.round(gps.accuracy)} m` : "-- m"}</Text>
          </View>
          <View style={styles.metaChip}>
            <MaterialCommunityIcons name="speedometer" size={18} color={colors.textPrimary} />
            <Text style={styles.metaText}>{gps.speedKmh !== null ? `${Math.round(gps.speedKmh)} km/h` : "-- km/h"}</Text>
          </View>
        </View>

        <View style={[styles.statusPill, { borderColor: statusColor(current?.type) }]}>
          <MaterialCommunityIcons name={statusIcon(current?.type) as any} size={24} color={statusColor(current?.type)} />
          <Text style={[styles.statusText, { color: statusColor(current?.type) }]}>{statusLabel(current?.type)}</Text>
          {current && <Text style={styles.statusElapsed}>{fmtHM(current.elapsedSeconds)}</Text>}
        </View>

        <View style={styles.card}>
          <ActivitySwitcher
            current={current?.type as SessionType | undefined}
            onSelect={(t) => setActivity.mutate(t)}
            pending={setActivity.isPending}
            disabled={dayEnded}
          />
        </View>

        {isResting && s.restProgress && (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Priebeh odpočinku</Text>
            <ProgressBar
              label="Denný odpočinok (cieľ)"
              valueLabel={`${fmtHM(s.restProgress.elapsedSeconds)} / ${fmtHM(s.restProgress.dailyRestThreshold)}`}
              ratio={s.restProgress.elapsedSeconds / s.restProgress.dailyRestThreshold}
              warnRatio={1.1}
              dangerRatio={1.2}
            />
            <Text style={styles.hint}>
              {s.restProgress.satisfiesDaily ? "Denný odpočinok splnený ✓" : "Ešte nesplnený denný odpočinok"}
            </Text>
            <View style={styles.progressGap}>
              <ProgressBar
                label="Týždenný odpočinok (minimum)"
                valueLabel={`${fmtHM(s.restProgress.elapsedSeconds)} / ${fmtHM(s.restProgress.weeklyRestThreshold)}`}
                ratio={s.restProgress.elapsedSeconds / s.restProgress.weeklyRestThreshold}
                warnRatio={1.9}
                dangerRatio={2.1}
              />
            </View>
            <Text style={styles.hint}>
              {s.restProgress.satisfiesWeekly
                ? "Skrátený týždenný odpočinok je splnený; pravidelný trvá aspoň 45 h."
                : "Na započítanie ako skrátený týždenný odpočinok potrebuješ aspoň 24 h vcelku."}
            </Text>
          </View>
        )}

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Nepretržitá jazda</Text>
          <ProgressBar
            label="Od poslednej prestávky"
            valueLabel={`${fmtHM(s.continuousDrivingSeconds)} / ${fmtHM(s.continuousDrivingLimit)}`}
            ratio={s.continuousDrivingSeconds / s.continuousDrivingLimit}
          />
          {s.breakOverdue && <Text style={[styles.hint, { color: colors.danger }]}>Prestávka je nutná ihneď!</Text>}
          {s.needsBreakSoon && !s.breakOverdue && (
            <Text style={[styles.hint, { color: colors.warning }]}>Čoskoro treba prestávku (45 min)</Text>
          )}
        </View>

        <BreakSlotCard
          title="Prvá prestávka"
          slotState={(s.breaksCompletedToday >= 1 ? "done" : "live") as SlotState}
          s={s}
        />

        {s.secondBreakAvailable && (
          <BreakSlotCard
            title="Druhá prestávka (10h deň)"
            slotState={
              (s.breaksCompletedToday >= 2 ? "done" : s.breaksCompletedToday === 1 ? "live" : "locked") as SlotState
            }
            s={s}
          />
        )}

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Dnešná jazda</Text>
          <ProgressBar
            label="Od začiatku pracovného dňa"
            valueLabel={`${fmtHM(s.dailyDrivingSeconds)} / ${fmtHM(s.dailyDrivingLimit)}`}
            ratio={s.dailyDrivingSeconds / s.dailyDrivingLimit}
          />
          {s.dailyLimitExceeded && <Text style={[styles.hint, { color: colors.danger }]}>Denný limit prekročený</Text>}
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Týždenná jazda</Text>
          <ProgressBar
            label="Aktuálny kalendárny týždeň"
            valueLabel={`${fmtHM(s.weeklyDrivingSeconds)} / ${fmtHM(s.weeklyDrivingLimit)}`}
            ratio={s.weeklyDrivingSeconds / s.weeklyDrivingLimit}
          />
          {s.weeklyRestWarning && !s.weeklyRestOverdue && (
            <Text style={[styles.hint, { color: colors.warning }]}>Do začatia týždenného odpočinku ostáva menej než 24 h.</Text>
          )}
        </View>

        <View style={[styles.card, { borderColor: weeklyGuardianColor }]}> 
          <View style={styles.guardianHeader}>
            <MaterialCommunityIcons name="calendar-clock" size={22} color={weeklyGuardianColor} />
            <Text style={styles.cardTitle}>Strážca týždenného odpočinku</Text>
          </View>

          <Text style={[styles.guardianState, { color: weeklyGuardianColor }]}> 
            {weeklyGuardianDanger
              ? "Vyžaduje pozornosť"
              : s.weeklyRestStartedInTime
                ? "Odpočinok začal načas"
                : s.weeklyRestWarning
                  ? "Treba naplánovať odpočinok"
                  : "Plán je v poriadku"}
          </Text>

          <Text style={styles.bodyText}>
            {s.lastWeeklyRest
              ? `Posledný: ${s.lastWeeklyRest.kind === "regular" ? "pravidelný" : "skrátený"} ${fmtHM(s.lastWeeklyRest.durationSeconds)} — skončil ${fmtDateTime(s.lastWeeklyRest.endTime)}`
              : "Zatiaľ nemáš zaznamenaný týždenný odpočinok."}
          </Text>

          <Text style={styles.guardianLine}>
            {s.weeklyRestStartedInTime
              ? "Aktuálny odpočinok sa začal v povolenej lehote."
              : `Začať najneskôr: ${fmtDateTime(s.weeklyRestStartDeadline)} (${fmtHM(s.weeklyRestRemainingSeconds)} zostáva)`}
          </Text>

          <Text style={styles.guardianLine}>
            Najbližšia povinnosť: {s.nextWeeklyRestKind === "regular" ? "pravidelný odpočinok" : "skrátený odpočinok"} — minimálne {fmtHM(s.nextWeeklyRestRequiredSeconds)}.
          </Text>

          {s.compensationSeconds > 0 && (
            <View style={styles.compensationBox}>
              <Text style={[styles.compensationTitle, { color: s.compensationOverdue ? colors.danger : colors.warning }]}> 
                Dlžná kompenzácia: {fmtHM(s.compensationSeconds)}
              </Text>
              <Text style={styles.guardianLine}>
                Najbližší dlh {fmtHM(s.compensationNextSeconds)} vyčerpaj v jednom celku pripojenom k odpočinku aspoň 9 h, najneskôr {s.compensationDeadline ? fmtDateTime(s.compensationDeadline) : "—"}.
              </Text>
            </View>
          )}

          {s.weeklyRestNeedsRegular && (
            <Text style={[styles.hint, { color: colors.warning }]}>Po skrátenom odpočinku treba v susednom týždni pravidelný odpočinok 45 h.</Text>
          )}
          {s.nextWeeklyRestKind === "regular" && (
            <Text style={styles.hint}>Pravidelný týždenný odpočinok sa nesmie čerpať vo vozidle.</Text>
          )}
          {s.weeklyRestOverdue && <Text style={[styles.hint, { color: colors.danger }]}>Lehota na začatie týždenného odpočinku už uplynula.</Text>}
          {s.compensationOverdue && <Text style={[styles.hint, { color: colors.danger }]}>Lehota na vyčerpanie kompenzácie už uplynula.</Text>}
          {s.compensationWarning && !s.compensationOverdue && <Text style={[styles.hint, { color: colors.warning }]}>Termín kompenzácie je už do 7 dní.</Text>}
          {s.weeklyRestTwoWeekViolation && <Text style={[styles.hint, { color: colors.danger }]}>Zaznamenané dve ukončené týždne nespĺňajú kombináciu 45 h / 24 h.</Text>}
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Dvojtýždenná jazda</Text>
          <ProgressBar
            label="Predchádzajúci + aktuálny týždeň"
            valueLabel={`${fmtHM(s.biweeklyDrivingSeconds)} / ${fmtHM(s.biweeklyDrivingLimit)}`}
            ratio={s.biweeklyDrivingSeconds / s.biweeklyDrivingLimit}
          />
          {s.biweeklyLimitExceeded && (
            <Text style={[styles.hint, { color: colors.danger }]}>Dvojtýždenný limit prekročený</Text>
          )}
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Posledný denný odpočinok</Text>
          <Text style={styles.bodyText}>
            {s.lastDailyRest
              ? `${fmtHM(s.lastDailyRest.durationSeconds)} — skončil ${new Date(s.lastDailyRest.endTime).toLocaleString("sk-SK")}`
              : "Zatiaľ žiadny zaznamenaný"}
          </Text>
        </View>

        <Pressable
          disabled={dayEnded || isDriving}
          onPress={() => setEndDayModalOpen(true)}
          style={({ pressed }) => [
            styles.endDayButton,
            { opacity: dayEnded || isDriving ? 0.4 : pressed ? 0.85 : 1 },
          ]}
        >
          <MaterialCommunityIcons name="flag-checkered" size={20} color={colors.danger} />
          <Text style={styles.endDayButtonText}>Ukončiť deň</Text>
        </Pressable>
      </ScrollView>

      <View style={styles.footer}>
        <Pressable
          disabled={!canFinishWork || pending}
          onPress={() => finishWork.mutate()}
          style={({ pressed }) => [
            styles.actionButton,
            { backgroundColor: colors.secondary, opacity: canFinishWork ? (pressed ? 0.85 : 1) : 0.4 },
          ]}
        >
          {finishWork.isPending ? (
            <ActivityIndicator color="#0B1220" />
          ) : (
            <>
              <MaterialCommunityIcons name="bed" size={20} color="#0B1220" />
              <Text style={styles.actionButtonText}>Začať pauzu</Text>
            </>
          )}
        </Pressable>

        {isDriving && <Text style={styles.footerHint}>Vozidlo práve jazdí</Text>}
        {isResting && !dayEnded && <Text style={styles.footerHint}>Odpočinok už prebieha</Text>}
      </View>

      <Modal visible={endDayModalOpen} transparent animationType="fade" onRequestClose={() => setEndDayModalOpen(false)}>
        <KeyboardAvoidingView style={styles.modalBackdrop} behavior={Platform.OS === "ios" ? "padding" : "height"}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Ukončiť deň</Text>
            <Text style={styles.modalDesc}>Po ukončení sa pracovný deň uzavrie a ďalej bude pokračovať odpočinok.</Text>
            <Text style={styles.label}>Stav km na konci (voliteľné)</Text>
            <TextInput
              style={styles.input}
              value={endKm}
              onChangeText={setEndKm}
              placeholder="stav km"
              placeholderTextColor={colors.textSecondary}
              keyboardType="numeric"
            />
            <View style={styles.modalActions}>
              <Pressable style={styles.modalCancel} onPress={() => setEndDayModalOpen(false)} disabled={endDay.isPending}>
                <Text style={styles.modalCancelText}>Zrušiť</Text>
              </Pressable>
              <Pressable style={styles.modalConfirm} onPress={() => endDay.mutate()} disabled={endDay.isPending}>
                {endDay.isPending ? <ActivityIndicator color="#0B1220" /> : <Text style={styles.modalConfirmText}>Potvrdiť</Text>}
              </Pressable>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  center: { flex: 1, backgroundColor: colors.background, alignItems: "center", justifyContent: "center" },
  heading: { color: colors.textPrimary, fontFamily: "Poppins_700Bold", fontSize: 24, marginBottom: 14 },
  driverRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 14 },
  driverChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
    maxWidth: "100%",
  },
  avatarCircle: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: colors.secondary,
    alignItems: "center",
    justifyContent: "center",
  },
  driverChipText: { color: colors.textPrimary, fontFamily: "Poppins_600SemiBold", fontSize: 13 },
  endedBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.secondary,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 10,
    marginBottom: 14,
  },
  endedText: { color: colors.secondary, fontFamily: "Poppins_600SemiBold", fontSize: 12, flex: 1 },
  metaRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 14 },
  metaChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  metaText: { color: colors.textPrimary, fontFamily: "Poppins_600SemiBold", fontSize: 12 },
  statusPill: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-start",
    borderWidth: 1.5,
    borderRadius: 999,
    paddingHorizontal: 16,
    paddingVertical: 10,
    marginBottom: 20,
    gap: 10,
  },
  statusText: { fontFamily: "Poppins_600SemiBold", fontSize: 16, letterSpacing: 0.5 },
  statusElapsed: { color: colors.textSecondary, fontFamily: "Poppins_500Medium", fontSize: 14, marginLeft: 4 },
  card: {
    backgroundColor: colors.surface,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 18,
    marginBottom: 14,
  },
  cardTitle: { color: colors.textPrimary, fontFamily: "Poppins_600SemiBold", fontSize: 15, marginBottom: 12 },
  progressGap: { marginTop: 16 },
  guardianHeader: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 4 },
  guardianState: { fontFamily: "Poppins_700Bold", fontSize: 14, marginBottom: 10 },
  guardianLine: { color: colors.textSecondary, fontFamily: "Poppins_500Medium", fontSize: 13, lineHeight: 19, marginTop: 8 },
  compensationBox: { marginTop: 12, paddingTop: 10, borderTopWidth: 1, borderTopColor: colors.border },
  compensationTitle: { fontFamily: "Poppins_700Bold", fontSize: 14 },
  hint: { color: colors.textSecondary, fontFamily: "Poppins_500Medium", fontSize: 13, marginTop: 4 },
  bodyText: { color: colors.textPrimary, fontFamily: "Poppins_500Medium", fontSize: 14 },
  footer: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    padding: 20,
    gap: 10,
    backgroundColor: colors.background,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  actionButton: {
    borderRadius: 18,
    paddingVertical: 16,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
  },
  actionButtonText: { color: "#0B1220", fontFamily: "Poppins_700Bold", fontSize: 15 },
  endDayButton: {
    borderRadius: 18,
    paddingVertical: 14,
    borderWidth: 1.5,
    borderColor: colors.danger,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
  },
  endDayButtonText: { color: colors.danger, fontFamily: "Poppins_700Bold", fontSize: 14 },
  footerHint: { color: colors.textSecondary, textAlign: "center", marginTop: 2, fontFamily: "Poppins_500Medium", fontSize: 12 },
  modalBackdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.6)", alignItems: "center", justifyContent: "center", padding: 24 },
  modalCard: { width: "100%", backgroundColor: colors.surface, borderRadius: 20, borderWidth: 1, borderColor: colors.border, padding: 20 },
  modalTitle: { color: colors.textPrimary, fontFamily: "Poppins_700Bold", fontSize: 18, marginBottom: 6 },
  modalDesc: { color: colors.textSecondary, fontFamily: "Poppins_500Medium", fontSize: 13, marginBottom: 16, lineHeight: 18 },
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
    marginBottom: 18,
  },
  modalActions: { flexDirection: "row", gap: 10 },
  modalCancel: {
    flex: 1,
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: colors.border,
  },
  modalCancelText: { color: colors.textSecondary, fontFamily: "Poppins_600SemiBold", fontSize: 14 },
  modalConfirm: { flex: 1, borderRadius: 14, paddingVertical: 14, alignItems: "center", justifyContent: "center", backgroundColor: colors.danger },
  modalConfirmText: { color: "#0B1220", fontFamily: "Poppins_700Bold", fontSize: 14 },
});
