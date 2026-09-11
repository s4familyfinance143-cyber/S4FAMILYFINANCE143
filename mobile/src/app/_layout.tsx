import { AppErrorBoundary } from "../components/AppErrorBoundary";
import { queryClient } from "../lib/queryClient";
import { hydrateFastStorageKeys } from "../lib/fastStorage";
import { initSentry } from "../lib/sentry";
import { useAppStore } from "../store/appStore";
import { useSettingsStore } from "../store/settingsStore";
import { initI18n } from "../i18n/setup";
import { loadAppFonts } from "../theme/fonts";
import { QueryClientProvider } from "@tanstack/react-query";
import { Stack } from "expo-router";
import React, { useEffect } from "react";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { PaperProvider, MD3LightTheme, MD3DarkTheme } from "react-native-paper";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { colors, darkColors } from "../theme/colors";

const lightTheme = {
  ...MD3LightTheme,
  colors: {
    ...MD3LightTheme.colors,
    primary: colors.primary,
    secondary: colors.accent,
    background: colors.background,
    surface: colors.surface,
    error: colors.danger,
  },
};

const darkPaper = {
  ...MD3DarkTheme,
  colors: {
    ...MD3DarkTheme.colors,
    primary: darkColors.primary,
    secondary: darkColors.accent,
    background: darkColors.background,
    surface: darkColors.surface,
    error: darkColors.danger,
  },
};

export default function RootLayout() {
  const themeMode = useSettingsStore((s) => s.theme);
  const lang = useSettingsStore((s) => s.lang);

  useEffect(() => {
    initSentry();
    initI18n(lang || "bn");
    void loadAppFonts();
    void (async () => {
      await hydrateFastStorageKeys(["s4_theme", "s4_lang", "s4_family_id"]);
      useAppStore.getState().hydrateFromStorage();
      useSettingsStore.getState().hydrateFromStorage();
    })();
  }, []);

  useEffect(() => {
    initI18n(lang || "bn");
  }, [lang]);

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <AppErrorBoundary>
        <QueryClientProvider client={queryClient}>
          <PaperProvider theme={themeMode === "dark" ? darkPaper : lightTheme}>
            <SafeAreaProvider>
              <Stack
                screenOptions={{
                  headerShown: false,
                  contentStyle: {
                    backgroundColor: themeMode === "dark" ? darkColors.background : colors.background,
                  },
                }}
              />
            </SafeAreaProvider>
          </PaperProvider>
        </QueryClientProvider>
      </AppErrorBoundary>
    </GestureHandlerRootView>
  );
}
