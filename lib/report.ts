import { fmtHM, statusLabel, type SessionType } from "./theme";

export interface ShiftReportInput {
  driverName: string | null;
  plate: string | null;
  startKm: number | null;
  endKm: number | null;
  totals: Record<SessionType, number>;
  startedAt: Date;
  endedAt: Date;
}

const CATEGORIES: SessionType[] = ["driving", "work", "availability", "rest"];

function formatDateTime(value: Date): string {
  return value.toLocaleString("sk-SK", {
    weekday: "short",
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function buildShiftReportText(input: ShiftReportInput): string {
  const lines: string[] = [];
  lines.push("TRUCK DRIVER HOURS — SÚHRN ZMENY");
  lines.push(`Začiatok: ${formatDateTime(input.startedAt)}`);
  lines.push(`Koniec: ${formatDateTime(input.endedAt)}`);
  lines.push("");
  lines.push(`Vodič: ${input.driverName ?? "-"}`);
  lines.push(`ŠPZ: ${input.plate ?? "-"}`);
  if (input.startKm !== null) lines.push(`Km na začiatku: ${input.startKm}`);
  if (input.endKm !== null) lines.push(`Km na konci: ${input.endKm}`);
  if (input.startKm !== null && input.endKm !== null) {
    lines.push(`Najazdené km: ${Math.max(0, input.endKm - input.startKm)}`);
  }
  lines.push("");
  lines.push("Súčty za zmenu:");
  for (const category of CATEGORIES) {
    lines.push(`  ${statusLabel(category)}: ${fmtHM(input.totals[category] ?? 0)}`);
  }
  lines.push("");
  lines.push("Vygenerované aplikáciou Truck Driver Hours.");
  return lines.join("\n");
}
