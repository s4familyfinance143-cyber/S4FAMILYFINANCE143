/**
 * Host screens for React Navigation — wired to Zustand stores + real api client.
 */
import React from "react";
import { View } from "react-native";
import { Text } from "react-native-paper";
import { IncomeScreen } from "../screens/IncomeScreen";
import { ExpenseScreen } from "../screens/ExpenseScreen";
import { GroceryScreen } from "../screens/GroceryScreen";
import { LoansScreen } from "../screens/LoansScreen";
import { BudgetScreen } from "../screens/BudgetScreen";
import { ReportsScreen } from "../screens/ReportsScreen";
import { SettingsScreen } from "../screens/SettingsScreen";
import { LoginScreen } from "../screens/AuthScreen";
import { RegisterScreen } from "../screens/RegisterScreen";
import { VerifyEmailScreen } from "../screens/VerifyEmailScreen";
import { ForgotPasswordScreen } from "../screens/ForgotPasswordScreen";
import { useAuthStore } from "../store/authStore";
import { useFamilyStore } from "../store/familyStore";
import { useSettingsStore } from "../store/settingsStore";
import { api, getApiBaseUrl } from "../services/api";
import { colors } from "../theme/colors";

const noop = () => undefined;
const money = (v?: string | number | null, c = "AED") => `${c} ${Number(v || 0).toFixed(2)}`;
const t = (k: string) => k;

const apiGet = <T = any>(path: string, token?: string | null) => api.get<T>(path, token);
const apiPost = <T = any>(path: string, body?: unknown, token?: string | null) => api.post<T>(path, body, token);
const apiPatch = <T = any>(path: string, body?: unknown, token?: string | null) => api.patch<T>(path, body, token);
const apiPut = <T = any>(path: string, body?: unknown, token?: string | null) => api.put<T>(path, body, token);

export function LoginHost() {
  return (
    <View style={{ flex: 1, padding: 16, backgroundColor: colors.background }}>
      <LoginScreen />
    </View>
  );
}

export function RegisterHost() {
  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <RegisterScreen />
    </View>
  );
}

export function VerifyEmailHost() {
  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <VerifyEmailScreen />
    </View>
  );
}

export function ForgotPasswordHost() {
  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <ForgotPasswordScreen />
    </View>
  );
}

export function DashboardHost() {
  return (
    <View style={{ flex: 1, padding: 24, backgroundColor: colors.background, justifyContent: "center" }}>
      <Text variant="titleMedium" style={{ color: colors.onBackground, marginBottom: 8 }}>
        Dashboard host unused
      </Text>
      <Text style={{ color: colors.onSurfaceVariant }}>
        Primary UI is Expo Router (`src/app/index.tsx`). This React Navigation host is intentionally
        disabled so stub/noop screens are not shown.
      </Text>
    </View>
  );
}

function session() {
  return {
    token: useAuthStore.getState().token || "",
    familyId: useFamilyStore.getState().familyId || "",
    lang: (useSettingsStore.getState().lang || "bn") as "bn" | "en",
    theme: (useSettingsStore.getState().theme || "light") as "light" | "dark",
  };
}

async function queueOfflineAction(entityType: string, action: string, payload: object) {
  const familyId = useFamilyStore.getState().familyId || "";
  if (!familyId) return;
  const { saveOfflineFirst } = await import("../database/offlineFirstWrite");
  await saveOfflineFirst({
    familyId,
    entityType,
    action,
    payload: payload as Record<string, unknown>,
  });
}

function NeedSession({ label }: { label: string }) {
  return (
    <View style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: 24 }}>
      <Text style={{ color: colors.text }}>Sign in to open {label}</Text>
    </View>
  );
}

export function IncomeHost() {
  const { token, familyId, lang } = session();
  if (!token || !familyId) return <NeedSession label="Income" />;
  return (
    <IncomeScreen
      token={token}
      familyId={familyId}
      currency="AED"
      lang={lang}
      apiGet={apiGet}
      apiPost={apiPost}
      apiPatch={apiPatch}
      formatAmount={money}
      onQueueOffline={queueOfflineAction}
      onMessage={noop}
      onChanged={noop}
    />
  );
}

export function ExpenseHost() {
  const { token, familyId, lang } = session();
  if (!token || !familyId) return <NeedSession label="Expense" />;
  return (
    <ExpenseScreen
      token={token}
      familyId={familyId}
      currency="AED"
      lang={lang}
      apiGet={apiGet}
      apiPost={apiPost}
      apiPatch={apiPatch}
      formatAmount={money}
      onQueueOffline={queueOfflineAction}
      onMessage={noop}
      onChanged={noop}
    />
  );
}

export function LoansHost() {
  const { token, familyId, lang } = session();
  if (!token || !familyId) return <NeedSession label="Loans" />;
  return (
    <LoansScreen
      token={token}
      familyId={familyId}
      currency="AED"
      lang={lang}
      apiGet={apiGet}
      apiPost={apiPost}
      apiPatch={apiPatch}
      formatAmount={money}
      onQueueOffline={queueOfflineAction}
      onMessage={noop}
      onChanged={noop}
    />
  );
}

export function BudgetHost() {
  const { token, familyId, lang } = session();
  if (!token || !familyId) return <NeedSession label="Budget" />;
  return (
    <BudgetScreen
      token={token}
      familyId={familyId}
      currency="AED"
      lang={lang}
      apiGet={apiGet}
      apiPost={apiPost}
      apiPatch={apiPatch}
      formatAmount={money}
      onQueueOffline={queueOfflineAction}
      onMessage={noop}
      onChanged={noop}
    />
  );
}

export function GroceryHost() {
  const { token, familyId, lang } = session();
  if (!token || !familyId) return <NeedSession label="Grocery" />;
  return (
    <GroceryScreen
      token={token}
      familyId={familyId}
      currency="AED"
      apiBaseUrl={getApiBaseUrl()}
      lang={lang}
      apiGet={apiGet}
      apiPost={apiPost}
      apiPut={apiPut}
      formatAmount={money}
      onQueueOffline={queueOfflineAction}
      onMessage={noop}
      onChanged={noop}
    />
  );
}

export function ReportsHost() {
  const { token, familyId, lang } = session();
  if (!token || !familyId) return <NeedSession label="Reports" />;
  return (
    <ReportsScreen
      token={token}
      familyId={familyId}
      currency="AED"
      apiBaseUrl={getApiBaseUrl()}
      lang={lang}
      apiGet={apiGet}
      formatAmount={money}
      onMessage={noop}
    />
  );
}

export function SettingsHost() {
  const { token, familyId, lang, theme } = session();
  return (
    <SettingsScreen
      token={token}
      familyId={familyId || "local"}
      families={[]}
      apiBaseUrl={getApiBaseUrl()}
      lang={lang}
      theme={theme}
      apiGet={apiGet}
      apiPost={apiPost}
      apiPatch={apiPatch}
      onMessage={noop}
    />
  );
}
