import AsyncStorage from "@react-native-async-storage/async-storage";
import { computeStatus, type DriverSettings, type RawSession, type SessionType } from "./eu561";

const DATABASE_KEY = "truck-hours.offline-database.v1";

export type SessionSource = "auto" | "manual";

export interface StoredSession {
  id: number;
  deviceId: string;
  type: SessionType;
  source: SessionSource;
  startTime: string;
  endTime: string | null;
  breakFirstPart: boolean;
}

export interface StoredShift {
  id: number;
  deviceId: string;
  driverName: string | null;
  plate: string | null;
  startKm: number | null;
  endKm: number | null;
  startedAt: string;
  endedAt: string | null;
}

export interface StoredSettings extends DriverSettings {
  deviceId: string;
  pushToken: string | null;
  createdAt: string;
  updatedAt: string;
}

interface OfflineDatabase {
  version: 1;
  nextSessionId: number;
  nextShiftId: number;
  sessions: StoredSession[];
  shifts: StoredShift[];
  settings: StoredSettings[];
}

function emptyDatabase(): OfflineDatabase {
  return {
    version: 1,
    nextSessionId: 1,
    nextShiftId: 1,
    sessions: [],
    shifts: [],
    settings: [],
  };
}

function normalizeDatabase(value: unknown): OfflineDatabase {
  if (!value || typeof value !== "object") return emptyDatabase();
  const input = value as Partial<OfflineDatabase>;
  return {
    version: 1,
    nextSessionId: Math.max(1, Number(input.nextSessionId) || 1),
    nextShiftId: Math.max(1, Number(input.nextShiftId) || 1),
    sessions: Array.isArray(input.sessions) ? input.sessions : [],
    shifts: Array.isArray(input.shifts) ? input.shifts : [],
    settings: Array.isArray(input.settings) ? input.settings : [],
  };
}

async function readDatabase(): Promise<OfflineDatabase> {
  const raw = await AsyncStorage.getItem(DATABASE_KEY);
  if (!raw) return emptyDatabase();
  try {
    return normalizeDatabase(JSON.parse(raw));
  } catch (error) {
    console.warn("Offline database was unreadable; starting with an empty database", error);
    return emptyDatabase();
  }
}

async function writeDatabase(database: OfflineDatabase): Promise<void> {
  await AsyncStorage.setItem(DATABASE_KEY, JSON.stringify(database));
}

// Serialize all foreground operations so two fast taps/GPS samples cannot overwrite each other.
// AsyncStorage remains the source of truth, which also lets the background location task see data.
let operationQueue: Promise<void> = Promise.resolve();

function transaction<T>(operation: (database: OfflineDatabase) => T | Promise<T>, save = false): Promise<T> {
  const result = operationQueue.then(async () => {
    const database = await readDatabase();
    const value = await operation(database);
    if (save) await writeDatabase(database);
    return value;
  });
  operationQueue = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

function parseTimestamp(value?: string): string {
  if (!value) return new Date().toISOString();
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error("Neplatný čas záznamu");
  return date.toISOString();
}

function getOpenSession(database: OfflineDatabase, deviceId: string): StoredSession | null {
  return (
    database.sessions
      .filter((session) => session.deviceId === deviceId && session.endTime === null)
      .sort((a, b) => b.startTime.localeCompare(a.startTime))[0] ?? null
  );
}

function getOpenShift(database: OfflineDatabase, deviceId: string): StoredShift | null {
  return (
    database.shifts
      .filter((shift) => shift.deviceId === deviceId && shift.endedAt === null)
      .sort((a, b) => b.startedAt.localeCompare(a.startedAt))[0] ?? null
  );
}

function getOrCreateSettings(database: OfflineDatabase, deviceId: string): StoredSettings {
  const existing = database.settings.find((settings) => settings.deviceId === deviceId);
  if (existing) return existing;
  const now = new Date().toISOString();
  const created: StoredSettings = {
    deviceId,
    extendedDrivingEnabled: false,
    reducedRestEnabled: false,
    pushToken: null,
    createdAt: now,
    updatedAt: now,
  };
  database.settings.push(created);
  return created;
}

function closeSession(session: StoredSession, timestamp: string) {
  if (new Date(timestamp) < new Date(session.startTime)) {
    throw new Error("Koniec záznamu nemôže byť pred jeho začiatkom");
  }
  session.endTime = timestamp;
}

function createSession(
  database: OfflineDatabase,
  input: {
    deviceId: string;
    type: SessionType;
    source: SessionSource;
    startTime: string;
    breakFirstPart?: boolean;
  },
): StoredSession {
  const session: StoredSession = {
    id: database.nextSessionId++,
    deviceId: input.deviceId,
    type: input.type,
    source: input.source,
    startTime: input.startTime,
    endTime: null,
    breakFirstPart: input.breakFirstPart ?? false,
  };
  database.sessions.push(session);
  return session;
}

export async function getCurrentStatus(deviceId: string, timezoneOffsetMinutes = 0) {
  return transaction(async (database) => {
    const settings = getOrCreateSettings(database, deviceId);
    // Persist newly-created default settings even when the app only reads status.
    await writeDatabase(database);
    const sessions: RawSession[] = database.sessions
      .filter((session) => session.deviceId === deviceId)
      .sort((a, b) => a.startTime.localeCompare(b.startTime))
      .map((session) => ({
        id: session.id,
        type: session.type,
        startTime: new Date(session.startTime),
        endTime: session.endTime ? new Date(session.endTime) : null,
        breakFirstPart: session.breakFirstPart,
      }));

    return computeStatus(
      sessions,
      {
        extendedDrivingEnabled: settings.extendedDrivingEnabled,
        reducedRestEnabled: settings.reducedRestEnabled,
      },
      new Date(),
      timezoneOffsetMinutes,
    );
  });
}

export async function transitionActivity(input: {
  deviceId: string;
  type: "driving" | "work";
  timestamp?: string;
}): Promise<StoredSession> {
  return transaction((database) => {
    const timestamp = parseTimestamp(input.timestamp);
    if (!getOpenShift(database, input.deviceId)) throw new Error("Žiadny aktívny pracovný deň");
    const open = getOpenSession(database, input.deviceId);

    if (open?.type === input.type) return open;
    if (input.type === "work" && open && (open.type === "availability" || open.type === "rest")) {
      return open;
    }
    if (open) closeSession(open, timestamp);
    return createSession(database, {
      deviceId: input.deviceId,
      type: input.type,
      source: "auto",
      startTime: timestamp,
    });
  }, true);
}

export async function setActivity(input: {
  deviceId: string;
  type: SessionType;
  timestamp?: string;
}): Promise<StoredSession> {
  return transaction((database) => {
    if (!getOpenShift(database, input.deviceId)) throw new Error("Žiadny aktívny pracovný deň");
    const timestamp = parseTimestamp(input.timestamp);
    const open = getOpenSession(database, input.deviceId);
    if (open?.type === input.type) return open;
    if (open) closeSession(open, timestamp);
    return createSession(database, {
      deviceId: input.deviceId,
      type: input.type,
      source: "manual",
      startTime: timestamp,
    });
  }, true);
}

export async function startWork(input: { deviceId: string; timestamp?: string }): Promise<StoredSession> {
  return transaction((database) => {
    if (!getOpenShift(database, input.deviceId)) throw new Error("Žiadny aktívny pracovný deň");
    const timestamp = parseTimestamp(input.timestamp);
    const open = getOpenSession(database, input.deviceId);
    if (open?.type === "driving") throw new Error("Vozidlo práve jazdí, prácu nemožno spustiť");
    if (open?.type === "work") throw new Error("Práca už prebieha");
    if (open) closeSession(open, timestamp);
    return createSession(database, {
      deviceId: input.deviceId,
      type: "work",
      source: "manual",
      startTime: timestamp,
    });
  }, true);
}

export async function endWork(input: { deviceId: string; timestamp?: string }): Promise<StoredSession> {
  return transaction((database) => {
    const timestamp = parseTimestamp(input.timestamp);
    const open = getOpenSession(database, input.deviceId);
    if (!open || open.type !== "work") throw new Error("Práca neprebieha");
    closeSession(open, timestamp);
    return createSession(database, {
      deviceId: input.deviceId,
      type: "availability",
      source: "manual",
      startTime: timestamp,
    });
  }, true);
}

export async function finishWork(input: { deviceId: string; timestamp?: string }): Promise<StoredSession> {
  return transaction((database) => {
    const timestamp = parseTimestamp(input.timestamp);
    const open = getOpenSession(database, input.deviceId);
    if (open?.type === "driving") throw new Error("Vozidlo práve jazdí");
    if (open?.type === "rest") throw new Error("Odpočinok už prebieha");
    if (open) closeSession(open, timestamp);
    return createSession(database, {
      deviceId: input.deviceId,
      type: "rest",
      source: "manual",
      startTime: timestamp,
    });
  }, true);
}

export async function flagFirstBreakPart(deviceId: string): Promise<StoredSession> {
  return transaction((database) => {
    const open = getOpenSession(database, deviceId);
    if (!open) throw new Error("Žiadny prebiehajúci záznam");
    if (open.type !== "rest") throw new Error("Prvú časť možno označiť iba počas pauzy");
    if (open.breakFirstPart) throw new Error("Prvá časť už bola označená");
    open.breakFirstPart = true;
    return open;
  }, true);
}

export async function getHistory(input: {
  deviceId: string;
  days?: string;
  from?: string;
}): Promise<StoredSession[]> {
  return transaction((database) => {
    const parsedFrom = input.from ? new Date(input.from) : null;
    const days = Math.max(1, Number(input.days ?? "14") || 14);
    const since = parsedFrom && !Number.isNaN(parsedFrom.getTime())
      ? parsedFrom
      : new Date(Date.now() - days * 24 * 3600 * 1000);

    return database.sessions
      .filter((session) => {
        if (session.deviceId !== input.deviceId) return false;
        const start = new Date(session.startTime);
        const end = session.endTime ? new Date(session.endTime) : null;
        return start >= since || end === null || end >= since;
      })
      .sort((a, b) => b.startTime.localeCompare(a.startTime));
  });
}

export async function deleteSession(deviceId: string, id: number): Promise<void> {
  return transaction((database) => {
    const index = database.sessions.findIndex((session) => session.deviceId === deviceId && session.id === id);
    if (index < 0) throw new Error("Záznam sa nenašiel");
    database.sessions.splice(index, 1);
  }, true);
}

export async function getSettings(deviceId: string): Promise<StoredSettings> {
  return transaction(async (database) => {
    const settings = getOrCreateSettings(database, deviceId);
    await writeDatabase(database);
    return settings;
  });
}

export async function updateSettings(
  deviceId: string,
  patch: Partial<Pick<StoredSettings, "extendedDrivingEnabled" | "reducedRestEnabled" | "pushToken">>,
): Promise<StoredSettings> {
  return transaction((database) => {
    const settings = getOrCreateSettings(database, deviceId);
    if (patch.extendedDrivingEnabled !== undefined) {
      settings.extendedDrivingEnabled = patch.extendedDrivingEnabled;
    }
    if (patch.reducedRestEnabled !== undefined) settings.reducedRestEnabled = patch.reducedRestEnabled;
    if (patch.pushToken !== undefined) settings.pushToken = patch.pushToken;
    settings.updatedAt = new Date().toISOString();
    return settings;
  }, true);
}

export async function startShift(input: {
  deviceId: string;
  driverName?: string;
  plate?: string;
  startKm?: number;
  timestamp?: string;
}): Promise<StoredShift> {
  return transaction((database) => {
    const existing = getOpenShift(database, input.deviceId);
    if (existing) throw new Error("Pracovný deň už prebieha");

    const timestamp = parseTimestamp(input.timestamp);
    const openSession = getOpenSession(database, input.deviceId);
    if (openSession) closeSession(openSession, timestamp);

    const shift: StoredShift = {
      id: database.nextShiftId++,
      deviceId: input.deviceId,
      driverName: input.driverName?.trim() || null,
      plate: input.plate?.trim() || null,
      startKm: Number.isFinite(input.startKm) ? input.startKm! : null,
      endKm: null,
      startedAt: timestamp,
      endedAt: null,
    };
    database.shifts.push(shift);
    createSession(database, {
      deviceId: input.deviceId,
      type: "rest",
      source: "manual",
      startTime: timestamp,
    });
    return shift;
  }, true);
}

export async function endShift(input: {
  deviceId: string;
  endKm?: number;
  timestamp?: string;
}): Promise<StoredShift> {
  return transaction((database) => {
    const shift = getOpenShift(database, input.deviceId);
    if (!shift) throw new Error("Žiadny prebiehajúci deň");

    const timestamp = parseTimestamp(input.timestamp);
    const openSession = getOpenSession(database, input.deviceId);
    if (openSession?.type === "driving") throw new Error("Deň nemožno ukončiť počas jazdy");
    if (openSession && openSession.type !== "rest") {
      closeSession(openSession, timestamp);
      createSession(database, {
        deviceId: input.deviceId,
        type: "rest",
        source: "manual",
        startTime: timestamp,
      });
    }

    shift.endedAt = timestamp;
    shift.endKm = Number.isFinite(input.endKm) ? input.endKm! : null;
    return shift;
  }, true);
}

export async function getCurrentShift(deviceId: string): Promise<StoredShift | null> {
  return transaction((database) => getOpenShift(database, deviceId));
}

export async function resetOfflineDatabase(): Promise<void> {
  operationQueue = operationQueue.then(() => AsyncStorage.removeItem(DATABASE_KEY));
  await operationQueue;
}
