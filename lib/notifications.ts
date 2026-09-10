import * as Notifications from "expo-notifications";
import { Platform } from "react-native";

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

export async function requestNotificationPermissions() {
  const settings = await Notifications.getPermissionsAsync();
  if (settings.status === "granted") return true;
  const req = await Notifications.requestPermissionsAsync();
  if (Platform.OS === "android") {
    await Notifications.setNotificationChannelAsync("default", {
      name: "Upozornenia",
      importance: Notifications.AndroidImportance.HIGH,
    });
  }
  return req.status === "granted";
}

const lastFired: Record<string, number> = {};
const COOLDOWN_MS = 10 * 60 * 1000; // avoid re-notifying same flag too often

async function fireOnce(key: string, title: string, body: string) {
  const now = Date.now();
  if (lastFired[key] && now - lastFired[key] < COOLDOWN_MS) return;
  lastFired[key] = now;
  await Notifications.scheduleNotificationAsync({
    content: { title, body },
    trigger: null,
  });
}

export async function checkStatusAndNotify(status: {
  needsBreakSoon: boolean;
  breakOverdue: boolean;
  dailyLimitWarning: boolean;
  dailyLimitExceeded: boolean;
  weeklyRestDue: boolean;
  weeklyRestOverdue: boolean;
  compensationWarning: boolean;
  compensationOverdue: boolean;
  weeklyRestTwoWeekViolation: boolean;
}) {
  if (status.breakOverdue) {
    await fireOnce("breakOverdue", "Prestávka je nutná", "Prekročil si 4,5 h nepretržitej jazdy. Zastav a urob prestávku 45 min.");
  } else if (status.needsBreakSoon) {
    await fireOnce("needsBreakSoon", "Blíži sa povinná prestávka", "Do konca povoleného nepretržitého úseku jazdy ostáva menej ako 30 min.");
  }
  if (status.dailyLimitExceeded) {
    await fireOnce("dailyLimitExceeded", "Prekročený denný limit jazdy", "Dnes si prekročil povolený denný limit jazdy.");
  } else if (status.dailyLimitWarning) {
    await fireOnce("dailyLimitWarning", "Blíži sa denný limit jazdy", "Ostáva menej ako 1 h do vyčerpania denného limitu jazdy.");
  }
  if (status.weeklyRestOverdue) {
    await fireOnce("weeklyRestOverdue", "Týždenný odpočinok je po lehote", "Týždenný odpočinok sa mal začať najneskôr po šiestich 24-hodinových obdobiach.");
  } else if (status.weeklyRestDue) {
    await fireOnce("weeklyRestDue", "Blíži sa týždenný odpočinok", "Do lehoty na začatie týždenného odpočinku ostáva menej než 24 hodín.");
  }
  if (status.compensationOverdue) {
    await fireOnce("weeklyCompensationOverdue", "Kompenzácia odpočinku je po lehote", "Dlžnú kompenzáciu za skrátený týždenný odpočinok treba vyčerpať čo najskôr.");
  } else if (status.compensationWarning) {
    await fireOnce("weeklyCompensationWarning", "Blíži sa termín kompenzácie", "Naplánuj kompenzáciu za skrátený týždenný odpočinok; termín je do 7 dní.");
  }
  if (status.weeklyRestTwoWeekViolation) {
    await fireOnce("weeklyRestTwoWeekViolation", "Dvojtýždenné pravidlo odpočinku", "Záznam nemá požadovanú kombináciu pravidelného a prípadne skráteného týždenného odpočinku.");
  }
}
