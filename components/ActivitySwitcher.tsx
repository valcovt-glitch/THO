import { View, Text, Pressable, StyleSheet, ActivityIndicator } from "react-native";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { colors, statusColor, statusLabel, statusIcon, type SessionType } from "../lib/theme";

const OPTIONS: SessionType[] = ["driving", "work", "availability", "rest"];

export function ActivitySwitcher({
  current,
  onSelect,
  pending,
  disabled,
}: {
  current?: SessionType | null;
  onSelect: (type: SessionType) => void;
  pending?: boolean;
  disabled?: boolean;
}) {
  return (
    <View style={{ opacity: disabled ? 0.4 : 1 }}>
      <Text style={styles.label}>Manuálny prepínač činnosti</Text>
      <View style={styles.row}>
        {OPTIONS.map((type) => {
          const active = current === type;
          const color = statusColor(type);
          // Can't manually switch to rest while the vehicle is actually driving.
          const optionDisabled = disabled || pending || (type === "rest" && current === "driving");
          return (
            <Pressable
              key={type}
              disabled={optionDisabled}
              onPress={() => onSelect(type)}
              style={({ pressed }) => [
                styles.option,
                {
                  backgroundColor: active ? color : colors.surface,
                  borderColor: color,
                  opacity: optionDisabled && !active ? 0.35 : pressed ? 0.8 : 1,
                },
              ]}
            >
              {pending && active ? (
                <ActivityIndicator color={active ? "#0B1220" : color} size="small" />
              ) : (
                <MaterialCommunityIcons name={statusIcon(type) as any} size={20} color={active ? "#0B1220" : color} />
              )}
              <Text
                style={[styles.optionText, { color: active ? "#0B1220" : color }]}
                numberOfLines={1}
                adjustsFontSizeToFit
                minimumFontScale={0.6}
              >
                {statusLabel(type)}
              </Text>
            </Pressable>
          );
        })}
      </View>
      <Text style={styles.hint}>
        {disabled
          ? "Deň je ukončený — prepínač je zamknutý do začiatku nového dňa."
          : "Automaticky sa mení GPS-kou (nad 1 km/h jazda, pri 0 km/h práca) — tu vieš stav kedykoľvek ručne opraviť."}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  label: { color: colors.textSecondary, fontFamily: "Poppins_500Medium", fontSize: 13, marginBottom: 8 },
  row: { flexDirection: "row", gap: 6 },
  option: {
    flex: 1,
    borderWidth: 1.5,
    borderRadius: 14,
    paddingVertical: 10,
    paddingHorizontal: 2,
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
  },
  optionText: { fontFamily: "Poppins_600SemiBold", fontSize: 9, letterSpacing: 0, textAlign: "center" },
  hint: { color: colors.textSecondary, fontFamily: "Poppins_500Medium", fontSize: 11, marginTop: 8, lineHeight: 15 },
});
