import React from "react";
import { Button as PaperButton } from "react-native-paper";
import { colors } from "../../theme/colors";

type Props = {
  title: string;
  onPress: () => void;
  loading?: boolean;
  disabled?: boolean;
  mode?: "contained" | "outlined" | "text";
  danger?: boolean;
  testID?: string;
};

export function Button({ title, onPress, loading, disabled, mode = "contained", danger, testID }: Props) {
  return (
    <PaperButton
      testID={testID}
      mode={mode}
      onPress={onPress}
      loading={loading}
      disabled={disabled || loading}
      buttonColor={danger ? colors.danger : mode === "contained" ? colors.primary : undefined}
      textColor={mode === "contained" ? "#fff" : colors.primary}
      style={{ borderRadius: 12 }}
    >
      {title}
    </PaperButton>
  );
}
