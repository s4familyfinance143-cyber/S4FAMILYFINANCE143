/**
 * RootNavigator — React Navigation tree:
 * AuthStack (logged out) | Drawer → MainTab + modules (logged in)
 */
import { NavigationContainer, DarkTheme, DefaultTheme } from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import React from "react";
import { AuthStackNavigator } from "./AuthStack";
import { DrawerNavigator } from "./DrawerNav";
import { useAuthStore } from "../store/authStore";
import { useSettingsStore } from "../store/settingsStore";
import { colors, darkColors } from "../theme/colors";

export type RootStackParamList = {
  Auth: undefined;
  App: undefined;
};

const Stack = createNativeStackNavigator<RootStackParamList>();

export function RootNavigator() {
  const token = useAuthStore((s) => s.token);
  const themeMode = useSettingsStore((s) => s.theme);
  const navTheme =
    themeMode === "dark"
      ? {
          ...DarkTheme,
          colors: { ...DarkTheme.colors, primary: darkColors.primary, background: darkColors.background, card: darkColors.surface },
        }
      : {
          ...DefaultTheme,
          colors: { ...DefaultTheme.colors, primary: colors.primary, background: colors.background, card: colors.surface },
        };

  return (
    <NavigationContainer theme={navTheme} independent>
      <Stack.Navigator screenOptions={{ headerShown: false }}>
        {token ? (
          <Stack.Screen name="App" component={DrawerNavigator} />
        ) : (
          <Stack.Screen name="Auth" component={AuthStackNavigator} />
        )}
      </Stack.Navigator>
    </NavigationContainer>
  );
}

export const AuthStackRoutes = ["login", "register", "verify-email"] as const;
export const MainTabRoutes = ["home", "finance", "reports", "more"] as const;
export { DrawerNavRoutes } from "./DrawerNav";
export type { DrawerNavRoute } from "./DrawerNav";
export type MainTabRoute = (typeof MainTabRoutes)[number];
