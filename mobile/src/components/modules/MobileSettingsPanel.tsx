import React, { useCallback, useEffect, useRef, useState } from "react";
import { Image, Platform, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import * as DocumentPicker from "expo-document-picker";

import { MobileDropdown } from "../MobileDropdown";
import { LOCKED_LANGUAGES, tMobile, type MobileLang, type MobileTheme } from "../../i18n";
import {
  clearLocalCrashes,
  getCrashReportingStatus,
  listLocalCrashes,
  type CrashRecord,
} from "../../lib/sentry";

type Family = { id: string; name: string; default_currency?: string; timezone?: string };
type UserProfile = {
  id?: string;
  full_name?: string;
  email?: string;
  is_email_verified?: boolean;
  is_active?: boolean;
  preferred_language?: string;
  avatar_url?: string | null;
};

type MemberPerm = {
  member_id: string;
  user_id?: string;
  role?: string;
  normalized_role?: string;
  relationship?: string;
  effective_permissions?: string[];
  overrides?: { id?: string; permission_key?: string; allow?: boolean; scope?: string }[];
};

type Props = {
  token: string;
  refreshToken?: string;
  familyId: string;
  families: Family[];
  apiBaseUrl: string;
  lang?: MobileLang;
  theme?: MobileTheme;
  onChangeLang?: (lang: MobileLang) => void;
  onChangeTheme?: (theme: MobileTheme) => void;
  apiGet: (path: string, authToken?: string) => Promise<any>;
  apiPost: (path: string, body: object, authToken?: string) => Promise<any>;
  apiPatch: (path: string, body: object, authToken?: string) => Promise<any>;
  onMessage: (message: string, ok?: boolean) => void;
  onFamilyUpdated?: () => void;
  onSessionRefreshed?: (accessToken: string, nextRefreshToken?: string, user?: UserProfile) => void;
  onApiBaseChange?: (nextUrl: string) => Promise<void> | void;
};

const TABS = ["profile", "family", "permissions", "security"] as const;
type SettingsTab = (typeof TABS)[number];

const CURRENCY_PRESETS = ["BDT", "USD", "EUR", "INR", "SAR"];
const TIMEZONE_PRESETS = ["Asia/Dhaka", "Asia/Kolkata", "Asia/Dubai", "UTC"];
const COMMON_PERMISSION_KEYS = [
  "dashboard.read",
  "accounts.create",
  "accounts.read",
  "transactions.create",
  "income.create",
  "expense.create",
  "transactions.read",
  "reports.read",
  "audit.read",
  "backup.create",
  "backup.read",
  "backup.download",
  "backup.restore",
  "sync.view",
  "sync.pull",
  "sync.push",
  "sync.conflicts",
  "sync.resolve",
  "sync.manage",
  "settings.manage",
];

export function MobileSettingsPanel({
  token,
  refreshToken = "",
  familyId,
  families,
  apiBaseUrl,
  lang = "bn",
  theme = "light",
  onChangeLang,
  onChangeTheme,
  apiGet,
  apiPost,
  apiPatch,
  onMessage,
  onFamilyUpdated,
  onSessionRefreshed,
  onApiBaseChange,
}: Props) {
  const tm = (key: string) => tMobile(lang as MobileLang, key);
  const dark = theme === "dark";
  const webFileInputRef = useRef<HTMLInputElement | null>(null);
  const [tab, setTab] = useState<SettingsTab>("profile");
  const [loading, setLoading] = useState(false);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [securityAction, setSecurityAction] = useState("");
  const [crashRows, setCrashRows] = useState<CrashRecord[]>([]);
  const [crashStatus, setCrashStatus] = useState(() => getCrashReportingStatus());
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [emailStatus, setEmailStatus] = useState<any>(null);
  const [permissions, setPermissions] = useState<any>(null);
  const [memberPermissions, setMemberPermissions] = useState<MemberPerm[]>([]);
  const [permForms, setPermForms] = useState<Record<string, { permission_key: string; allow: boolean }>>({});
  const [savingMemberId, setSavingMemberId] = useState("");
  const activeFamily = families.find((family) => family.id === familyId);
  const [currency, setCurrency] = useState(activeFamily?.default_currency || "BDT");
  const [timezone, setTimezone] = useState(activeFamily?.timezone || "Asia/Dhaka");
  const [apiBaseDraft, setApiBaseDraft] = useState(apiBaseUrl || "");

  useEffect(() => {
    setApiBaseDraft(apiBaseUrl || "");
  }, [apiBaseUrl]);

  useEffect(() => {
    if (tab === "security") {
      setCrashRows(listLocalCrashes());
      setCrashStatus(getCrashReportingStatus());
    }
  }, [tab]);

  const load = useCallback(async () => {
    if (!token || !familyId) return;
    setLoading(true);
    try {
      const [me, mail, perms] = await Promise.all([
        apiGet("/api/v1/auth/me", token),
        apiGet("/api/v1/auth/email-status", token),
        apiGet(`/api/v1/permissions/family/${familyId}/me`, token).catch(() => null),
      ]);
      setProfile(me);
      setEmailStatus(mail);
      setPermissions(perms);

      try {
        const members = await apiGet(`/api/v1/permissions/family/${familyId}/members`, token);
        setMemberPermissions(Array.isArray(members) ? members : members?.members || []);
      } catch {
        setMemberPermissions([]);
      }

      const family = families.find((row) => row.id === familyId);
      setCurrency(family?.default_currency || "BDT");
      setTimezone(family?.timezone || "Asia/Dhaka");
      onMessage(tm("settingsLoaded"), true);
    } catch (error) {
      onMessage(error instanceof Error ? error.message : tm("settingsLoadFailed"), false);
    } finally {
      setLoading(false);
    }
  }, [apiGet, families, familyId, onMessage, token]);

  useEffect(() => {
    load();
  }, [load]);

  async function saveFamilySettings() {
    if (!currency.trim() || currency.trim().length < 3) {
      onMessage(tm("validCurrencyRequired"), false);
      return;
    }
    setLoading(true);
    try {
      await apiPatch(
        `/api/v1/families/${familyId}/settings`,
        {
          default_currency: currency.trim().toUpperCase(),
          timezone: timezone.trim() || "Asia/Dhaka",
        },
        token
      );
      onMessage(tm("familySettingsSaved"), true);
      onFamilyUpdated?.();
      await load();
    } catch (error) {
      onMessage(error instanceof Error ? error.message : tm("saveFailed"), false);
      setLoading(false);
    }
  }

  async function saveMemberPermission(member: MemberPerm) {
    const form = permForms[member.member_id] || { permission_key: "", allow: true };
    if (!form.permission_key) {
      onMessage(tm("selectPermissionKey"), false);
      return;
    }
    setSavingMemberId(member.member_id);
    try {
      await apiPatch(
        `/api/v1/permissions/members/${member.member_id}`,
        {
          permission_key: form.permission_key,
          allow: form.allow,
          scope: "family",
        },
        token
      );
      onMessage(`${form.permission_key} ${form.allow ? "allowed" : "denied"}`, true);
      await load();
    } catch (error) {
      onMessage(error instanceof Error ? error.message : "Permission update failed", false);
    } finally {
      setSavingMemberId("");
    }
  }

  async function refreshSession() {
    if (!refreshToken) {
      onMessage(tm("refreshTokenUnavailable"), false);
      return;
    }
    setSecurityAction("refresh");
    try {
      const data = await apiPost("/api/v1/auth/refresh", { refresh_token: refreshToken }, "");
      onSessionRefreshed?.(data.access_token || "", data.refresh_token, data.user);
      onMessage(tm("sessionRefreshed"), true);
    } catch (error) {
      onMessage(error instanceof Error ? error.message : tm("sessionRefreshFailed"), false);
    } finally {
      setSecurityAction("");
    }
  }

  async function requestPasswordReset() {
    const targetEmail = profile?.email;
    if (!targetEmail) {
      onMessage(tm("emailRequiredPasswordReset"), false);
      return;
    }
    setSecurityAction("password-reset");
    try {
      const data = await apiPost("/api/v1/auth/forgot-password", { email: targetEmail }, "");
      const delivery = data.email_delivery;
      if (delivery?.sent) {
        onMessage(data.message || tm("passwordResetSent"), true);
      } else {
        onMessage(delivery?.detail || data.message || "Reset requested (email may not be configured)", !delivery || delivery?.sent !== false);
      }
    } catch (error) {
      onMessage(error instanceof Error ? error.message : "Password reset failed", false);
    } finally {
      setSecurityAction("");
    }
  }

  async function resendVerification() {
    const targetEmail = profile?.email;
    if (!targetEmail) {
      onMessage(tm("emailRequiredVerification"), false);
      return;
    }
    if (profile?.is_email_verified) {
      onMessage(tm("emailAlreadyVerified"), true);
      return;
    }
    setSecurityAction("verification");
    try {
      const data = await apiPost("/api/v1/auth/resend-verification", { email: targetEmail }, "");
      const delivery = data.email_delivery;
      if (delivery?.sent) {
        onMessage(data.message || tm("verificationEmailSent"), true);
      } else {
        onMessage(delivery?.detail || data.message || "Resend requested (SMTP may not be configured)", !delivery || delivery?.sent !== false);
      }
    } catch (error) {
      onMessage(error instanceof Error ? error.message : "Verification resend failed", false);
    } finally {
      setSecurityAction("");
    }
  }

  function resolveAvatarUrl(user?: UserProfile | null) {
    const path = user?.avatar_url;
    if (!path) return "";
    if (/^https?:\/\//i.test(path)) return path;
    const base = apiBaseUrl.replace(/\/$/, "");
    const normalized = path.startsWith("/api/v1") ? path : path.startsWith("/") ? `/api/v1${path}` : `/api/v1/${path}`;
    return `${base}${normalized}`;
  }

  async function uploadProfilePhoto(file: File | { uri: string; name: string; mimeType?: string }) {
    setPhotoBusy(true);
    try {
      const form = new FormData();
      if (Platform.OS === "web" && file instanceof File) {
        form.append("file", file);
      } else {
        const nativeFile = file as { uri: string; name: string; mimeType?: string };
        form.append("file", {
          uri: nativeFile.uri,
          name: nativeFile.name,
          type: nativeFile.mimeType || "image/jpeg",
        } as any);
      }
      const response = await fetch(`${apiBaseUrl.replace(/\/$/, "")}/api/v1/auth/me/avatar`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: form,
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(typeof data.detail === "string" ? data.detail : tm("photoUploadFailed") || "Photo upload failed");
      }
      setProfile(data);
      onSessionRefreshed?.(token, refreshToken || undefined, data);
      onMessage(tm("photoUpdated") || "Photo updated", true);
    } catch (error) {
      onMessage(error instanceof Error ? error.message : tm("photoUploadFailed") || "Photo upload failed", false);
    } finally {
      setPhotoBusy(false);
    }
  }

  async function removeProfilePhoto() {
    setPhotoBusy(true);
    try {
      const response = await fetch(`${apiBaseUrl.replace(/\/$/, "")}/api/v1/auth/me/avatar`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(typeof data.detail === "string" ? data.detail : tm("photoUploadFailed") || "Photo remove failed");
      }
      setProfile(data);
      onSessionRefreshed?.(token, refreshToken || undefined, data);
      onMessage(tm("photoRemoved") || "Photo removed", true);
    } catch (error) {
      onMessage(error instanceof Error ? error.message : tm("photoUploadFailed") || "Photo remove failed", false);
    } finally {
      setPhotoBusy(false);
    }
  }

  async function pickProfilePhoto() {
    if (Platform.OS === "web") {
      webFileInputRef.current?.click();
      return;
    }
    const result = await DocumentPicker.getDocumentAsync({
      type: ["image/jpeg", "image/png", "image/webp"],
      copyToCacheDirectory: true,
      multiple: false,
    });
    if (result.canceled || !result.assets?.length) return;
    const asset = result.assets[0];
    await uploadProfilePhoto({
      uri: asset.uri,
      name: asset.name || "avatar.jpg",
      mimeType: asset.mimeType || "image/jpeg",
    });
  }

  const avatarUrl = resolveAvatarUrl(profile);
  const initials = String(profile?.full_name || profile?.email || "U")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() || "")
    .join("") || "U";

  const effective: string[] = permissions?.effective_permissions || permissions?.permissions || [];
  const overrides = permissions?.overrides || [];
  const role = permissions?.normalized_role || permissions?.role || "—";
  const relationship = permissions?.relationship || "—";
  const isOwner = String(role).toUpperCase() === "OWNER";

  return (
    <View style={[styles.panel, dark ? styles.panelDark : null]}>
      <Text style={[styles.panelTitle, dark ? styles.textDark : null]}>{tm("settings")}</Text>
      <Text style={[styles.muted, dark ? styles.mutedDark : null]}>{tm("settingsTab_profile")} · {tm("settingsTab_family")} · {tm("settingsTab_permissions")} · {tm("settingsTab_security")}</Text>

      {Platform.OS === "web" ? (
        // Hidden file input for web avatar upload
        <input
          ref={webFileInputRef as any}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          style={{ display: "none" }}
          onChange={(e: any) => {
            const file = e?.target?.files?.[0];
            if (file) void uploadProfilePhoto(file);
            if (e?.target) e.target.value = "";
          }}
        />
      ) : null}

      <MobileDropdown
        label={tm("languageLock")}
        value={lang}
        dark={dark}
        options={LOCKED_LANGUAGES.map((item) => ({
          value: item.code,
          label: `${item.nativeName} - ${item.name}`,
        }))}
        onChange={(value) => onChangeLang?.(value as MobileLang)}
      />

      <MobileDropdown
        label={tm("theme")}
        value={theme}
        dark={dark}
        options={[
          { value: "light", label: tm("themeLight") },
          { value: "dark", label: tm("themeDark") },
        ]}
        onChange={(value) => onChangeTheme?.(value as MobileTheme)}
      />

      <View style={styles.statusRow}>
        {TABS.map((item) => (
          <Pressable key={item} onPress={() => setTab(item)}>
            <Text style={[styles.statusPill, dark ? styles.pillDark : null, tab === item ? styles.ok : null]}>{tm(`settingsTab_${item}`)}</Text>
          </Pressable>
        ))}
        <Pressable onPress={load} disabled={loading}>
          <Text style={[styles.statusPill, dark ? styles.pillDark : null]}>{loading ? "…" : tm("refresh")}</Text>
        </Pressable>
      </View>

      {tab === "profile" ? (
        <>
          <View style={styles.avatarRow}>
            <View style={[styles.avatar, dark ? styles.cardDark : null]}>
              {avatarUrl ? (
                <Image source={{ uri: avatarUrl }} style={styles.avatarImage} />
              ) : (
                <Text style={[styles.avatarInitials, dark ? styles.textDark : null]}>{initials}</Text>
              )}
            </View>
            <View style={{ flex: 1, gap: 8 }}>
              <Pressable style={styles.primaryButton} onPress={() => void pickProfilePhoto()} disabled={photoBusy}>
                <Text style={styles.primaryButtonText}>{photoBusy ? tm("saving") : tm("changePhoto")}</Text>
              </Pressable>
              {avatarUrl ? (
                <Pressable style={styles.secondaryButton} onPress={() => void removeProfilePhoto()} disabled={photoBusy}>
                  <Text style={styles.secondaryButtonText}>{tm("removePhoto")}</Text>
                </Pressable>
              ) : null}
              <Text style={[styles.muted, dark ? styles.mutedDark : null]}>{tm("photoHint")}</Text>
            </View>
          </View>
          <View style={styles.grid}>
            <View style={[styles.metricCard, dark ? styles.cardDark : null]}>
              <Text style={[styles.metricLabel, dark ? styles.mutedDark : null]}>{tm("user")}</Text>
              <Text style={[styles.metricValue, dark ? styles.textDark : null]}>{profile?.full_name || "—"}</Text>
            </View>
            <View style={[styles.metricCard, dark ? styles.cardDark : null]}>
              <Text style={[styles.metricLabel, dark ? styles.mutedDark : null]}>{tm("verified")}</Text>
              <Text style={[styles.metricValue, dark ? styles.textDark : null]}>{profile?.is_email_verified ? tm("yes") : tm("no")}</Text>
            </View>
            <View style={[styles.metricCard, dark ? styles.cardDark : null]}>
              <Text style={[styles.metricLabel, dark ? styles.mutedDark : null]}>{tm("role")}</Text>
              <Text style={[styles.metricValue, dark ? styles.textDark : null]}>{String(role)}</Text>
            </View>
            <View style={[styles.metricCard, dark ? styles.cardDark : null]}>
              <Text style={[styles.metricLabel, dark ? styles.mutedDark : null]}>{tm("perms")}</Text>
              <Text style={[styles.metricValue, dark ? styles.textDark : null]}>{String(effective.length)}</Text>
            </View>
          </View>
          <Text style={[styles.sectionLabel, dark ? styles.textDark : null]}>{tm("profile")}</Text>
          <Text style={[styles.muted, dark ? styles.mutedDark : null]}>{profile?.email || "—"}</Text>
          <Text style={[styles.muted, dark ? styles.mutedDark : null]}>
            {tm("status")}: {profile?.is_active === false ? tm("inactive") : tm("active")}
          </Text>
          <Text style={[styles.muted, dark ? styles.mutedDark : null]}>{tm("relationship")}: {String(relationship)}</Text>
          <Text style={[styles.muted, dark ? styles.mutedDark : null]}>{tm("overrides")}: {String(Array.isArray(overrides) ? overrides.length : 0)}</Text>
        </>
      ) : null}

      {tab === "family" ? (
        <>
          <Text style={styles.sectionLabel}>{tm("activeFamily")}</Text>
          <Text style={styles.muted}>{activeFamily?.name || familyId}</Text>
          <Text style={styles.muted}>
            {tm("current")}: {activeFamily?.default_currency || "—"} · {activeFamily?.timezone || "—"}
          </Text>

          <Text style={styles.sectionLabel}>{tm("currency")}</Text>
          <View style={styles.statusRow}>
            {CURRENCY_PRESETS.map((code) => (
              <Pressable key={code} onPress={() => setCurrency(code)}>
                <Text style={[styles.statusPill, currency === code ? styles.ok : null]}>{code}</Text>
              </Pressable>
            ))}
          </View>
          <TextInput
            style={styles.input}
            placeholder={tm("currencyPlaceholder")}
            placeholderTextColor="#8aa39a"
            autoCapitalize="characters"
            value={currency}
            onChangeText={(value) => setCurrency(value.toUpperCase())}
          />

          <Text style={styles.sectionLabel}>{tm("timezone")}</Text>
          <View style={styles.statusRow}>
            {TIMEZONE_PRESETS.map((zone) => (
              <Pressable key={zone} onPress={() => setTimezone(zone)}>
                <Text style={[styles.statusPill, timezone === zone ? styles.ok : null]}>{zone}</Text>
              </Pressable>
            ))}
          </View>
          <TextInput
            style={styles.input}
            placeholder={tm("timezonePlaceholder")}
            placeholderTextColor="#8aa39a"
            value={timezone}
            onChangeText={setTimezone}
          />
          <Text style={styles.muted}>{tm("settingsManageHint")}</Text>
          <Pressable style={styles.primaryButton} onPress={saveFamilySettings} disabled={loading}>
            <Text style={styles.primaryButtonText}>{loading ? tm("saving") : tm("saveFamilySettings")}</Text>
          </Pressable>

          <Text style={styles.sectionLabel}>{tm("apiBaseUrl") || "API base URL"}</Text>
          <Text style={styles.muted}>{tm("apiBaseHelp") || "Change API server address"}</Text>
          <TextInput
            style={styles.input}
            placeholder="http://127.0.0.1:8000"
            placeholderTextColor="#8aa39a"
            autoCapitalize="none"
            value={apiBaseDraft}
            onChangeText={setApiBaseDraft}
          />
          <Pressable
            style={styles.secondaryButton}
            onPress={async () => {
              const next = String(apiBaseDraft || "").trim().replace(/\/$/, "");
              if (!next) {
                onMessage(tm("apiBaseUrl") || "API URL required", false);
                return;
              }
              await onApiBaseChange?.(next);
              onMessage(tm("saveApiBase") || "API URL saved", true);
            }}
          >
            <Text style={styles.secondaryButtonText}>{tm("saveApiBase") || "Save API URL"}</Text>
          </Pressable>
        </>
      ) : null}

      {tab === "permissions" ? (
        <>
          <Text style={styles.sectionLabel}>{tm("myEffectivePerms").replace("{n}", String(effective.length))}</Text>
          <View style={styles.statusRow}>
            {effective.length === 0 ? <Text style={styles.muted}>{tm("noPermissionPayload")}</Text> : null}
            {effective.slice(0, 24).map((key) => (
              <Text key={key} style={styles.statusPill}>
                {key}
              </Text>
            ))}
            {effective.length > 24 ? <Text style={styles.muted}>+{effective.length - 24} more</Text> : null}
          </View>

          <Text style={styles.sectionLabel}>My overrides</Text>
          {Array.isArray(overrides) && overrides.length ? (
            overrides.map((item: any) => (
              <View style={styles.listRow} key={item.id || item.permission_key}>
                <Text style={styles.listTitle}>{item.permission_key}</Text>
                <Text style={styles.muted}>
                  {item.allow ? "ALLOW" : "DENY"} · {item.scope || "family"}
                </Text>
              </View>
            ))
          ) : (
            <Text style={styles.muted}>No personal overrides</Text>
          )}

          <Text style={styles.sectionLabel}>Family member permissions</Text>
          {!isOwner ? (
            <Text style={styles.muted}>{tm("ownerOnly")} ({String(role)})</Text>
          ) : null}
          {isOwner && memberPermissions.length === 0 ? <Text style={styles.muted}>No members loaded</Text> : null}
          {isOwner
            ? memberPermissions.map((member) => {
                const form = permForms[member.member_id] || { permission_key: "", allow: true };
                const memberRole = member.normalized_role || member.role || "—";
                const locked = String(memberRole).toUpperCase() === "OWNER";
                return (
                  <View style={styles.listRow} key={member.member_id}>
                    <Text style={styles.listTitle}>{member.relationship || member.user_id || member.member_id}</Text>
                    <Text style={styles.muted}>
                      {memberRole} · {String(member.effective_permissions?.length || 0)} effective
                    </Text>
                    {(member.overrides || []).length > 0 ? (
                      <Text style={styles.muted}>
                        Overrides:{" "}
                        {(member.overrides || [])
                          .slice(0, 6)
                          .map((row) => `${row.permission_key}:${row.allow ? "allow" : "deny"}`)
                          .join(", ")}
                      </Text>
                    ) : null}
                    {locked ? (
                      <Text style={styles.muted}>Owner permissions locked</Text>
                    ) : (
                      <>
                        <View style={styles.statusRow}>
                          {COMMON_PERMISSION_KEYS.map((key) => (
                            <Pressable
                              key={key}
                              onPress={() =>
                                setPermForms((current) => ({
                                  ...current,
                                  [member.member_id]: { ...form, permission_key: key },
                                }))
                              }
                            >
                              <Text style={[styles.statusPill, form.permission_key === key ? styles.ok : null]}>{key}</Text>
                            </Pressable>
                          ))}
                        </View>
                        <View style={styles.statusRow}>
                          <Pressable
                            onPress={() =>
                              setPermForms((current) => ({
                                ...current,
                                [member.member_id]: { ...form, allow: true },
                              }))
                            }
                          >
                            <Text style={[styles.statusPill, form.allow ? styles.ok : null]}>ALLOW</Text>
                          </Pressable>
                          <Pressable
                            onPress={() =>
                              setPermForms((current) => ({
                                ...current,
                                [member.member_id]: { ...form, allow: false },
                              }))
                            }
                          >
                            <Text style={[styles.statusPill, !form.allow ? styles.deny : null]}>DENY</Text>
                          </Pressable>
                          <Pressable onPress={() => saveMemberPermission(member)} disabled={savingMemberId === member.member_id}>
                            <Text style={[styles.statusPill, styles.ok]}>
                              {savingMemberId === member.member_id ? "Saving…" : "Apply"}
                            </Text>
                          </Pressable>
                        </View>
                      </>
                    )}
                  </View>
                );
              })
            : null}
        </>
      ) : null}

      {tab === "security" ? (
        <>
          <Text style={styles.sectionLabel}>Email / SMTP</Text>
          <Text style={[styles.statusPill, emailStatus?.can_send ? styles.ok : null]}>
            {emailStatus?.can_send ? "SMTP ready" : "SMTP not configured"}
          </Text>
          <Text style={styles.muted}>{emailStatus?.note || tm("loadEmailStatus")}</Text>
          {emailStatus?.smtp?.host ? (
            <Text style={styles.muted}>
              {emailStatus.smtp.host}:{emailStatus.smtp.port} · {emailStatus.smtp.from_email || "—"}
            </Text>
          ) : null}

          <Text style={styles.sectionLabel}>Session</Text>
          <Text style={styles.muted}>{refreshToken ? tm("refreshTokenReady") : tm("loginAgainRefresh")}</Text>
          <Pressable
            style={styles.secondaryButton}
            onPress={refreshSession}
            disabled={securityAction === "refresh" || !refreshToken}
          >
            <Text style={styles.secondaryButtonText}>
              {securityAction === "refresh" ? tm("refreshing") : tm("refreshSession")}
            </Text>
          </Pressable>

          <Text style={styles.sectionLabel}>Password reset</Text>
          <Text style={styles.muted}>Sends reset email via SMTP when configured</Text>
          <Pressable
            style={styles.secondaryButton}
            onPress={requestPasswordReset}
            disabled={securityAction === "password-reset"}
          >
            <Text style={styles.secondaryButtonText}>
              {securityAction === "password-reset" ? tm("requesting") : tm("requestPasswordReset")}
            </Text>
          </Pressable>

          <Text style={styles.sectionLabel}>Email verification</Text>
          <Text style={styles.muted}>
            {profile?.is_email_verified ? tm("verified") : tm("notVerified")} · {profile?.email || "—"}
          </Text>
          <Pressable
            style={styles.secondaryButton}
            onPress={resendVerification}
            disabled={securityAction === "verification" || !!profile?.is_email_verified}
          >
            <Text style={styles.secondaryButtonText}>
              {securityAction === "verification" ? tm("sending") : tm("resendVerification")}
            </Text>
          </Pressable>

          <Text style={styles.sectionLabel}>Crash reporting</Text>
          <Text style={styles.muted}>
            Local vault: ON · Cloud Sentry: {crashStatus.sentryCloud || crashStatus.dsnConfigured ? "configured" : "optional (DSN empty)"} · Saved{" "}
            {crashStatus.crashCount}
          </Text>
          {crashRows.slice(0, 5).map((row) => (
            <View key={row.id} style={{ gap: 2 }}>
              <Text style={styles.muted}>{row.at}</Text>
              <Text style={{ color: dark ? "#fecaca" : "#b42318", fontWeight: "700" }}>{row.message}</Text>
            </View>
          ))}
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
            <Pressable
              style={styles.secondaryButton}
              onPress={() => {
                setCrashRows(listLocalCrashes());
                setCrashStatus(getCrashReportingStatus());
                onMessage("Crash vault refreshed", true);
              }}
            >
              <Text style={styles.secondaryButtonText}>Refresh crashes</Text>
            </Pressable>
            <Pressable
              style={styles.secondaryButton}
              onPress={() => {
                clearLocalCrashes();
                setCrashRows([]);
                setCrashStatus(getCrashReportingStatus());
                onMessage("Crash vault cleared", true);
              }}
            >
              <Text style={styles.secondaryButtonText}>Clear crashes</Text>
            </Pressable>
          </View>
        </>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  panel: { backgroundColor: "#ffffff", borderColor: "#dce7e3", borderWidth: 1, borderRadius: 24, padding: 16, gap: 12 },
  panelDark: { backgroundColor: "#14201d", borderColor: "#2b3c37" },
  panelTitle: { color: "#17211e", fontSize: 20, fontWeight: "900" },
  textDark: { color: "#eef8f5" },
  muted: { color: "#6c7b76", fontSize: 13, lineHeight: 19 },
  mutedDark: { color: "#9dafaa" },
  input: {
    backgroundColor: "#f8fbfa",
    borderColor: "#dce7e3",
    borderWidth: 1,
    borderRadius: 16,
    color: "#17211e",
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
  },
  primaryButton: { backgroundColor: "#0f8f6f", borderRadius: 16, paddingVertical: 14, alignItems: "center" },
  primaryButtonText: { color: "#ffffff", fontWeight: "900", fontSize: 15 },
  secondaryButton: { borderColor: "#0f8f6f", borderWidth: 1, borderRadius: 16, paddingVertical: 12, alignItems: "center", backgroundColor: "#ffffff" },
  secondaryButtonText: { color: "#0b6f58", fontWeight: "800" },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  metricCard: { flexGrow: 1, minWidth: "45%", backgroundColor: "#f8fbfa", borderRadius: 18, padding: 12, borderWidth: 1, borderColor: "#dce7e3" },
  cardDark: { backgroundColor: "#182724", borderColor: "#2b3c37" },
  metricLabel: { color: "#6c7b76", fontSize: 12, fontWeight: "700" },
  metricValue: { color: "#17211e", fontSize: 16, fontWeight: "900", marginTop: 6 },
  sectionLabel: { color: "#17211e", fontWeight: "900", marginTop: 6 },
  statusRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  statusPill: {
    color: "#0b6f58",
    backgroundColor: "#e0f4ed",
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
    fontSize: 12,
    fontWeight: "800",
    overflow: "hidden",
  },
  pillDark: { color: "#6ddab8", backgroundColor: "#173c31" },
  ok: { backgroundColor: "#0f8f6f", color: "#ffffff" },
  deny: { backgroundColor: "#fee9e9", color: "#dc2626" },
  listRow: { borderTopColor: "#dce7e3", borderTopWidth: 1, paddingTop: 10, gap: 6 },
  listTitle: { color: "#17211e", fontWeight: "900", fontSize: 15 },
  avatarRow: { flexDirection: "row", gap: 12, alignItems: "center" },
  avatar: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: "#e0f4ed",
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
    borderWidth: 1,
    borderColor: "#dce7e3",
  },
  avatarImage: { width: 72, height: 72 },
  avatarInitials: { color: "#0b6f58", fontWeight: "900", fontSize: 22 },
});
