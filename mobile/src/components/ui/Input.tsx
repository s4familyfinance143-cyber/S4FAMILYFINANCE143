import React from "react";
import { TextInput as PaperInput } from "react-native-paper";

type Props = {
  label: string;
  value: string;
  onChangeText: (v: string) => void;
  secureTextEntry?: boolean;
  keyboardType?: "default" | "email-address" | "numeric" | "decimal-pad";
  error?: string;
  placeholder?: string;
  autoCapitalize?: "none" | "sentences" | "words" | "characters";
  testID?: string;
  rightIcon?: string;
  onRightIconPress?: () => void;
};

export function Input({
  label,
  value,
  onChangeText,
  secureTextEntry,
  keyboardType = "default",
  error,
  placeholder,
  autoCapitalize = "none",
  testID,
  rightIcon,
  onRightIconPress,
}: Props) {
  return (
    <PaperInput
      testID={testID}
      label={label}
      value={value}
      onChangeText={onChangeText}
      secureTextEntry={secureTextEntry}
      keyboardType={keyboardType}
      placeholder={placeholder}
      autoCapitalize={autoCapitalize}
      mode="outlined"
      error={Boolean(error)}
      style={{ marginBottom: 8, backgroundColor: "#fff" }}
      right={
        rightIcon ? (
          <PaperInput.Icon icon={rightIcon} onPress={onRightIconPress} forceTextInputFocus={false} />
        ) : undefined
      }
    />
  );
}
