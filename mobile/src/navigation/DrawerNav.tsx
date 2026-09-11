import { createDrawerNavigator } from "@react-navigation/drawer";
import React from "react";
import { MainTabNavigator } from "./MainTab";
import { GroceryHost, BudgetHost, LoansHost, SettingsHost, ExpenseHost } from "./screenHosts";
import { colors } from "../theme/colors";

export const DrawerNavRoutes = ["Main", "Grocery", "Budget", "Loans", "Expense", "Settings"] as const;
export type DrawerNavRoute = (typeof DrawerNavRoutes)[number];

export type DrawerParamList = {
  Main: undefined;
  Grocery: undefined;
  Budget: undefined;
  Loans: undefined;
  Expense: undefined;
  Settings: undefined;
};

const Drawer = createDrawerNavigator<DrawerParamList>();

/** React Navigation drawer — native/dev builds only (not Expo Go). */
export function DrawerNavigator() {
  return (
    <Drawer.Navigator
      screenOptions={{
        headerShown: true,
        headerTintColor: colors.primaryDark,
        drawerActiveTintColor: colors.primary,
      }}
    >
      <Drawer.Screen name="Main" component={MainTabNavigator} options={{ title: "S4 Family" }} />
      <Drawer.Screen name="Grocery" component={GroceryHost} />
      <Drawer.Screen name="Budget" component={BudgetHost} />
      <Drawer.Screen name="Loans" component={LoansHost} />
      <Drawer.Screen name="Expense" component={ExpenseHost} />
      <Drawer.Screen name="Settings" component={SettingsHost} />
    </Drawer.Navigator>
  );
}

/** @deprecated Use MobileMoreDrawerList in Expo Router / Expo Go. */
export { MobileMoreDrawerList as DrawerNav } from "../components/MobileMoreDrawerList";
