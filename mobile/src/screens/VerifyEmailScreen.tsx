import React, { useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { StyleSheet, View } from "react-native";
import { Text } from "react-native-paper";
import { Button, Input } from "../components/ui";
import { authService } from "../services/authService";
import { ScreenShell } from "./ScreenShell";

type VerifyValues = { token: string };

/** Verify email — posts token from inbox link/email. */
export function VerifyEmailScreen({ onDone }: { onDone?: () => void }) {
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const { control, handleSubmit } = useForm<VerifyValues>({ defaultValues: { token: "" } });

  const onSubmit = handleSubmit(async (values) => {
    setError("");
    if (!values.token.trim()) return setError("Verification token is required");
    setLoading(true);
    try {
      await authService.verifyEmail(values.token.trim());
      onDone?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Verify failed");
    } finally {
      setLoading(false);
    }
  });

  return (
    <ScreenShell title="Verify email" subtitle="Paste the token from your email">
      <View style={styles.wrap}>
        <Controller
          control={control}
          name="token"
          render={({ field: { onChange, value } }) => (
            <Input label="Token" value={value} onChangeText={onChange} autoCapitalize="none" />
          )}
        />
        {error ? <Text style={styles.error}>{error}</Text> : null}
        <Button title={loading ? "…" : "Verify"} onPress={() => void onSubmit()} loading={loading} />
      </View>
    </ScreenShell>
  );
}

const styles = StyleSheet.create({
  wrap: { padding: 16, gap: 12 },
  error: { color: "#b91c1c" },
});
