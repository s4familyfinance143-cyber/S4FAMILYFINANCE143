import React from "react";
import { Input } from "./Input";

type Props = {
  label?: string;
  value: string;
  onChangeText: (v: string) => void;
  error?: string;
};

export function AmountInput({ label = "Amount", value, onChangeText, error }: Props) {
  return (
    <Input
      label={label}
      value={value}
      onChangeText={(v) => onChangeText(v.replace(/[^0-9.]/g, ""))}
      keyboardType="decimal-pad"
      error={error}
      placeholder="0.00"
    />
  );
}
