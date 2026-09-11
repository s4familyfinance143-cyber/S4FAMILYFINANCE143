import React, { useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { StyleSheet, View } from "react-native";
import { Text } from "react-native-paper";
import { useTranslation } from "react-i18next";
import { Button, Input } from "../components/ui";
import { isEmail, isStrongPassword } from "../utils/validators";
import { useAuth } from "../hooks/useAuth";

type FormValues = { email: string; password: string };

type Props = {
  onSuccess?: () => void;
  /** Keep legacy parent login as fallback bridge */
  onLegacySubmit?: (email: string, password: string) => Promise<void>;
};

export function LoginScreen({ onSuccess, onLegacySubmit }: Props) {
  const { t } = useTranslation();
  const { login, loading, error } = useAuth();
  const [showPassword, setShowPassword] = useState(false);
  const { control, handleSubmit, formState } = useForm<FormValues>({
    defaultValues: { email: "", password: "" },
  });

  const onSubmit = handleSubmit(async (values) => {
    const emailCheck = isEmail(values.email);
    if (!emailCheck.ok) throw new Error(emailCheck.message);
    const pwCheck = isStrongPassword(values.password);
    // Allow login even if password policy differs from register (server validates)
    void pwCheck;
    if (onLegacySubmit) {
      await onLegacySubmit(values.email.trim(), values.password);
    } else {
      await login(values.email.trim(), values.password);
    }
    onSuccess?.();
  });

  return (
    <View testID="auth-screen" style={styles.wrap}>
      <Text variant="headlineSmall" style={styles.title}>
        {t("login")}
      </Text>
      <Controller
        control={control}
        name="email"
        rules={{ required: true }}
        render={({ field: { onChange, value } }) => (
          <Input
            testID="auth-email"
            label={t("email")}
            value={value}
            onChangeText={onChange}
            keyboardType="email-address"
            autoCapitalize="none"
          />
        )}
      />
      <Controller
        control={control}
        name="password"
        rules={{ required: true }}
        render={({ field: { onChange, value } }) => (
          <Input
            testID="auth-password"
            label={t("password")}
            value={value}
            onChangeText={onChange}
            secureTextEntry={!showPassword}
            rightIcon={showPassword ? "eye-off" : "eye"}
            onRightIconPress={() => setShowPassword((v) => !v)}
          />
        )}
      />
      {error || formState.errors.email ? (
        <Text style={styles.error}>{error || "Check email/password"}</Text>
      ) : null}
      <Button testID="auth-sign-in" title={loading ? t("signingIn") : t("signIn")} onPress={() => void onSubmit()} loading={loading} />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 4, width: "100%" },
  title: { fontWeight: "700", marginBottom: 8 },
  error: { color: "#b42318", marginBottom: 8 },
});
