import { Platform } from "react-native";
import * as FileSystem from "expo-file-system/legacy";
import * as IntentLauncher from "expo-intent-launcher";

const LATEST_RELEASE_URL = "https://api.github.com/repos/valcovt-glitch/THO/releases/latest";

type GitHubRelease = {
  tag_name: string;
  html_url: string;
  assets: Array<{ name: string; browser_download_url: string }>;
};

export type AvailableAppUpdate = {
  version: string;
  downloadUrl: string;
  releaseUrl: string;
};

function compareVersions(left: string, right: string): number {
  const a = left.split(".").map((part) => Number(part) || 0);
  const b = right.split(".").map((part) => Number(part) || 0);
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    if ((a[index] ?? 0) !== (b[index] ?? 0)) return (a[index] ?? 0) - (b[index] ?? 0);
  }
  return 0;
}

export async function findAppUpdate(currentVersion: string): Promise<AvailableAppUpdate | null> {
  if (Platform.OS !== "android") return null;

  const response = await fetch(LATEST_RELEASE_URL, {
    headers: { Accept: "application/vnd.github+json" },
  });
  if (!response.ok) return null;

  const release = (await response.json()) as GitHubRelease;
  const version = release.tag_name.replace(/^v/i, "").trim();
  const apk = release.assets.find((asset) => asset.name.toLowerCase().endsWith(".apk"));
  if (!version || !apk || compareVersions(version, currentVersion) <= 0) return null;

  return { version, downloadUrl: apk.browser_download_url, releaseUrl: release.html_url };
}

export async function downloadAndInstallAppUpdate(update: AvailableAppUpdate): Promise<void> {
  if (Platform.OS !== "android") throw new Error("Aktualizácia je dostupná iba pre Android.");
  if (!FileSystem.cacheDirectory) throw new Error("Úložisko pre aktualizáciu nie je dostupné.");

  const destination = `${FileSystem.cacheDirectory}TruckHours-${update.version}-${Date.now()}.apk`;
  const result = await FileSystem.downloadAsync(update.downloadUrl, destination);
  const contentUri = await FileSystem.getContentUriAsync(result.uri);
  await IntentLauncher.startActivityAsync("android.intent.action.VIEW", {
    data: contentUri,
    type: "application/vnd.android.package-archive",
    flags: 1,
  });
}
