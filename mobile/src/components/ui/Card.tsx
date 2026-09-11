import React from "react";
import { StyleSheet, View, type ViewProps } from "react-native";
import { Card as PaperCard, Text } from "react-native-paper";
import { colors } from "../../theme/colors";
import { spacing, radii } from "../../theme/spacing";

type Props = ViewProps & {
  title?: string;
  children: React.ReactNode;
};

export function Card({ title, children, style, ...rest }: Props) {
  return (
    <PaperCard style={[styles.card, style]} {...rest}>
      <PaperCard.Content>
        {title ? <Text style={styles.title}>{title}</Text> : null}
        <View>{children}</View>
      </PaperCard.Content>
    </PaperCard>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: radii.lg,
    marginBottom: spacing.md,
    borderColor: colors.border,
    borderWidth: 1,
  },
  title: {
    fontSize: 16,
    fontWeight: "700",
    color: colors.text,
    marginBottom: spacing.sm,
  },
});
