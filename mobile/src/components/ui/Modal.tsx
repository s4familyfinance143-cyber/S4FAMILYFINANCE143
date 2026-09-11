import React from "react";
import { Modal as RNModal, Pressable, StyleSheet, View } from "react-native";
import { Text } from "react-native-paper";
import { colors } from "../../theme/colors";
import { spacing, radii } from "../../theme/spacing";

type Props = {
  visible: boolean;
  title?: string;
  onClose: () => void;
  children: React.ReactNode;
};

export function Modal({ visible, title, onClose, children }: Props) {
  return (
    <RNModal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={styles.sheet} onPress={(e) => e.stopPropagation()}>
          {title ? <Text style={styles.title}>{title}</Text> : null}
          {children}
        </Pressable>
      </Pressable>
    </RNModal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(7,20,15,0.45)",
    justifyContent: "center",
    padding: spacing.lg,
  },
  sheet: {
    backgroundColor: colors.surface,
    borderRadius: radii.lg,
    padding: spacing.lg,
  },
  title: {
    fontSize: 18,
    fontWeight: "700",
    color: colors.text,
    marginBottom: spacing.md,
  },
});
