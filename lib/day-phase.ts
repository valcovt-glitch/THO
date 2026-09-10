import AsyncStorage from "@react-native-async-storage/async-storage";
import { useEffect, useState } from "react";

export type DayPhase = "intro" | "warmup" | "active" | "ended";

const STORAGE_KEY = "truck-hours.day-phase.v1";
const VALID_PHASES = new Set<DayPhase>(["intro", "warmup", "active", "ended"]);

let phase: DayPhase = "intro";
let revision = 0;
let hydrationPromise: Promise<DayPhase> | null = null;

type Listener = (phase: DayPhase) => void;
const listeners = new Set<Listener>();

function applyPhase(next: DayPhase) {
  if (phase === next) return;
  phase = next;
  listeners.forEach((listener) => listener(next));
}

export function getDayPhase(): DayPhase {
  return phase;
}

/**
 * Updates the in-memory phase immediately and persists it for process restarts/background tasks.
 * The current open shift in local phone storage remains the authoritative source during app bootstrap.
 */
export function setDayPhase(next: DayPhase) {
  revision += 1;
  applyPhase(next);
  void AsyncStorage.setItem(STORAGE_KEY, next).catch((error) => {
    console.warn("Failed to persist day phase", error);
  });
}

/** Hydrates the last known phase once. Safe to call from the UI and the background GPS task. */
export function hydrateDayPhase(): Promise<DayPhase> {
  if (hydrationPromise) return hydrationPromise;

  const revisionAtStart = revision;
  hydrationPromise = AsyncStorage.getItem(STORAGE_KEY)
    .then((stored) => {
      if (revision === revisionAtStart && stored && VALID_PHASES.has(stored as DayPhase)) {
        applyPhase(stored as DayPhase);
      }
      return phase;
    })
    .catch((error) => {
      console.warn("Failed to restore day phase", error);
      return phase;
    });

  return hydrationPromise;
}

export function subscribeDayPhase(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function useDayPhase(): DayPhase {
  const [value, setValue] = useState(phase);
  useEffect(() => subscribeDayPhase(setValue), []);
  return value;
}
