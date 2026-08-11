import { useCallback, useEffect, useMemo, useState } from "react";

function shortTime(value, digits) {
  if (!value) return "—";
  const text = String(value);
  const cleaned = text.replace("T", " ").replace(/\.\d+.*/, "");
  return digits(cleaned);
}

const LIMIT_OPTIONS = [25, 50, 100];

export function AuditPanel({
  t,
  digits,
  auditSummary,
  auditRows,
  auditLoading,
  activeFamily,
  activeFamilyId,
  onRefresh,
  apiGet,
}) {
  const [filterAction, setFilterAction] = useState("");
  const [filterEntity, setFilterEntity] = useState("");
  const [filterSeverity, setFilterSeverity] = useState("");
  const [limit, setLimit] = useState(25);
  const [entityFocus, setEntityFocus] = useState(null);
  const [rows, setRows] = useState(auditRows || []);
  const [summary, setSummary] = useState(auditSummary);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setRows(auditRows || []);
  }, [auditRows]);

  useEffect(() => {
    setSummary(auditSummary);
  }, [auditSummary]);

  const activityPath = useMemo(() => {
    if (!activeFamilyId) return "";
    if (entityFocus) {
      return `/families/${activeFamilyId}/audit-trail/entity/${encodeURIComponent(entityFocus.type)}/${encodeURIComponent(entityFocus.id)}?limit=${limit}`;
    }
    const params = new URLSearchParams({ limit: String(limit) });
    if (filterAction) params.set("action_type", filterAction);
    if (filterEntity) params.set("entity_type", filterEntity);
    if (filterSeverity) params.set("severity", filterSeverity);
    return `/families/${activeFamilyId}/audit-trail/activity?${params.toString()}`;
  }, [activeFamilyId, entityFocus, filterAction, filterEntity, filterSeverity, limit]);

  const loadFiltered = useCallback(async () => {
    if (!apiGet || !activeFamilyId || !activityPath) {
      onRefresh?.();
      return;
    }
    setLoading(true);
    try {
      const [sum, activity] = await Promise.all([
        apiGet(`/families/${activeFamilyId}/audit-trail/summary`),
        apiGet(activityPath),
      ]);
      setSummary(sum);
      const list = Array.isArray(activity) ? activity : activity?.rows || activity?.items || activity?.activity || [];
      setRows(list);
    } catch {
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [activeFamilyId, activityPath, apiGet, onRefresh]);

  useEffect(() => {
    if (filterAction || filterEntity || filterSeverity || entityFocus || limit !== 25) {
      loadFiltered();
    }
  }, [filterAction, filterEntity, filterSeverity, entityFocus, limit, loadFiltered]);

  const total = Number(summary?.total_audit_rows || 0);
  const byAction = summary?.by_action_type || [];
  const byEntity = summary?.by_entity_type || [];
  const bySeverity = summary?.by_severity || [];
  const topActions = byAction.slice(0, 8);
  const topEntities = byEntity.slice(0, 8);
  const topSeverity = bySeverity.slice(0, 6);
  const busy = loading || auditLoading;
  const activeFilterCount =
    [filterAction, filterEntity, filterSeverity].filter(Boolean).length + (entityFocus ? 1 : 0);

  function clearFilters() {
    setFilterAction("");
    setFilterEntity("");
    setFilterSeverity("");
    setEntityFocus(null);
    setLimit(25);
    onRefresh?.();
  }

  function toggleFilter(kind, value) {
    setEntityFocus(null);
    if (kind === "action") setFilterAction((current) => (current === value ? "" : value));
    if (kind === "entity") setFilterEntity((current) => (current === value ? "" : value));
    if (kind === "severity") setFilterSeverity((current) => (current === value ? "" : value));
  }

  function focusEntity(row) {
    if (!row?.entity_type || !row?.entity_id) return;
    setEntityFocus({ type: row.entity_type, id: row.entity_id });
    setFilterAction("");
    setFilterEntity("");
    setFilterSeverity("");
  }

  return (
    <section className="panel settings-panel settings-smart audit-smart">
      <div className="settings-head">
        <div>
          <p className="settings-kicker">{t("immutableTrail")}</p>
          <h2>{t("auditCenter")}</h2>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {activeFilterCount > 0 ? (
            <button type="button" className="btn" onClick={clearFilters}>
              {t("clearFilters") || "Clear filters"}
            </button>
          ) : null}
          <button type="button" className="btn" disabled={busy} onClick={() => (activeFilterCount ? loadFiltered() : onRefresh?.())}>
            {busy ? t("loading") : t("refreshAudit")}
          </button>
        </div>
      </div>

      <div className="settings-identity audit-identity">
        <div className="sync-health ok">
          <strong>{digits(total)}</strong>
          <span>{t("totalAuditRows")}</span>
        </div>
        <div className="settings-identity-copy">
          <h3>{activeFamily?.name || activeFamilyId || t("family")}</h3>
          <p>{summary?.immutable ? t("immutableTrail") : t("auditSummary")}</p>
          <div className="settings-badges">
            <span className="settings-badge ok">
              {summary?.read_only ? t("readOnly") : t("protected")}
            </span>
            <span className="settings-badge role">
              {t("latestActivity")}: {digits(rows.length)}
            </span>
            <span className="settings-badge">
              {t("filters") || "Filters"}: {digits(activeFilterCount)}
            </span>
          </div>
        </div>
      </div>

      <div className="settings-stat-row">
        <div className="settings-stat">
          <span>{t("totalAuditRows")}</span>
          <strong>{digits(total)}</strong>
          <small>{t("immutableTrail")}</small>
        </div>
        <div className="settings-stat">
          <span>{t("readMode")}</span>
          <strong>{summary?.read_only ? t("readOnly") : t("protected")}</strong>
          <small>
            {t("family")}: {activeFamily?.name || "—"}
          </small>
        </div>
        <div className="settings-stat">
          <span>{t("summaryByAction")}</span>
          <strong>{digits(byAction.length)}</strong>
          <small>{t("latestActivity")}</small>
        </div>
        <div className="settings-stat">
          <span>{t("summaryByEntity")}</span>
          <strong>{digits(byEntity.length)}</strong>
          <small>
            {digits(rows.length)} {t("latestActivity")}
          </small>
        </div>
      </div>

      <div className="settings-stack">
        <div className="settings-block">
          <div className="settings-block-head">
            <div>
              <h4>{t("filters") || "Filters"}</h4>
              <p>{t("tapToFilter") || "Tap a chip to filter · tap a row for entity trail"}</p>
            </div>
            <div className="settings-badges">
              {LIMIT_OPTIONS.map((n) => (
                <button
                  key={n}
                  type="button"
                  className={`settings-badge ${limit === n ? "ok" : ""}`}
                  onClick={() => setLimit(n)}
                >
                  {digits(n)}
                </button>
              ))}
            </div>
          </div>
          {entityFocus ? (
            <p className="settings-empty">
              Entity: {entityFocus.type} / {entityFocus.id}
            </p>
          ) : null}
        </div>

        <div className="settings-block">
          <h4>{t("summaryByAction")}</h4>
          {topActions.length === 0 ? (
            <p className="settings-empty">{busy ? t("loading") : `${t("summaryByAction")}: 0`}</p>
          ) : (
            <div className="settings-perm-grid sync-count-grid">
              {topActions.map((item) => {
                const label = item.action_type || "UNKNOWN";
                return (
                  <button
                    type="button"
                    className={`sync-count-chip ${filterAction === label ? "ok" : ""}`}
                    key={label}
                    onClick={() => toggleFilter("action", label)}
                  >
                    <span>{label}</span>
                    <strong>{digits(item.count)}</strong>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <div className="settings-block">
          <h4>{t("summaryByEntity")}</h4>
          {topEntities.length === 0 ? (
            <p className="settings-empty">{busy ? t("loading") : `${t("summaryByEntity")}: 0`}</p>
          ) : (
            <div className="settings-perm-grid sync-count-grid">
              {topEntities.map((item) => {
                const label = item.entity_type || "UNKNOWN";
                return (
                  <button
                    type="button"
                    className={`sync-count-chip ${filterEntity === label ? "ok" : ""}`}
                    key={label}
                    onClick={() => toggleFilter("entity", label)}
                  >
                    <span>{label}</span>
                    <strong>{digits(item.count)}</strong>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {topSeverity.length > 0 ? (
          <div className="settings-block">
            <h4>{t("severity") || "Severity"}</h4>
            <div className="settings-perm-grid sync-count-grid">
              {topSeverity.map((item) => {
                const label = item.severity || item.name || "INFO";
                return (
                  <button
                    type="button"
                    className={`sync-count-chip ${filterSeverity === label ? "ok" : ""}`}
                    key={label}
                    onClick={() => toggleFilter("severity", label)}
                  >
                    <span>{label}</span>
                    <strong>{digits(item.count)}</strong>
                  </button>
                );
              })}
            </div>
          </div>
        ) : null}

        <div className="settings-block">
          <div className="settings-block-head">
            <div>
              <h4>{t("latestActivity")}</h4>
              <p>
                {digits(rows.length)} {t("latestActivity")}
              </p>
            </div>
          </div>

          {rows.length === 0 ? (
            <p className="settings-empty">{busy ? t("loading") : `${t("latestActivity")}: 0`}</p>
          ) : (
            <div className="audit-feed">
              {rows.map((row, index) => (
                <button
                  type="button"
                  className="audit-feed-row"
                  key={row.id || `${row.created_at || "audit"}-${index}`}
                  onClick={() => focusEntity(row)}
                  style={{ width: "100%", textAlign: "left", cursor: row.entity_id ? "pointer" : "default" }}
                >
                  <div className="audit-feed-main">
                    <div className="audit-feed-tags">
                      <span className="settings-badge role">{row.action_type || "ACTION"}</span>
                      <span className="settings-badge">{row.entity_type || "ENTITY"}</span>
                      <span className={`settings-badge ${(row.severity || "INFO") === "INFO" ? "ok" : "warn"}`}>
                        {row.severity || "INFO"}
                      </span>
                    </div>
                    <strong>{row.title || row.description || row.entity_id || t("noDetails")}</strong>
                  </div>
                  <time>{shortTime(row.created_at, digits) || t("noDate")}</time>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
