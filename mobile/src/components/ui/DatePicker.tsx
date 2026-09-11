import React, { useMemo, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { Text } from "react-native-paper";
import { formatDate, toIsoDate } from "../../utils/formatDate";
import { colors } from "../../theme/colors";
import { Modal } from "./Modal";
import { Button } from "./Button";

type Props = {
  label?: string;
  value: string;
  onChange: (isoDate: string) => void;
};

/** Lightweight date picker — ISO date string (YYYY-MM-DD). */
export function DatePicker({ label = "Date", value, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const display = useMemo(() => formatDate(value || toIsoDate()), [value]);

  function shift(days: number) {
    const base = value ? new Date(value) : new Date();
    base.setDate(base.getDate() + days);
    onChange(base.toISOString().slice(0, 10));
  }

  return (
    <View style={styles.wrap}>
      <Text style={styles.label}>{label}</Text>
      <Pressable style={styles.field} onPress={() => setOpen(true)}>
        <Text>{display}</Text>
      </Pressable>
      <Modal visible={open} title={label} onClose={() => setOpen(false)}>
        <View style={styles.row}>
          <Button title="-1 day" mode="outlined" onPress={() => shift(-1)} />
          <Button title="Today" mode="outlined" onPress={() => onChange(new Date().toISOString().slice(0, 10))} />
          <Button title="+1 day" mode="outlined" onPress={() => shift(1)} />
        </View>
        <View style={{ height: 12 }} />
        <Button title="Done" onPress={() => setOpen(false)} />
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginBottom: 8 },
  label: { marginBottom: 4, color: colors.textSecondary, fontWeight: "600" },
  field: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    padding: 14,
    backgroundColor: "#fff",
  },
  row: { flexDirection: "row", justifyContent: "space-between", gap: 8 },
});
