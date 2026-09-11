import React, { useState } from "react";
import { Modal, Platform, Pressable, StyleSheet, Text, View } from "react-native";

export type SelectOption = { value: string; label: string };

type Props = {
  label: string;
  value: string;
  options: SelectOption[];
  onChange: (value: string) => void;
  dark?: boolean;
};

/** Single closed dropdown (PC-style) — not a row of chips. */
export function MobileDropdown({ label, value, options, onChange, dark = false }: Props) {
  const [open, setOpen] = useState(false);
  const selected = options.find((item) => item.value === value) || options[0];
  const palette = dark
    ? {
        border: "#2b3c37",
        bg: "#182724",
        text: "#eef8f5",
        muted: "#9dafaa",
        soft: "#173c31",
        primary: "#35c49a",
      }
    : {
        border: "#dce7e3",
        bg: "#f8fbfa",
        text: "#17211e",
        muted: "#6c7b76",
        soft: "#e0f4ed",
        primary: "#0f8f6f",
      };

  if (Platform.OS === "web") {
    return (
      <View style={styles.wrap}>
        <Text style={[styles.label, { color: palette.muted }]}>{label}</Text>
        {/* @ts-expect-error web select */}
        <select
          value={value}
          onChange={(e: { target: { value: string } }) => onChange(e.target.value)}
          style={{
            width: "100%",
            height: 46,
            borderRadius: 14,
            border: `1px solid ${palette.border}`,
            background: palette.bg,
            color: palette.text,
            padding: "0 12px",
            fontWeight: 800,
            fontSize: 13,
          }}
        >
          {options.map((item) => (
            <option key={item.value} value={item.value}>
              {item.label}
            </option>
          ))}
        </select>
      </View>
    );
  }

  return (
    <View style={styles.wrap}>
      <Text style={[styles.label, { color: palette.muted }]}>{label}</Text>
      <Pressable
        style={[styles.field, { borderColor: palette.border, backgroundColor: palette.bg }]}
        onPress={() => setOpen(true)}
      >
        <Text style={[styles.value, { color: palette.text }]} numberOfLines={1}>
          {selected?.label || value}
        </Text>
        <Text style={{ color: palette.primary, fontWeight: "900" }}>▾</Text>
      </Pressable>

      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <View style={styles.backdrop}>
          <Pressable style={StyleSheet.absoluteFillObject} onPress={() => setOpen(false)} />
          <View style={[styles.sheet, { backgroundColor: dark ? "#14201d" : "#ffffff", borderColor: palette.border }]}>
            <Text style={[styles.sheetTitle, { color: palette.text }]}>{label}</Text>
            {options.map((item) => {
              const active = item.value === value;
              return (
                <Pressable
                  key={item.value}
                  style={[styles.option, active ? { backgroundColor: palette.soft } : null]}
                  onPress={() => {
                    onChange(item.value);
                    setOpen(false);
                  }}
                >
                  <Text style={[styles.optionText, { color: active ? palette.primary : palette.text }]}>{item.label}</Text>
                </Pressable>
              );
            })}
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 6 },
  label: { fontSize: 12, fontWeight: "900" },
  field: {
    minHeight: 46,
    borderRadius: 14,
    borderWidth: 1,
    paddingHorizontal: 12,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  value: { flex: 1, fontSize: 13, fontWeight: "800" },
  backdrop: { flex: 1, backgroundColor: "rgba(7,19,15,0.45)", justifyContent: "flex-end" },
  sheet: {
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    borderWidth: 1,
    padding: 16,
    paddingBottom: 28,
    gap: 6,
  },
  sheetTitle: { fontSize: 15, fontWeight: "900", marginBottom: 6 },
  option: { borderRadius: 12, paddingVertical: 12, paddingHorizontal: 12 },
  optionText: { fontSize: 14, fontWeight: "800" },
});
