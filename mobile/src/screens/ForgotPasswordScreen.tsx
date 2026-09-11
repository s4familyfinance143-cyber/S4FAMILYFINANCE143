import React, { useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { StyleSheet, View } from "react-native";
import { Text } from "react-native-paper";
import { Button, Input } from "../components/ui";
import { isEmail } from "../utils/validators";
import { authService } from "../services/authService";
import { ScreenShell } from "./ScreenShell";

type ForgotValues = { email: string };

/** Forgot password — requests reset email from API. */
export function ForgotPasswordScreen({ onDone }: { onDone?: () => void }) {
  const [error, setError] = useState("");
  const [ok, setOk] = useState("");
  const [loading, setLoading] = useState(false);
  const { control, handleSubmit } = useForm<ForgotValues>({ defaultValues: { email: "" } });

  const onSubmit = handleSubmit(async (values) => {
    setError("");
    setOk("");
    const emailCheck = isEmail(values.email);
    if (!emailCheck.ok) return setError(emailCheck.message);
    setLoading(true);
    try {
      await authService.forgotPassword(values.email.trim());
      setOk("If the email exists, reset instructions were sent.");
      onDone?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Request failed");
    } finally {
      setLoading(false);
    }
  });

  return (
    <ScreenShell title="Forgot password" subtitle="We will email a reset link">
      <View style={styles.wrap}>
        <Controller
          control={control}
          name="email"
          render={({ field: { onChange, value } }) => (
            <Input label="Email" value={value} onChangeText={onChange} autoCapitalize="none" keyboardType="email-address" />
          )}
        />
        {error ? <Text style={styles.error}>{error}</Text> : null}
        {ok ? <Text style={styles.ok}>{ok}</Text> : null}
        <Button title={loading ? "…" : "Send reset"} onPress={() => void onSubmit()} loading={loading} />
      </View>
    </ScreenShell>
  );
}

const styles = StyleSheet.create({
  wrap: { padding: 16, gap: 12 },
  error: { color: "#b91c1c" },
  ok: { color: "#0f766e" },
});
