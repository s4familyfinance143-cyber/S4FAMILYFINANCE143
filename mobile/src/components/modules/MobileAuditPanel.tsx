import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { tMobile, type MobileLang } from "../../i18n";

type AuditRow = {
  id?: string;
  action_type?: string;
  entity_type?: string;
  entity_id?: string;
  title?: string;
  description?: string;
  created_at?: string;
  member_name?: string;
  severity?: string;
};

type SummaryBucket = { action_type?: string; entity_type?: string; severity?: string; count?: number; total?: number; name?: string };

type Props = {
  token: string;
  familyId: string;
  apiGet: (path: string, authToken?: string) => Promise<any>;
  onMessage: (message: string, ok?: boolean) => void;
  lang?: MobileLang;
};

const LIMIT_OPTIONS = [25, 50, 100];

export function MobileAuditPanel({ token, familyId, apiGet, onMessage, lang = "bn" }: Props) {
  const tm = (key: string) => tMobile(lang, key);
  const [loading, setLoading] = useState(false);
  const [summary, setSummary] = useState<any>(null);
  const [rows, setRows] = useState<AuditRow[]>([]);
  const [filterAction, setFilterAction] = useState("");
  const [filterEntity, setFilterEntity] = useState("");
  const [filterSeverity, setFilterSeverity] = useState("");
  const [limit, setLimit] = useState(25);
  const [entityFocus, setEntityFocus] = useState<{ type: string; id: string } | null>(null);

  const activityPath = useMemo(() => {
    if (entityFocus) {
      return `/families/${familyId}/audit-trail/entity/${encodeURIComponent(entityFocus.type)}/${encodeURIComponent(entityFocus.id)}?limit=${limit}`;
    }
    const params = new URLSearchParams({ limit: String(limit) });
    if (filterAction) params.set("action_type", filterAction);
    if (filterEntity) params.set("entity_type", filterEntity);
    if (filterSeverity) params.set("severity", filterSeverity);
    return `/families/${familyId}/audit-trail/activity?${params.toString()}`;
  }, [entityFocus, familyId, filterAction, filterEntity, filterSeverity, limit]);

  const load = useCallback(async () => {
    if (!token || !familyId) return;
    setLoading(true);
    try {
      const [sum, activity] = await Promise.all([
        apiGet(`/families/${familyId}/audit-trail/summary`, token),
        apiGet(activityPath, token),
      ]);
      setSummary(sum);
      const list = Array.isArray(activity) ? activity : activity?.rows || activity?.items || activity?.activity || [];
      setRows(list);
      onMessage(tm("auditLoaded").replace("{n}", String(list.length)), true);
    } catch (error) {
      onMessage(error instanceof Error ? error.message : "Audit load failed", false);
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [apiGet, activityPath, familyId, onMessage, token]);

  useEffect(() => {
    load();
  }, [load]);

  const byAction: SummaryBucket[] = summary?.by_action_type || [];
  const byEntity: SummaryBucket[] = summary?.by_entity_type || [];
  const bySeverity: SummaryBucket[] = summary?.by_severity || [];

  function clearFilters() {
    setFilterAction("");
    setFilterEntity("");
    setFilterSeverity("");
    setEntityFocus(null);
  }

  function toggleFilter(kind: "action" | "entity" | "severity", value: string) {
    setEntityFocus(null);
    if (kind === "action") setFilterAction((current) => (current === value ? "" : value));
    if (kind === "entity") setFilterEntity((current) => (current === value ? "" : value));
    if (kind === "severity") setFilterSeverity((current) => (current === value ? "" : value));
  }

  function focusEntity(row: AuditRow) {
    if (!row.entity_type || !row.entity_id) return;
    setEntityFocus({ type: row.entity_type, id: row.entity_id });
    setFilterAction("");
    setFilterEntity("");
    setFilterSeverity("");
  }

  const activeFilterCount = [filterAction, filterEntity, filterSeverity].filter(Boolean).length + (entityFocus ? 1 : 0);

  return (
    <View style={styles.panel}>
      <Text style={styles.panelTitle}>{tm("auditCenter")}</Text>
      <Text style={styles.muted}>{tm("auditHint")}</Text>

      <View style={styles.grid}>
        <View style={styles.metricCard}>
          <Text style={styles.metricLabel}>{tm("totalRows")}</Text>
          <Text style={styles.metricValue}>{String(summary?.total_audit_rows || rows.length || 0)}</Text>
        </View>
        <View style={styles.metricCard}>
          <Text style={styles.metricLabel}>{tm("mode")}</Text>
          <Text style={styles.metricValue}>{summary?.read_only ? "Read-only" : summary?.immutable ? "Immutable" : "Protected"}</Text>
        </View>
        <View style={styles.metricCard}>
          <Text style={styles.metricLabel}>{tm("filters")}</Text>
          <Text style={styles.metricValue}>{String(activeFilterCount)}</Text>
        </View>
      </View>

      <View style={styles.statusRow}>
        <Pressable style={styles.secondaryButton} onPress={load} disabled={loading}>
          <Text style={styles.secondaryButtonText}>{loading ? "Refreshing..." : "Refresh"}</Text>
        </Pressable>
        {activeFilterCount > 0 ? (
          <Pressable style={styles.secondaryButton} onPress={clearFilters} disabled={loading}>
            <Text style={styles.secondaryButtonText}>{tm("clearFilters")}</Text>
          </Pressable>
        ) : null}
      </View>

      <Text style={styles.sectionLabel}>{tm("limit")}</Text>
      <View style={styles.statusRow}>
        {LIMIT_OPTIONS.map((value) => (
          <Pressable key={value} onPress={() => setLimit(value)}>
            <Text style={[styles.statusPill, limit === value ? styles.ok : null]}>{value}</Text>
          </Pressable>
        ))}
      </View>

      {entityFocus ? (
        <Text style={styles.muted}>
          Entity focus: {entityFocus.type} · {entityFocus.id}
        </Text>
      ) : null}

      <Text style={styles.sectionLabel}>{tm("byAction")}</Text>
      {byAction.length === 0 ? <Text style={styles.muted}>{tm("noActionBreakdown")}</Text> : null}
      <View style={styles.statusRow}>
        {byAction.slice(0, 10).map((item) => {
          const label = item.action_type || item.name || "ACTION";
          return (
            <Pressable key={label} onPress={() => toggleFilter("action", label)}>
              <Text style={[styles.statusPill, filterAction === label ? styles.ok : null]}>
                {label} ({String(item.count ?? item.total ?? 0)})
              </Text>
            </Pressable>
          );
        })}
      </View>

      <Text style={styles.sectionLabel}>{tm("byEntity")}</Text>
      {byEntity.length === 0 ? <Text style={styles.muted}>{tm("noEntityBreakdown")}</Text> : null}
      <View style={styles.statusRow}>
        {byEntity.slice(0, 8).map((item) => {
          const label = item.entity_type || item.name || "ENTITY";
          return (
            <Pressable key={label} onPress={() => toggleFilter("entity", label)}>
              <Text style={[styles.statusPill, filterEntity === label ? styles.ok : null]}>
                {label} ({String(item.count ?? item.total ?? 0)})
              </Text>
            </Pressable>
          );
        })}
      </View>

      {bySeverity.length > 0 ? (
        <>
          <Text style={styles.sectionLabel}>{tm("bySeverity")}</Text>
          <View style={styles.statusRow}>
            {bySeverity.slice(0, 6).map((item) => {
              const label = item.severity || item.name || "SEVERITY";
              return (
                <Pressable key={label} onPress={() => toggleFilter("severity", label)}>
                  <Text style={[styles.statusPill, filterSeverity === label ? styles.ok : null]}>
                    {label} ({String(item.count ?? item.total ?? 0)})
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </>
      ) : null}

      <Text style={styles.sectionLabel}>{tm("recentActivity")}</Text>
      {rows.length === 0 ? <Text style={styles.muted}>{tm("noAuditActivity")}</Text> : null}
      {rows.slice(0, limit).map((row, index) => (
        <Pressable style={styles.listRow} key={row.id || `${row.entity_id}-${index}`} onPress={() => focusEntity(row)}>
          <Text style={styles.listTitle}>{row.title || row.action_type || "Audit event"}</Text>
          <Text style={styles.muted}>
            {row.action_type || "ACTION"} · {row.entity_type || "ENTITY"}
            {row.member_name ? ` · ${row.member_name}` : ""}
            {row.severity ? ` · ${row.severity}` : ""}
          </Text>
          <Text style={styles.muted}>{row.description || row.created_at || ""}</Text>
          {row.entity_id ? <Text style={styles.linkHint}>{tm("tapEntityTrail")}</Text> : null}
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  panel: { backgroundColor: "#ffffff", borderColor: "#dce7e3", borderWidth: 1, borderRadius: 24, padding: 16, gap: 12 },
  panelTitle: { color: "#17211e", fontSize: 20, fontWeight: "900" },
  muted: { color: "#6c7b76", fontSize: 13, lineHeight: 19 },
  linkHint: { color: "#20c997", fontSize: 12, fontWeight: "700" },
  secondaryButton: { borderColor: "#20c997", borderWidth: 1, borderRadius: 16, paddingVertical: 10, paddingHorizontal: 14, alignItems: "center" },
  secondaryButtonText: { color: "#0f8f6f", fontWeight: "800", fontSize: 13 },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  metricCard: { flexGrow: 1, minWidth: "30%", backgroundColor: "#f8fbfa", borderRadius: 18, padding: 12 },
  metricLabel: { color: "#6c7b76", fontSize: 12, fontWeight: "700" },
  metricValue: { color: "#17211e", fontSize: 16, fontWeight: "900", marginTop: 6 },
  sectionLabel: { color: "#0b6f58", fontWeight: "900", marginTop: 6 },
  statusRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  statusPill: { color: "#0b6f58", backgroundColor: "#e0f4ed", borderRadius: 999, paddingHorizontal: 10, paddingVertical: 6, fontSize: 12, fontWeight: "800" },
  ok: { backgroundColor: "#0f8f6f", color: "#ffffff" },
  listRow: { borderTopColor: "#dce7e3", borderTopWidth: 1, paddingTop: 10, gap: 2 },
  listTitle: { color: "#17211e", fontWeight: "900", fontSize: 15 },
});
