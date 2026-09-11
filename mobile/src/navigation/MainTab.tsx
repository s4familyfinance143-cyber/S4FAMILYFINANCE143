import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import React from "react";
import { DashboardHost, IncomeHost, ReportsHost, SettingsHost } from "./screenHosts";
import { colors } from "../theme/colors";

export type MainTabParamList = {
  Home: undefined;
  Finance: undefined;
  Reports: undefined;
  More: undefined;
};

const Tab = createBottomTabNavigator<MainTabParamList>();

/** Bottom tabs — Home / Finance / Reports / More. */
export function MainTabNavigator() {
  return (
    <Tab.Navigator
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.textSecondary,
      }}
    >
      <Tab.Screen name="Home" component={DashboardHost} options={{ title: "Home" }} />
      <Tab.Screen name="Finance" component={IncomeHost} options={{ title: "Finance" }} />
      <Tab.Screen name="Reports" component={ReportsHost} options={{ title: "Reports" }} />
      <Tab.Screen name="More" component={SettingsHost} options={{ title: "More" }} />
    </Tab.Navigator>
  );
}

export const MainTabConfig = {
  id: "MainTab",
  screens: {
    Home: "home",
    Finance: "finance",
    Add: "add",
    Reports: "reports",
    More: "more",
  },
} as const;

export { MainTabNavigator as MainTab };
export { MobileArchBottomNav as MainTabBar } from "../components/MobileArchBottomNav";
