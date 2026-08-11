const SYNC_TABS = ["status", "push", "conflicts", "pull", "logs"];

function PayloadPreview({ title, payload }) {
  if (!payload) return <p className="settings-empty">{title}: —</p>;
  const text = typeof payload === "string" ? payload : JSON.stringify(payload, null, 2);
  return (
    <div className="sync-payload">
      <strong>{title}</strong>
      <pre>{text.slice(0, 800)}</pre>
    </div>
  );
}

function formatWhen(value, t, digits) {
  if (!value) return t("never");
  return digits(value);
}

export function SyncPanel({
  t,
  digits,
  syncTab,
  setSyncTab,
  syncStatus,
  syncConflicts,
  syncResolvedConflicts,
  syncPullPreview,
  syncLoading,
  syncPullLoading,
  syncPushLoading,
  syncResolveLoadingId,
  deviceId,
  localOutboxPending = 0,
  browserOnline = true,
  offlineStoreMode = "indexeddb",
  offlineStoreNote,
  autoSyncEnabled = true,
  onToggleAutoSync,
  lastAutoSyncAt = "",
  onRefresh,
  onPull,
  onPush,
  onResolve,
  syncLogs = null,
  syncLogsLoading = false,
  onLoadSyncLogs,
}) {
  const pending = Number(syncStatus?.pending_outbox || 0) + Number(localOutboxPending || 0);
  const openConflicts = Number(syncStatus?.open_conflicts || syncConflicts.length || 0);
  const offlineFirst = Boolean(syncStatus?.offline_first);
  const tableCounts = Object.entries(syncStatus?.table_counts || {});
  const healthOk = pending === 0 && openConflicts === 0 && browserOnline;

  return (
    <section className="panel settings-panel settings-smart sync-smart">
      <div className="settings-head">
        <div>
          <p className="settings-kicker">{t("offlineReady")}</p>
          <h2>{t("offlineSync")}</h2>
        </div>
        <button type="button" className="btn" disabled={syncLoading} onClick={onRefresh}>
          {syncLoading ? t("loading") : t("refreshSyncStatus")}
        </button>
      </div>

      <div className="settings-tabs" role="tablist">
        {SYNC_TABS.map((tab) => (
          <button
            key={tab}
            type="button"
            role="tab"
            aria-selected={syncTab === tab}
            className={syncTab === tab ? "settings-tab active" : "settings-tab"}
            onClick={() => {
              setSyncTab(tab);
              if (tab === "logs") onLoadSyncLogs?.();
            }}
          >
            {t(`syncTab_${tab}`)}
          </button>
        ))}
      </div>

      <div className="settings-identity sync-identity">
        <div className={`sync-health ${healthOk ? "ok" : "warn"}`}>
          <strong>{healthOk ? "OK" : "!"}</strong>
          <span>{healthOk ? t("systemNormal") : t("syncQueueActive")}</span>
        </div>
        <div className="settings-identity-copy">
          <h3>{syncStatus?.device_id || deviceId}</h3>
          <p>{offlineFirst ? t("offlineFirstEnabled") : t("refreshSyncStatus")}</p>
          <div className="settings-badges">
            <span className={`settings-badge ${browserOnline ? "ok" : "warn"}`}>
              {browserOnline ? t("browserOnline") : t("browserOffline")}
            </span>
            <span className={`settings-badge ${offlineFirst ? "ok" : "warn"}`}>
              {offlineFirst ? t("offlineReady") : t("device")}
            </span>
            <span className={`settings-badge ${pending ? "warn" : "ok"}`}>
              {t("pendingOutbox")}: {digits(pending)}
            </span>
            <span className={`settings-badge ${openConflicts ? "warn" : "ok"}`}>
              {t("openConflicts")}: {digits(openConflicts)}
            </span>
            <span className={`settings-badge ${autoSyncEnabled ? "ok" : "warn"}`}>
              {t("autoSync") || "Auto sync"}: {autoSyncEnabled ? "ON" : "OFF"}
            </span>
            <span className="settings-badge ok">
              {t("offlineDb") || "Offline DB"}: {offlineStoreMode}
            </span>
          </div>
        </div>
      </div>

      <div className="settings-stat-row">
        <div className="settings-stat">
          <span>{t("device")}</span>
          <strong className="sync-stat-device">{syncStatus?.device_id || deviceId}</strong>
        </div>
        <div className="settings-stat">
          <span>{t("offlineDb") || "Offline DB"}</span>
          <strong>{offlineStoreMode}</strong>
          <small>
            {offlineStoreNote ||
              "Browser IndexedDB outbox (PC). Native SQLCipher is mobile-only."}
          </small>
        </div>
        <div className="settings-stat">
          <span>{t("pendingOutbox")}</span>
          <strong>{digits(pending)}</strong>
          <small>{t("localWritesWaiting")}</small>
        </div>
        <div className="settings-stat">
          <span>{t("openConflicts")}</span>
          <strong>{digits(openConflicts)}</strong>
          <small>{t("conflictResolveHelp")}</small>
        </div>
        <div className="settings-stat">
          <span>{t("lastToken")}</span>
          <strong className="sync-stat-token">
            {syncStatus?.sync_state?.last_sync_token
              ? digits(String(syncStatus.sync_state.last_sync_token).slice(0, 19))
              : t("notSynced")}
          </strong>
          <small>
            {t("lastPull")}: {formatWhen(syncStatus?.sync_state?.last_pull_at, t, digits)}
          </small>
        </div>
      </div>

      {syncTab === "status" && (
        <div className="settings-stack">
          <div className="settings-block">
            <div className="settings-block-head">
              <div>
                <h4>{t("autoSync") || "Auto sync"}</h4>
                <p>
                  {autoSyncEnabled
                    ? t("autoSyncOnHint") || "Flushes IndexedDB outbox about every 45s while online."
                    : t("autoSyncOffHint") || "Automatic outbox flush is paused."}
                  {lastAutoSyncAt
                    ? ` · ${t("lastAutoSync") || "Last auto-sync"}: ${digits(lastAutoSyncAt)}`
                    : ""}
                </p>
              </div>
              <button
                type="button"
                className={`btn ${autoSyncEnabled ? "btn-primary" : ""}`}
                disabled={!onToggleAutoSync}
                onClick={onToggleAutoSync}
              >
                {autoSyncEnabled
                  ? t("autoSyncPause") || "Auto sync ON"
                  : t("autoSyncResume") || "Auto sync OFF"}
              </button>
            </div>
          </div>

          <div className="settings-block">
            <h4>{t("tableCounts")}</h4>
            {tableCounts.length === 0 ? (
              <p className="settings-empty">{syncLoading ? t("loading") : t("noSyncStatus")}</p>
            ) : (
              <div className="settings-perm-grid sync-count-grid">
                {tableCounts.map(([table, count]) => (
                  <div className="sync-count-chip" key={table}>
                    <span>{table}</span>
                    <strong>{digits(count)}</strong>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="settings-block">
            <h4>{t("syncState")}</h4>
            <div className="sync-state-grid">
              <div>
                <span className="settings-label">{t("lastToken")}</span>
                <strong className="sync-token-full">
                  {syncStatus?.sync_state?.last_sync_token
                    ? digits(syncStatus.sync_state.last_sync_token)
                    : t("notSynced")}
                </strong>
              </div>
              <div>
                <span className="settings-label">{t("lastPull")}</span>
                <strong>{formatWhen(syncStatus?.sync_state?.last_pull_at, t, digits)}</strong>
              </div>
              <div>
                <span className="settings-label">{t("lastPush")}</span>
                <strong>{formatWhen(syncStatus?.sync_state?.last_push_at, t, digits)}</strong>
              </div>
            </div>
          </div>
        </div>
      )}

      {syncTab === "push" && (
        <div className="settings-stack">
          <div className="settings-block">
            <div className="settings-block-head">
              <div>
                <h4>{t("pushLocalOutbox")}</h4>
                <p>
                  {t("localPendingOutbox")}: {digits(localOutboxPending)} · {t("pendingOutbox")}:{" "}
                  {digits(syncStatus?.pending_outbox || 0)}
                </p>
              </div>
              <button
                type="button"
                className="btn btn-primary"
                disabled={syncPushLoading || !browserOnline || !onPush}
                onClick={onPush}
              >
                {syncPushLoading ? t("pushingOutbox") : t("pushLocalOutbox")}
              </button>
            </div>
            {!browserOnline ? <p className="settings-help">{t("syncQueuedOffline")}</p> : null}
          </div>
        </div>
      )}

      {syncTab === "conflicts" && (
        <div className="settings-stack">
          <div className="settings-block">
            <h4>{t("openConflicts")}</h4>
            {syncConflicts.length === 0 ? (
              <p className="settings-empty">{t("noOpenSyncConflicts")}</p>
            ) : (
              <div className="conflict-list">
                {syncConflicts.map((conflict) => (
                  <div className="conflict-card" key={conflict.id}>
                    <div className="row">
                      <span>{conflict.entity_type || "ENTITY"}</span>
                      <span>{conflict.entity_id || t("noDetails")}</span>
                      <strong>{conflict.status || "OPEN"}</strong>
                    </div>
                    <div className="sync-diff-grid">
                      <PayloadPreview title={t("localPayload")} payload={conflict.local_payload} />
                      <PayloadPreview title={t("remotePayload")} payload={conflict.remote_payload} />
                    </div>
                    <div className="settings-form-row compact">
                      <button
                        type="button"
                        className="btn"
                        disabled={syncResolveLoadingId === conflict.id}
                        onClick={() => onResolve(conflict, "keep_server")}
                      >
                        {t("keepServer")}
                      </button>
                      <button
                        type="button"
                        className="btn"
                        disabled={syncResolveLoadingId === conflict.id}
                        onClick={() => onResolve(conflict, "keep_local")}
                      >
                        {t("keepLocal")}
                      </button>
                      <button
                        type="button"
                        className="btn btn-primary"
                        disabled={syncResolveLoadingId === conflict.id}
                        onClick={() => onResolve(conflict, "merge")}
                      >
                        {t("mergeBoth")}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="settings-block">
            <h4>{t("resolvedConflicts")}</h4>
            {syncResolvedConflicts.length === 0 ? (
              <p className="settings-empty">{t("noResolvedConflicts")}</p>
            ) : (
              <div className="table">
                {syncResolvedConflicts.map((conflict) => (
                  <div className="row" key={conflict.id}>
                    <span>{conflict.entity_type || "ENTITY"}</span>
                    <span>{conflict.entity_id || t("noDetails")}</span>
                    <strong>{conflict.resolution_payload?.strategy || "RESOLVED"}</strong>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {syncTab === "pull" && (
        <div className="settings-stack">
          <div className="settings-block">
            <div className="settings-block-head">
              <div>
                <h4>{t("pullServerChanges")}</h4>
                <p>{t("lastPullPreview")}</p>
              </div>
              <button type="button" className="btn btn-primary" disabled={syncPullLoading} onClick={onPull}>
                {syncPullLoading ? t("loading") : t("pullServerChanges")}
              </button>
            </div>
          </div>

          {syncPullPreview ? (
            <div className="settings-block">
              <h4>{t("lastPullPreview")}</h4>
              <div className="settings-perm-grid sync-count-grid">
                {Object.entries(syncPullPreview.change_counts || {}).map(([table, count]) => (
                  <div className="sync-count-chip" key={table}>
                    <span>{table}</span>
                    <strong>{digits(count)}</strong>
                  </div>
                ))}
              </div>
              {syncPullPreview.next_sync_token ? (
                <p className="settings-help">
                  {t("lastToken")}: {digits(syncPullPreview.next_sync_token)}
                </p>
              ) : null}
            </div>
          ) : (
            <div className="settings-block">
              <p className="settings-empty">{t("noPullPreview")}</p>
            </div>
          )}
        </div>
      )}

      {syncTab === "logs" && (
        <div className="settings-stack">
          <div className="settings-block">
            <div className="settings-block-head">
              <div>
                <h4>{t("syncTab_logs") || "Sync history"}</h4>
                <p>
                  {t("syncSuccessRate") || "Success rate"}:{" "}
                  {digits(Math.round(Number(syncLogs?.summary?.success_rate || 0) * 100))}% ·{" "}
                  {t("failCount") || "Fails"}: {digits(syncLogs?.summary?.fail_count || 0)}
                </p>
              </div>
              <button type="button" className="btn" disabled={syncLogsLoading} onClick={onLoadSyncLogs}>
                {syncLogsLoading ? t("loading") : t("refreshSyncStatus")}
              </button>
            </div>
            {(syncLogs?.rows || []).length ? (
              <div className="table" style={{ marginTop: 12 }}>
                {(syncLogs.rows || []).map((row) => (
                  <div className="row" key={row.id}>
                    <span>{formatWhen(row.synced_at, t, digits)}</span>
                    <span>{row.device_id || "—"}</span>
                    <span>{digits(row.items_synced || 0)}</span>
                    <strong style={{ color: row.success ? undefined : "#b45309" }}>
                      {row.success ? "OK" : row.error_msg || "FAIL"}
                    </strong>
                  </div>
                ))}
              </div>
            ) : (
              <p className="settings-empty">{syncLogsLoading ? t("loading") : t("noData") || "No data"}</p>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
