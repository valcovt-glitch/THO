export const colors = {
  background: "#0B1220",
  surface: "#131C2E",
  surfaceElevated: "#1B2740",
  border: "#26314A",
  primary: "#FF7A1A", // driving
  work: "#4DA8FF", // práca (kladivká)
  availability: "#FFC24B", // pohotovosť
  secondary: "#3DD68C", // odpočinok
  warning: "#FFC24B",
  danger: "#FF4D4F",
  textPrimary: "#F5F7FA",
  textSecondary: "#8C97AE",
};

export type SessionType = "driving" | "work" | "availability" | "rest";

export function fmtHM(totalSeconds: number): string {
  const s = Math.max(0, Math.round(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return `${h}h ${m.toString().padStart(2, "0")}m`;
}

export function fmtClock(totalSeconds: number): string {
  const s = Math.max(0, Math.round(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return `${h.toString().padStart(2, "0")}:${m.toString().padStart(2, "0")}:${sec.toString().padStart(2, "0")}`;
}

export function statusColor(type?: SessionType | null): string {
  if (type === "driving") return colors.primary;
  if (type === "work") return colors.work;
  if (type === "rest") return colors.secondary;
  if (type === "availability") return colors.availability;
  return colors.textSecondary;
}

export function statusLabel(type?: SessionType | null): string {
  if (type === "driving") return "JAZDA";
  if (type === "work") return "PRÁCA";
  if (type === "rest") return "ODPOČINOK";
  if (type === "availability") return "POHOTOVOSŤ";
  return "NEZNÁME";
}

// Icon names from MaterialCommunityIcons, chosen to mirror the 4 standard tachograph
// activity symbols: steering wheel (driving), crossed hammers (other work),
// divided rectangle (availability), bed (rest).
export function statusIcon(type?: SessionType | null): string {
  if (type === "driving") return "steering";
  if (type === "work") return "hammer-wrench";
  if (type === "rest") return "bed";
  if (type === "availability") return "timer-sand";
  return "help-circle-outline";
}
