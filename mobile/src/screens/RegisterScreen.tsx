import React, { useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { StyleSheet, View } from "react-native";
import { Text } from "react-native-paper";
import { useTranslation } from "react-i18next";
import { Button, Input } from "../components/ui";
import { isEmail, isStrongPassword } from "../utils/validators";
import { authService } from "../services/authService";
import { ScreenShell } from "./ScreenShell";

type RegisterValues = { email: string; password: string; full_name: string };

/** Register screen — creates account via authService. */
export function RegisterScreen({ onDone }: { onDone?: () => void }) {
  const { t } = useTranslation();
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const { control, handleSubmit } = useForm<RegisterValues>({
    defaultValues: { email: "", password: "", full_name: "" },
  });

  const onSubmit = handleSubmit(async (values) => {
    setError("");
    const emailCheck = isEmail(values.email);
    if (!emailCheck.ok) return setError(emailCheck.message);
    if (!values.full_name.trim()) return setError("Full name is required");
    const pw = isStrongPassword(values.password);
    if (!pw.ok) return setError(pw.message);
    setLoading(true);
    try {
      await authService.register({
        email: values.email.trim(),
        password: values.password,
        full_name: values.full_name.trim(),
      });
      onDone?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Register failed");
    } finally {
      setLoading(false);
    }
  });

  return (
    <ScreenShell title={t("signUp") || "Register"} subtitle="Create S4 Family account">
      <View style={styles.wrap}>
        <Controller
          control={control}
          name="full_name"
          render={({ field: { onChange, value } }) => (
            <Input label="Full name" value={value} onChangeText={onChange} autoCapitalize="words" />
          )}
        />
        <Controller
          control={control}
          name="email"
          render={({ field: { onChange, value } }) => (
            <Input label="Email" value={value} onChangeText={onChange} autoCapitalize="none" keyboardType="email-address" />
          )}
        />
        <Controller
          control={control}
          name="password"
          render={({ field: { onChange, value } }) => (
            <Input label="Password" value={value} onChangeText={onChange} secureTextEntry />
          )}
        />
        {error ? <Text style={styles.error}>{error}</Text> : null}
        <Button title={loading ? "…" : t("signUp") || "Register"} onPress={() => void onSubmit()} loading={loading} />
      </View>
    </ScreenShell>
  );
}

const styles = StyleSheet.create({
  wrap: { padding: 16, gap: 12 },
  error: { color: "#b91c1c" },
});
