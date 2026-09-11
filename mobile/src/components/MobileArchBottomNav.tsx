import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

type Props = {
  active: "home" | "finance" | "reports" | "more";
  onHome: () => void;
  onFinance: () => void;
  onAdd: () => void;
  onReports: () => void;
  onMore: () => void;
  homeLabel?: string;
  financeLabel?: string;
  reportsLabel?: string;
  moreLabel?: string;
  addLabel?: string;
};

export function MobileArchBottomNav({
  active,
  onHome,
  onFinance,
  onAdd,
  onReports,
  onMore,
  homeLabel = "Home",
  financeLabel = "লেনদেন",
  reportsLabel = "Reports",
  moreLabel = "More",
  addLabel = "Add",
}: Props) {
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.nav, { paddingBottom: Math.max(insets.bottom, 8) }]}>
      <Pressable style={[styles.btn, active === "home" ? styles.active : null]} onPress={onHome}>
        <Text style={[styles.icon, active === "home" ? styles.activeLabel : null]}>⌂</Text>
        <Text style={[styles.label, active === "home" ? styles.activeLabel : null]}>{homeLabel}</Text>
      </Pressable>
      <Pressable style={[styles.btn, active === "finance" ? styles.active : null]} onPress={onFinance}>
        <Text style={[styles.icon, active === "finance" ? styles.activeLabel : null]}>↕</Text>
        <Text style={[styles.label, active === "finance" ? styles.activeLabel : null]}>{financeLabel}</Text>
      </Pressable>
      <Pressable style={styles.addWrap} onPress={onAdd}>
        <View style={styles.addBtn}>
          <Text style={styles.addIcon}>＋</Text>
        </View>
        <Text style={styles.addLabel}>{addLabel}</Text>
      </Pressable>
      <Pressable style={[styles.btn, active === "reports" ? styles.active : null]} onPress={onReports}>
        <Text style={[styles.icon, active === "reports" ? styles.activeLabel : null]}>▥</Text>
        <Text style={[styles.label, active === "reports" ? styles.activeLabel : null]}>{reportsLabel}</Text>
      </Pressable>
      <Pressable style={[styles.btn, active === "more" ? styles.active : null]} onPress={onMore}>
        <Text style={[styles.icon, active === "more" ? styles.activeLabel : null]}>☷</Text>
        <Text style={[styles.label, active === "more" ? styles.activeLabel : null]}>{moreLabel}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  nav: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 90,
    flexDirection: "row",
    alignItems: "flex-start",
    paddingTop: 7,
    paddingHorizontal: 8,
    borderTopWidth: 1,
    borderTopColor: "#dce7e3",
    backgroundColor: "rgba(255,255,255,0.96)",
    shadowColor: "#10372b",
    shadowOpacity: 0.1,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: -4 },
    elevation: 12,
  },
  btn: {
    flex: 1,
    height: 54,
    alignItems: "center",
    justifyContent: "center",
    gap: 3,
    borderRadius: 14,
  },
  active: { backgroundColor: "#e0f4ed" },
  icon: { fontSize: 19, color: "#6c7b76" },
  label: { fontSize: 8.5, fontWeight: "800", color: "#6c7b76" },
  activeLabel: { color: "#0b6f58" },
  addWrap: {
    flex: 1,
    alignItems: "center",
    top: -18,
  },
  addBtn: {
    width: 56,
    height: 56,
    borderRadius: 19,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#0f8f6f",
    borderWidth: 5,
    borderColor: "#ffffff",
    shadowColor: "#0f8f6f",
    shadowOpacity: 0.33,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 8,
  },
  addIcon: { color: "#ffffff", fontSize: 27, fontWeight: "700", lineHeight: 30 },
  addLabel: { fontSize: 8.5, fontWeight: "800", color: "#0b6f58", marginTop: 2 },
});
