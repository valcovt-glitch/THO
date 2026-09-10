import AsyncStorage from "@react-native-async-storage/async-storage";

const KEY = "truck-hours:device-id";

function generateId() {
  return `dev_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

let cached: string | null = null;

export async function getDeviceId(): Promise<string> {
  if (cached) return cached;
  const existing = await AsyncStorage.getItem(KEY);
  if (existing) {
    cached = existing;
    return existing;
  }
  const id = generateId();
  await AsyncStorage.setItem(KEY, id);
  cached = id;
  return id;
}
