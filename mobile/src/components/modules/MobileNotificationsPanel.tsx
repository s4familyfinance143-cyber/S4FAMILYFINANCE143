import React, { useCallback, useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { tMobile, type MobileLang } from "../../i18n";

type NotificationRow = {
  id: string;
  notification_type?: string;
  title?: string;
  message?: string;
  severity?: string;
  is_read?: boolean;
  created_at?: string;
};

type Props = {
  token: string;
  familyId: string;
  apiGet: (path: string, authToken?: string) => Promise<any>;
  apiPost: (path: string, body: object, authToken?: string) => Promise<any>;
  apiPatch: (path: string, body: object, authToken?: string) => Promise<any>;
  apiDelete: (path: string, authToken?: string) => Promise<any>;
  onMessage: (message: string, ok?: boolean) => void;
  lang?: MobileLang;
};

export function MobileNotificationsPanel({
  token,
  familyId,
  apiGet,
  apiPost,
  apiPatch,
  apiDelete,
  onMessage,
  lang = "bn",
}: Props) {
  const tm = (key: string) => tMobile(lang, key);
  const [loading, setLoading] = useState(false);
  const [summary, setSummary] = useState<any>(null);
  const [delivery, setDelivery] = useState<any>(null);
  const [rows, setRows] = useState<NotificationRow[]>([]);
  const [filter, setFilter] = useState<"ALL" | "UNREAD" | "HIGH">("ALL");

  const load = useCallback(async () => {
    if (!token || !familyId) return;
    setLoading(true);
    try {
      const [list, sum, status] = await Promise.all([
        apiGet(`/api/v1/notifications/${familyId}`, token),
        apiGet(`/api/v1/notifications/summary/${familyId}`, token),
        apiGet(`/api/v1/notifications/delivery-status/${familyId}`, token),
      ]);
      setRows(Array.isArray(list) ? list : []);
      setSummary(sum);
      setDelivery(status);
      onMessage(tm("notificationsLoaded").replace("{n}", String(Array.isArray(list) ? list.length : 0)), true);
    } catch (error) {
      onMessage(error instanceof Error ? error.message : "Notifications load failed", false);
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [apiGet, familyId, onMessage, token]);

  useEffect(() => {
    load();
  }, [load]);

  async function scanAlerts() {
    setLoading(true);
    try {
      const result = await apiPost(`/api/v1/notifications/scan/${familyId}`, {}, token);
      onMessage(`Scan created ${result?.created_notifications ?? 0} · unread ${result?.unread_notifications ?? 0}`, true);
      await load();
    } catch (error) {
      onMessage(error instanceof Error ? error.message : "Scan failed", false);
      setLoading(false);
    }
  }

  async function markRead(id: string) {
    setLoading(true);
    try {
      await apiPatch(`/api/v1/notifications/read/${id}`, {}, token);
      onMessage(tm("markedAsRead"), true);
      await load();
    } catch (error) {
      onMessage(error instanceof Error ? error.message : "Mark read failed", false);
      setLoading(false);
    }
  }

  async function markAllRead() {
    setLoading(true);
    try {
      const result = await apiPatch(`/api/v1/notifications/read-all/${familyId}`, {}, token);
      onMessage(`Marked read: ${result?.marked_read ?? 0}`, true);
      await load();
    } catch (error) {
      onMessage(error instanceof Error ? error.message : "Mark all failed", false);
      setLoading(false);
    }
  }

  async function removeNotification(id: string) {
    setLoading(true);
    try {
      await apiDelete(`/api/v1/notifications/${id}`, token);
      onMessage(tm("notificationDeleted"), true);
      await load();
    } catch (error) {
      onMessage(error instanceof Error ? error.message : "Delete failed", false);
      setLoading(false);
    }
  }

  async function sendTestEmail() {
    setLoading(true);
    try {
      const result = await apiPost(`/api/v1/notifications/test-email/${familyId}`, {}, token);
      if (result?.sent) {
        onMessage("Test email sent", true);
      } else {
        onMessage(result?.reason || "Test email not sent (SMTP config)", false);
      }
    } catch (error) {
      onMessage(error instanceof Error ? error.message : "Test email failed", false);
    } finally {
      setLoading(false);
    }
  }

  const filtered = rows.filter((row) => {
    if (filter === "UNREAD") return !row.is_read;
    if (filter === "HIGH") return row.severity === "HIGH";
    return true;
  });

  const smtpNote = delivery?.smtp?.note;

  return (
    <View style={styles.panel}>
      <Text style={styles.panelTitle}>{tm("notifications")}</Text>
      <Text style={styles.muted}>{tm("notificationsHint")}</Text>

      <View style={styles.grid}>
        <View style={styles.metricCard}>
          <Text style={styles.metricLabel}>{tm("total")}</Text>
          <Text style={styles.metricValue}>{String(summary?.total_notifications ?? rows.length)}</Text>
        </View>
        <View style={styles.metricCard}>
          <Text style={styles.metricLabel}>{tm("unread")}</Text>
          <Text style={styles.metricValue}>{String(summary?.unread_notifications ?? rows.filter((r) => !r.is_read).length)}</Text>
        </View>
        <View style={styles.metricCard}>
          <Text style={styles.metricLabel}>{tm("delivery")}</Text>
          <Text style={styles.metricValue}>{delivery?.delivery_mode || "—"}</Text>
        </View>
      </View>

      <Text style={styles.sectionLabel}>{tm("channels")}</Text>
      <View style={styles.statusRow}>
        <Text style={[styles.statusPill, delivery?.in_app_enabled ? styles.ok : null]}>
          In-app {delivery?.in_app_enabled ? "ON" : "OFF"}
        </Text>
        <Text style={[styles.statusPill, delivery?.email_configured ? styles.ok : null]}>
          Email {delivery?.email_configured ? "ready" : "pending"}
        </Text>
        {/* Live updates come over the VPS WebSocket (no push service). */}
        <Text style={[styles.statusPill, styles.ok]}>Live (VPS)</Text>
      </View>
      {smtpNote ? <Text style={styles.muted}>{String(smtpNote)}</Text> : null}

      <View style={styles.statusRow}>
        {(["ALL", "UNREAD", "HIGH"] as const).map((id) => (
          <Pressable key={id} onPress={() => setFilter(id)}>
            <Text style={[styles.statusPill, filter === id ? styles.ok : null]}>{id}</Text>
          </Pressable>
        ))}
      </View>

      <Pressable style={styles.primaryButton} onPress={scanAlerts} disabled={loading}>
        <Text style={styles.primaryButtonText}>{loading ? tm("saving") : tm("scanAlerts")}</Text>
      </Pressable>
      <Pressable style={styles.secondaryButton} onPress={markAllRead} disabled={loading}>
        <Text style={styles.secondaryButtonText}>{tm("markAllReadBtn")}</Text>
      </Pressable>
      <Pressable style={styles.secondaryButton} onPress={sendTestEmail} disabled={loading}>
        <Text style={styles.secondaryButtonText}>{tm("sendTestEmail")}</Text>
      </Pressable>
      <Pressable style={styles.secondaryButton} onPress={load} disabled={loading}>
        <Text style={styles.secondaryButtonText}>{loading ? "Refreshing..." : "Refresh"}</Text>
      </Pressable>

      <Text style={styles.sectionLabel}>Inbox ({filtered.length})</Text>
      {filtered.length === 0 ? <Text style={styles.muted}>{tm("noNotifications")}</Text> : null}
      {filtered.slice(0, 30).map((row) => (
        <View style={styles.listRow} key={row.id}>
          <Text style={styles.listTitle}>{row.title || row.notification_type || "Alert"}</Text>
          <Text style={styles.muted}>
            {row.severity || "INFO"} · {row.notification_type || "TYPE"} · {row.is_read ? "read" : "unread"}
          </Text>
          <Text style={styles.muted}>{row.message || ""}</Text>
          <View style={styles.statusRow}>
            {!row.is_read ? (
              <Pressable onPress={() => markRead(row.id)} disabled={loading}>
                <Text style={styles.statusPill}>{tm("markRead")}</Text>
              </Pressable>
            ) : null}
            <Pressable onPress={() => removeNotification(row.id)} disabled={loading}>
              <Text style={styles.statusPill}>{tm("delete")}</Text>
            </Pressable>
          </View>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  panel: { backgroundColor: "#ffffff", borderColor: "#dce7e3", borderWidth: 1, borderRadius: 24, padding: 16, gap: 12 },
  panelTitle: { color: "#17211e", fontSize: 20, fontWeight: "900" },
  muted: { color: "#6c7b76", fontSize: 13, lineHeight: 19 },
  primaryButton: { backgroundColor: "#0f8f6f", borderRadius: 16, paddingVertical: 14, alignItems: "center" },
  primaryButtonText: { color: "#ffffff", fontWeight: "900", fontSize: 15 },
  secondaryButton: { borderColor: "#20c997", borderWidth: 1, borderRadius: 16, paddingVertical: 12, alignItems: "center" },
  secondaryButtonText: { color: "#0f8f6f", fontWeight: "800" },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  metricCard: { flexGrow: 1, minWidth: "45%", backgroundColor: "#f8fbfa", borderRadius: 18, padding: 12 },
  metricLabel: { color: "#6c7b76", fontSize: 12, fontWeight: "700" },
  metricValue: { color: "#17211e", fontSize: 16, fontWeight: "900", marginTop: 6 },
  sectionLabel: { color: "#0b6f58", fontWeight: "900", marginTop: 6 },
  statusRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  statusPill: {
    color: "#0b6f58",
    backgroundColor: "#e0f4ed",
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
    fontSize: 12,
    fontWeight: "800",
  },
  ok: { backgroundColor: "#0f8f6f", color: "#ffffff" },
  listRow: { borderTopColor: "#dce7e3", borderTopWidth: 1, paddingTop: 10, gap: 4 },
  listTitle: { color: "#17211e", fontWeight: "900", fontSize: 15 },
});
