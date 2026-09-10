import { useEffect } from "react";
import { Stack } from "expo-router";
import { Alert } from "react-native";
import Constants from "expo-constants";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  useFonts,
  Poppins_400Regular,
  Poppins_500Medium,
  Poppins_600SemiBold,
  Poppins_700Bold,
} from "@expo-google-fonts/poppins";
import { ErrorBoundary } from "../components/ErrorBoundary";
import {
  requestLocationPermissions,
  startLocationTracking,
  watchForegroundPosition,
} from "../lib/location-task";
import { requestNotificationPermissions } from "../lib/notifications";
import { hydrateDayPhase } from "../lib/day-phase";
import { downloadAndInstallAppUpdate, findAppUpdate } from "../lib/app-update";

const queryClient = new QueryClient();

export default function RootLayout() {
  const [fontsLoaded] = useFonts({
    Poppins_400Regular,
    Poppins_500Medium,
    Poppins_600SemiBold,
    Poppins_700Bold,
  });

  useEffect(() => {
    let stopForeground: (() => void) | undefined;
    (async () => {
      try {
        await hydrateDayPhase();
        await requestNotificationPermissions();
        const perm = await requestLocationPermissions();
        if (!perm.foreground) return;

        stopForeground = watchForegroundPosition();

        if (perm.background) {
          startLocationTracking().catch((err) => {
            console.warn("Background tracking unavailable (foreground watch still active)", err);
          });
        }
      } catch (err) {
        console.warn("Location setup failed", err);
      }
    })();
    return () => stopForeground?.();
  }, []);

  useEffect(() => {
    let cancelled = false;
    const currentVersion = Constants.expoConfig?.version ?? "0.0.0";

    findAppUpdate(currentVersion)
      .then((update) => {
        if (!update || cancelled) return;
        Alert.alert(
          "K dispozícii je aktualizácia",
          `Truck Hours ${update.version} je pripravený na stiahnutie.`,
          [
            { text: "Neskôr", style: "cancel" },
            {
              text: "Aktualizovať",
              onPress: () => {
                downloadAndInstallAppUpdate(update).catch((error) => {
                  Alert.alert("Aktualizácia sa nepodarila", error instanceof Error ? error.message : "Skús to znova neskôr.");
                });
              },
            },
          ],
        );
      })
      .catch(() => {
        // The app remains fully usable when offline or when GitHub is unavailable.
      });

    return () => {
      cancelled = true;
    };
  }, []);

  if (!fontsLoaded) return null;

  return (
    <ErrorBoundary>
      <SafeAreaProvider>
        <QueryClientProvider client={queryClient}>
          <Stack initialRouteName="index" screenOptions={{ headerShown: false }}>
            <Stack.Screen name="index" />
            <Stack.Screen name="onboarding" />
            <Stack.Screen name="warmup" />
            <Stack.Screen name="(tabs)" />
          </Stack>
        </QueryClientProvider>
      </SafeAreaProvider>
    </ErrorBoundary>
  );
}
