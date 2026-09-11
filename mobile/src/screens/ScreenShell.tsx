import React from "react";
import { StyleSheet, View } from "react-native";
import { Text } from "react-native-paper";
import { colors } from "../theme/colors";

type Props = {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
};

/** Shared chrome for checklist screens — real screen files, not bare re-exports. */
export function ScreenShell({ title, subtitle, children }: Props) {
  return (
    <View style={styles.wrap}>
      <View style={styles.header}>
        <Text style={styles.title}>{title}</Text>
        {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
      </View>
      <View style={styles.body}>{children}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: colors.background },
  header: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 4 },
  title: { fontSize: 22, fontWeight: "800", color: colors.primaryDark },
  subtitle: { marginTop: 2, color: colors.textSecondary, fontSize: 13 },
  body: { flex: 1 },
});
