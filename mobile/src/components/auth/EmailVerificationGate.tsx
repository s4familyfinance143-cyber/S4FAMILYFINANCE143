import React, { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import {
  getVerificationResendRemainingMs,
  VERIFY_RESEND_COOLDOWN_MS,
} from "../firebase/auth";

type Props = {
  email?: string;
  uid?: string;
  busy?: boolean;
  statusMessage?: string;
  onResend?: () => Promise<void>;
  onRefresh?: () => Promise<void>;
  onSignOut?: () => Promise<void> | void;
  lang?: string;
};

export function EmailVerificationGate({
  email = "",
  uid = "",
  busy = false,
  statusMessage = "",
  onResend,
  onRefresh,
  onSignOut,
  lang = "bn",
}: Props) {
  const bn = lang === "bn";
  const [cooldownSec, setCooldownSec] = useState(0);
  const [localStatus, setLocalStatus] = useState("");
  const [resending, setResending] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    let alive = true;
    const tick = async () => {
      const remaining = await getVerificationResendRemainingMs(uid);
      if (alive) setCooldownSec(Math.ceil(remaining / 1000));
    };
    void tick();
    const id = setInterval(() => void tick(), 500);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [uid]);

  const cooldownActive = cooldownSec > 0;
  const resendDisabled = busy || resending || cooldownActive;

  async function handleResend() {
    if (resendDisabled || !onResend) return;
    setResending(true);
    setLocalStatus("");
    try {
      await onResend();
      setCooldownSec(Math.ceil(VERIFY_RESEND_COOLDOWN_MS / 1000));
      setLocalStatus(
        bn
          ? "ভেরিফিকেশন ইমেইল পাঠানো হয়েছে — ইনবক্স/স্প্যাম চেক করুন।"
          : "Verification email sent — check inbox and spam."
      );
    } catch (err: any) {
      setLocalStatus(err?.message || (bn ? "ইমেইল পাঠানো যায়নি" : "Could not send email"));
    } finally {
      setResending(false);
    }
  }

  async function handleRefresh() {
    if (!onRefresh || refreshing) return;
    setRefreshing(true);
    setLocalStatus("");
    try {
      await onRefresh();
    } catch (err: any) {
      setLocalStatus(err?.message || (bn ? "রিফ্রেশ ব্যর্থ" : "Refresh failed"));
    } finally {
      setRefreshing(false);
    }
  }

  return (
    <View style={styles.root} accessibilityRole="summary">
      <View style={styles.card}>
        <Text style={styles.eyebrow}>{bn ? "সুরক্ষিত ক্লাউড" : "Secure cloud"}</Text>
        <Text style={styles.title}>{bn ? "ইমেইল ভেরিফাই করুন" : "Verify your email"}</Text>
        <Text style={styles.body}>
          {bn
            ? "ক্লাউড সিঙ্কের আগে ইমেইল নিশ্চিত করতে হবে।"
            : "Confirm your email before cloud sync unlocks."}
        </Text>
        {email ? (
          <Text style={styles.mail}>
            <Text style={styles.mailStrong}>{email}</Text>
          </Text>
        ) : null}
        <Text style={styles.hint}>
          {cooldownActive
            ? (bn ? `${cooldownSec} সেকেন্ড পর আবার পাঠাতে পারবেন` : `You can resend in ${cooldownSec}s`)
            : bn
              ? "এখন আবার লিংক পাঠাতে পারেন।"
              : "You can resend the link now."}
        </Text>
        {localStatus || statusMessage ? (
          <Text style={styles.status}>{localStatus || statusMessage}</Text>
        ) : null}

        <Pressable
          style={[styles.primary, resendDisabled ? styles.disabled : null]}
          disabled={resendDisabled}
          onPress={() => void handleResend()}
        >
          {resending || busy ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.primaryText}>
              {cooldownActive
                ? bn
                  ? `${cooldownSec}s পরে আবার`
                  : `Resend in ${cooldownSec}s`
                : bn
                  ? "আবার পাঠান"
                  : "Resend link"}
            </Text>
          )}
        </Pressable>

        <Pressable style={styles.secondary} onPress={() => void handleRefresh()} disabled={refreshing}>
          <Text style={styles.secondaryText}>
            {refreshing ? "…" : bn ? "আমি ভেরিফাই করেছি — রিফ্রেশ" : "I verified — Refresh"}
          </Text>
        </Pressable>

        <Pressable style={styles.link} onPress={() => void onSignOut?.()}>
          <Text style={styles.linkText}>{bn ? "সাইন আউট" : "Sign out"}</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    padding: 20,
    justifyContent: "center",
    backgroundColor: "#07140f",
  },
  card: {
    backgroundColor: "#0f241c",
    borderRadius: 16,
    padding: 20,
    borderWidth: 1,
    borderColor: "#1d3d30",
  },
  eyebrow: { color: "#7dbaa0", fontSize: 12, marginBottom: 8, letterSpacing: 0.6 },
  title: { color: "#f4faf7", fontSize: 22, fontWeight: "700", marginBottom: 8 },
  body: { color: "#b7d0c4", fontSize: 15, lineHeight: 22, marginBottom: 12 },
  mail: { marginBottom: 10 },
  mailStrong: { color: "#e8fff4", fontWeight: "700", fontSize: 16 },
  hint: { color: "#8aa39a", fontSize: 13, marginBottom: 12 },
  status: { color: "#9fe0c0", fontSize: 13, marginBottom: 12 },
  primary: {
    backgroundColor: "#1D9E75",
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: "center",
    marginBottom: 10,
  },
  primaryText: { color: "#fff", fontWeight: "700", fontSize: 15 },
  secondary: {
    borderWidth: 1,
    borderColor: "#2a5544",
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: "center",
    marginBottom: 8,
  },
  secondaryText: { color: "#d5eee3", fontWeight: "600" },
  link: { alignItems: "center", paddingVertical: 8 },
  linkText: { color: "#8aa39a", fontSize: 14 },
  disabled: { opacity: 0.55 },
});
