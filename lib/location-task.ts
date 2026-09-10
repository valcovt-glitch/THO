import * as Location from "expo-location";
import * as TaskManager from "expo-task-manager";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { api } from "./api";
import { getDeviceId } from "./device";
import { getDayPhase, hydrateDayPhase, setDayPhase } from "./day-phase";

export const LOCATION_TASK_NAME = "truck-hours-location-task";

// Speed threshold to decide "driving" vs "work". 1 km/h ≈ 0.2778 m/s.
const DRIVING_SPEED_THRESHOLD_MS = 1 / 3.6;

// Switch to "driving"/"work" immediately on the first valid sample past the threshold —
// no debounce delay, since the speed smoothing above already absorbs GPS jitter.
// No location fix for this long = GPS considered down/unavailable. Kept generous (real-world
// fixes can occasionally lag a few seconds) to avoid the status flickering between ok/not-ok.
const MAX_FIX_AGE_MS = 20_000;
// Typical smartphone GPS accuracy outdoors is commonly 5-50 m — that's normal, not a problem
// (this is what Waze/Google Maps consider a fine fix too). Only flag as "weak" well beyond that.
const WEAK_ACCURACY_THRESHOLD_M = 50;
const NO_FIX_ACCURACY_THRESHOLD_M = 150;
// Only trust a distance/time speed estimate (used when the device doesn't report a speed at
// all) when fixes are reasonably good — matches the same real-world accuracy range above.
const MAX_ACCURACY_FOR_TRUST_M = 50;
// Reject any single-sample speed above this as a clearly bogus GPS glitch (~200 km/h) — keep
// showing the last known good value instead of a nonsense spike.
const MAX_PLAUSIBLE_SPEED_MS = 55;
// Light smoothing (like Waze/Google Maps do) so the displayed speed doesn't jitter sample to
// sample. Asymmetric on purpose: rising speed is smoothed more (filters GPS noise while
// accelerating), but falling speed reacts fast — a real stop should show ~0 almost immediately,
// not slowly decay over several seconds.
const SPEED_SMOOTHING_ALPHA_UP = 0.4;
const SPEED_SMOOTHING_ALPHA_DOWN = 0.9;
// A device-reported speed below this is trusted as "basically stopped" immediately, skipping
// smoothing entirely — modern GPS/Doppler speed sensors are reliable at near-zero speed.
const NEAR_ZERO_SPEED_MS = 0.3; // ~1 km/h
// After "Začať deň" is pressed, GPS needs a bit to lock onto satellites and give reliable
// fixes. During this warm-up window, keep showing GPS/speed but never auto-switch activity —
// the app is forced to "rest" for this long instead (shown on its own dedicated screen).
const STARTUP_GRACE_MS = 30_000;

let lastSentType: "driving" | "work" | null = null;
let lastSentAt = 0;
const MIN_RESEND_INTERVAL_MS = 20_000; // avoid excessive local writes on noisy GPS

type TransitionListener = (type: "driving" | "work") => void;
const transitionListeners = new Set<TransitionListener>();

// Subscribe to be notified the instant an auto driving/work switch is decided (before the
// local write resolves), so UI can refresh right away instead of waiting on its own poll.
export function subscribeTransitionSent(fn: TransitionListener): () => void {
  transitionListeners.add(fn);
  return () => transitionListeners.delete(fn);
}

let hasLocationPermission = false;
let lastFixAt: number | null = null;
let lastSpeedKmh: number | null = null;
let smoothedSpeedMs: number | null = null;
let lastAccuracy: number | null = null;
let lastFix: { lat: number; lng: number; at: number; accuracy: number | null } | null = null;
const TRACKING_STARTED_KEY = "truck-hours.tracking-started-at.v1";
let trackingStartedAt: number | null = null;
let trackingStartHydration: Promise<void> | null = null;

async function hydrateTrackingStarted() {
  if (trackingStartHydration) return trackingStartHydration;
  trackingStartHydration = AsyncStorage.getItem(TRACKING_STARTED_KEY)
    .then((stored) => {
      const parsed = stored ? Number(stored) : Number.NaN;
      if (Number.isFinite(parsed)) trackingStartedAt = parsed;
    })
    .catch((error) => console.warn("Failed to restore GPS warm-up timestamp", error));
  return trackingStartHydration;
}

export function markTrackingStarted() {
  trackingStartedAt = Date.now();
  void AsyncStorage.setItem(TRACKING_STARTED_KEY, String(trackingStartedAt)).catch((error) => {
    console.warn("Failed to persist GPS warm-up timestamp", error);
  });
}

export function getWarmupRemainingMs(): number {
  if (trackingStartedAt === null) return STARTUP_GRACE_MS;
  return Math.max(0, STARTUP_GRACE_MS - (Date.now() - trackingStartedAt));
}

export type GpsStatus = "ok" | "weak" | "none";

export function getGpsSnapshot(): { status: GpsStatus; lastFixAt: number | null; speedKmh: number | null; accuracy: number | null } {
  const fresh = hasLocationPermission && lastFixAt !== null && Date.now() - lastFixAt < MAX_FIX_AGE_MS;
  let status: GpsStatus = "none";
  if (fresh) {
    if (lastAccuracy !== null && lastAccuracy > NO_FIX_ACCURACY_THRESHOLD_M) status = "none";
    else if (lastAccuracy !== null && lastAccuracy > WEAK_ACCURACY_THRESHOLD_M) status = "weak";
    else status = "ok";
  }
  return { status, lastFixAt, speedKmh: lastSpeedKmh, accuracy: lastAccuracy };
}

function haversineMeters(lat1: number, lon1: number, lat2: number, lon2: number) {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

async function reportTransition(type: "driving" | "work") {
  const now = Date.now();
  if (type === lastSentType && now - lastSentAt < MIN_RESEND_INTERVAL_MS) return;
  lastSentType = type;
  lastSentAt = now;
  // Let the UI know immediately (don't wait for the next scheduled poll) so the status pill
  // reflects the switch as soon as we decided on it, not up to 15s later.
  transitionListeners.forEach((l) => l(type));
  try {
    const deviceId = await getDeviceId();
    await api.trucking.transition.$post({ json: { deviceId, type, timestamp: new Date().toISOString() } });
  } catch (err) {
    console.warn("Failed to save local transition", err);
  }
}

function processSample(coords: { latitude: number; longitude: number; speed: number | null; accuracy: number | null }) {
  const now = Date.now();
  lastFixAt = now;
  lastAccuracy = coords.accuracy;

  // expo-location reports -1/null when speed isn't available. Trust the device's own speed
  // field first (Doppler-based, not affected by position jitter) when it's valid.
  const rawSpeed = coords.speed !== null && coords.speed >= 0 ? coords.speed : null;
  const accuracy = coords.accuracy;

  let speedMs: number | null = null;

  if (rawSpeed !== null) {
    speedMs = rawSpeed;
  } else if (
    lastFix &&
    accuracy !== null &&
    accuracy <= MAX_ACCURACY_FOR_TRUST_M &&
    lastFix.accuracy !== null &&
    lastFix.accuracy <= MAX_ACCURACY_FOR_TRUST_M
  ) {
    const dt = (now - lastFix.at) / 1000;
    if (dt >= 0.5) {
      const distance = haversineMeters(lastFix.lat, lastFix.lng, coords.latitude, coords.longitude);
      // Movement smaller than the combined GPS error margin is just jitter, not real motion.
      const noiseFloor = accuracy + lastFix.accuracy;
      speedMs = distance > noiseFloor ? (distance - noiseFloor) / dt : 0;
    }
  }

  lastFix = { lat: coords.latitude, lng: coords.longitude, at: now, accuracy };

  if (speedMs === null) return; // still nothing usable — don't guess the activity
  if (speedMs > MAX_PLAUSIBLE_SPEED_MS) return; // reject an obvious bad-fix spike

  if (rawSpeed !== null && rawSpeed < NEAR_ZERO_SPEED_MS) {
    // Device confidently says we're basically stopped — snap to it instead of slowly decaying.
    smoothedSpeedMs = rawSpeed;
  } else if (smoothedSpeedMs === null) {
    smoothedSpeedMs = speedMs;
  } else {
    const alpha = speedMs < smoothedSpeedMs ? SPEED_SMOOTHING_ALPHA_DOWN : SPEED_SMOOTHING_ALPHA_UP;
    smoothedSpeedMs = smoothedSpeedMs + alpha * (speedMs - smoothedSpeedMs);
  }
  lastSpeedKmh = smoothedSpeedMs * 3.6;

  // Only auto-switch driving/work while the day is actually active — never before "Začať deň",
  // never during GPS warm-up, and never after "Ukončiť deň" (only rest keeps counting then).
  const dayPhase = getDayPhase();
  if (dayPhase === "warmup") {
    if (getWarmupRemainingMs() > 0) return;
    setDayPhase("active");
  } else if (dayPhase !== "active") {
    return;
  }

  // Switch instantly on the raw (unsmoothed) reading — the moment it crosses 1 km/h either way,
  // not waiting for the smoothed display value to catch up. Smoothing above is for the shown
  // number only; switching must react immediately.
  if (speedMs > DRIVING_SPEED_THRESHOLD_MS) {
    void reportTransition("driving");
  } else {
    void reportTransition("work");
  }
}

if (!TaskManager.isTaskDefined(LOCATION_TASK_NAME)) {
  TaskManager.defineTask(LOCATION_TASK_NAME, async ({ data, error }) => {
    if (error) {
      console.warn("Location task error", error);
      return;
    }
    await Promise.all([hydrateDayPhase(), hydrateTrackingStarted()]);
    const { locations } = (data as { locations: Location.LocationObject[] }) ?? { locations: [] };
    const latest = locations?.[locations.length - 1];
    if (!latest) return;
    processSample({
      latitude: latest.coords.latitude,
      longitude: latest.coords.longitude,
      speed: latest.coords.speed,
      accuracy: latest.coords.accuracy,
    });
  });
}

export async function requestLocationPermissions(): Promise<{ foreground: boolean; background: boolean }> {
  let fg;
  try {
    fg = await Location.requestForegroundPermissionsAsync();
  } catch (err) {
    console.warn("Foreground permission request failed", err);
    hasLocationPermission = false;
    return { foreground: false, background: false };
  }
  if (fg.status !== "granted") {
    hasLocationPermission = false;
    return { foreground: false, background: false };
  }
  hasLocationPermission = true;

  // Background permission is often unsupported/throws in Expo Go — never let it block
  // foreground tracking, which is all we need while the app is open.
  let background = false;
  try {
    const bg = await Location.requestBackgroundPermissionsAsync();
    background = bg.status === "granted";
  } catch (err) {
    console.warn("Background permission unavailable (expected in Expo Go)", err);
  }
  return { foreground: true, background };
}

export async function startLocationTracking() {
  const isRunning = await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK_NAME).catch(() => false);
  if (isRunning) return;
  await Location.startLocationUpdatesAsync(LOCATION_TASK_NAME, {
    accuracy: Location.Accuracy.BestForNavigation,
    timeInterval: 1000,
    distanceInterval: 0,
    foregroundService: {
      notificationTitle: "Truck Driver Hours",
      notificationBody: "Sleduje jazdu a prestávky na pozadí",
    },
    pausesUpdatesAutomatically: false,
    showsBackgroundLocationIndicator: true,
  });
}

export async function stopLocationTracking() {
  const isRunning = await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK_NAME).catch(() => false);
  if (isRunning) await Location.stopLocationUpdatesAsync(LOCATION_TASK_NAME);
}

// Foreground fallback: used while the app is open (e.g. in Expo Go, where true background
// location isn't available) so the demo still feels responsive during testing.
export function watchForegroundPosition() {
  let sub: Location.LocationSubscription | null = null;
  let cancelled = false;

  const feed = (coords: { latitude: number; longitude: number; speed: number | null; accuracy: number | null }) => {
    if (!cancelled) processSample(coords);
  };

  // Prime immediately with a one-off fix so the UI isn't stuck on "--" waiting for the first
  // watchPositionAsync callback (which can take several seconds to arrive).
  Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.BestForNavigation })
    .then((loc) => feed(loc.coords))
    .catch((err) => console.warn("getCurrentPositionAsync failed", err));

  Location.watchPositionAsync(
    { accuracy: Location.Accuracy.BestForNavigation, timeInterval: 1000, distanceInterval: 0 },
    (loc) => feed(loc.coords)
  )
    .catch((err) => {
      console.warn("watchPositionAsync failed to start", err);
      return null;
    })
    .then((s) => {
      if (s) sub = s;
    });

  return () => {
    cancelled = true;
    sub?.remove();
  };
}
