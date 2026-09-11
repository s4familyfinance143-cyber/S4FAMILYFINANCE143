import React from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { Text } from "react-native-paper";
import { colors } from "../theme/colors";

type DrawerListProps = {
  active?: string;
  onNavigate: (route: string) => void;
  labels?: Record<string, string>;
};

/** Compact module list for Expo Go / More sheet — no React Navigation. */
export function MobileMoreDrawerList({ active, onNavigate, labels = {} }: DrawerListProps) {
  const routes = [
    "grocery",
    "planner",
    "life",
    "family",
    "zakat",
    "alerts",
    "audit",
    "settings",
    "sync",
    "backup",
    "currency",
  ];
  return (
    <View style={styles.wrap}>
      {routes.map((route) => (
        <Pressable
          key={route}
          style={[styles.item, active === route ? styles.active : null]}
          onPress={() => onNavigate(route)}
        >
          <Text style={[styles.label, active === route ? styles.activeLabel : null]}>
            {labels[route] || route}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 4 },
  item: {
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 10,
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: colors.border,
  },
  active: { backgroundColor: "#e7f6f1", borderColor: colors.primary },
  label: { color: colors.text, fontWeight: "600", textTransform: "capitalize" },
  activeLabel: { color: colors.primaryDark },
});

/** @deprecated Prefer MobileMoreDrawerList */
export const DrawerNav = MobileMoreDrawerList;
