/** Settings → Cloud: Local Disk, Google Drive, Secure Cloud Sync. */
import { useEffect, useState } from "react";
import { CLOUD_SYNC_INTERVALS } from "../../lib/cloudAutoSync";

function formatRelativeTime(iso, t, digits) {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;

  const diffMs = Date.now() - date.getTime();
  if (diffMs < 0) return t("relativeJustNow");

  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return t("relativeJustNow");
  if (mins < 60) {
    return t("relativeMinutesAgo").replace("{n}", digits(String(mins)));
  }
  const hours = Math.floor(mins / 60);
  if (hours < 24) {
    return t("relativeHoursAgo").replace("{n}", digits(String(hours)));
  }
  const days = Math.floor(hours / 24);
  if (days < 14) {
    return t("relativeDaysAgo").replace("{n}", digits(String(days)));
  }
  try {
    return date.toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  } catch {
    return date.toLocaleDateString();
  }
}

function lastBackedUpLabel(iso, t, digits) {
  const relative = formatRelativeTime(iso, t, digits);
  if (!relative) return null;
  return t("lastBackedUp").replace("{time}", relative);
}

function StatusBadge({ kind, label }) {
  const className =
    kind === "ok"
      ? "cloud-status-badge ok"
      : kind === "warn"
        ? "cloud-status-badge warn"
        : "cloud-status-badge";
  return <span className={className}>{label}</span>;
}

export function CloudBackupPanel({
  t,
  digits = (v) => String(v ?? ""),
  cloudBusy,
  cloudAutoSync,
  onCloudAutoSyncChange,
  localFolderSupported,
  localFolderLabel,
  onPickLocalFolder,
  onLocalBackup,
  onLocalRestore,
  onLocalDownload,
  driveConfigured,
  driveConnected,
  driveFiles,
  onDriveConnect,
  onDriveDisconnect,
  onDriveUpload,
  onDriveRestore,
  firebaseConfigured,
  firebaseUser,
  firebaseMeta,
  onFirebaseGoogleSignIn,
  onFirebaseEmailSignIn,
  onFirebaseEmailRegister,
  onFirebaseSignOut,
  onFirebaseSyncNow,
  onFirebaseRestore,
}) {
  const localActive = Boolean(localFolderSupported && localFolderLabel);
  const cloudConnected = Boolean(firebaseConfigured && firebaseUser);
  const lastLocal = cloudAutoSync?.lastRun?.local || null;
  const lastDrive = cloudAutoSync?.lastRun?.drive || null;
  const lastCloud = firebaseMeta?.exportedAt || cloudAutoSync?.lastRun?.firebase || null;

  const localStatus = {
    kind: localActive ? "ok" : "warn",
    label: localActive ? t("cloudStatusActive") : t("cloudStatusNotConfigured"),
  };
  const driveStatus = {
    kind: driveConfigured && driveConnected ? "ok" : "warn",
    label:
      driveConfigured && driveConnected
        ? t("cloudStatusConnected")
        : t("cloudStatusNotConfigured"),
  };
  const cloudStatus = {
    kind: cloudConnected ? "ok" : "warn",
    label: cloudConnected ? t("cloudStatusConnected") : t("cloudStatusNotConfigured"),
  };

  const [providerTab, setProviderTab] = useState(() =>
    cloudConnected ? "cloud" : localActive ? "local" : "cloud"
  );

  function patchAutoSync(patch) {
    onCloudAutoSyncChange?.({ ...cloudAutoSync, ...patch });
  }

  useEffect(() => {
    if (!driveConfigured) {
      console.info(
        "[S4 Cloud] Google Drive not configured — set VITE_GOOGLE_CLIENT_ID in frontend/.env (see deploy/FIREBASE_SETUP.md)"
      );
    }
    if (!firebaseConfigured) {
      console.info(
        "[S4 Cloud] Secure Cloud Sync not configured — enable Auth + Firestore and set VITE_FIREBASE_* (see deploy/FIREBASE_SETUP.md)"
      );
    }
  }, [driveConfigured, firebaseConfigured]);

  const tabs = [
    { id: "cloud", short: t("cloudProviderTabCloud"), status: cloudStatus },
    { id: "local", short: t("cloudProviderTabLocal"), status: localStatus },
    { id: "drive", short: t("cloudProviderTabDrive"), status: driveStatus },
  ];

  return (
    <div className="settings-cloud-page">
      <section className="cloud-auto-bar panel-subcard">
        <div className="cloud-auto-bar-head">
          <div>
            <h3>{t("cloudAutoBackupTitle")}</h3>
            <p className="hint cloud-card-hint">{t("cloudAutoBackupHint")}</p>
          </div>
          <label className="cloud-toggle-row">
            <input
              type="checkbox"
              checked={Boolean(cloudAutoSync?.enabled)}
              onChange={(e) => patchAutoSync({ enabled: e.target.checked })}
            />
            <span>{t("cloudAutoBackupEnable")}</span>
          </label>
        </div>

        <div className="cloud-auto-controls">
          <label className="cloud-field">
            <span className="cloud-field-label">{t("cloudAutoBackupInterval")}</span>
            <select
              value={cloudAutoSync?.intervalMinutes || 60}
              disabled={!cloudAutoSync?.enabled}
              onChange={(e) => patchAutoSync({ intervalMinutes: Number(e.target.value) })}
            >
              {CLOUD_SYNC_INTERVALS.map((item) => (
                <option key={item.minutes} value={item.minutes}>
                  {t(item.key)}
                </option>
              ))}
            </select>
          </label>

          <div className="cloud-auto-targets" role="group" aria-label={t("cloudAutoBackupTitle")}>
            <label className="cloud-chip-check">
              <input
                type="checkbox"
                checked={Boolean(cloudAutoSync?.local)}
                disabled={!cloudAutoSync?.enabled}
                onChange={(e) => patchAutoSync({ local: e.target.checked })}
              />
              <span>{t("cloudAutoBackupLocal")}</span>
            </label>
            <label className="cloud-chip-check">
              <input
                type="checkbox"
                checked={Boolean(cloudAutoSync?.drive)}
                disabled={!cloudAutoSync?.enabled}
                onChange={(e) => patchAutoSync({ drive: e.target.checked })}
              />
              <span>{t("cloudAutoBackupDrive")}</span>
            </label>
            <label className="cloud-chip-check">
              <input
                type="checkbox"
                checked={Boolean(cloudAutoSync?.firebase)}
                disabled={!cloudAutoSync?.enabled}
                onChange={(e) => patchAutoSync({ firebase: e.target.checked })}
              />
              <span>{t("cloudAutoBackupFirebase")}</span>
            </label>
          </div>
        </div>

        {cloudAutoSync?.enabled ? (
          <p className="hint cloud-auto-summary">
            {lastLocal || lastDrive || lastCloud
              ? [
                  cloudAutoSync.local && lastLocal
                    ? `${t("cloudAutoBackupLocal")}: ${formatRelativeTime(lastLocal, t, digits)}`
                    : null,
                  cloudAutoSync.drive && lastDrive
                    ? `${t("cloudAutoBackupDrive")}: ${formatRelativeTime(lastDrive, t, digits)}`
                    : null,
                  cloudAutoSync.firebase && lastCloud
                    ? `${t("cloudAutoBackupFirebase")}: ${formatRelativeTime(lastCloud, t, digits)}`
                    : null,
                ]
                  .filter(Boolean)
                  .join(" · ") || t("cloudAutoBackupNever")
              : t("cloudAutoBackupNever")}
          </p>
        ) : (
          <p className="hint cloud-auto-summary">{t("cloudAutoBackupOff")}</p>
        )}
      </section>

      <div
        className="cloud-provider-tabs"
        role="tablist"
        aria-label={t("settingsTab_cloud")}
      >
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            id={`cloud-tab-${tab.id}`}
            aria-selected={providerTab === tab.id}
            aria-controls={`cloud-panel-${tab.id}`}
            className={`cloud-provider-tab${providerTab === tab.id ? " is-active" : ""}`}
            onClick={() => setProviderTab(tab.id)}
          >
            <span className="cloud-provider-tab-label">{tab.short}</span>
            <StatusBadge kind={tab.status.kind} label={tab.status.label} />
          </button>
        ))}
      </div>

      <div className="cloud-providers-grid" data-active-tab={providerTab}>
        {/* Local Disk */}
        <article
          id="cloud-panel-local"
          role="tabpanel"
          aria-labelledby="cloud-tab-local"
          data-provider="local"
          className={`cloud-provider-card panel-subcard${providerTab === "local" ? " is-active" : ""}`}
        >
          <header className="cloud-card-header">
            <div>
              <h3>
                {t("localBackupTitle")}
                <span className="cloud-mobile-inline-status">
                  : {localStatus.label}
                </span>
              </h3>
              <p className="hint cloud-card-hint">{t("localBackupHint")}</p>
            </div>
            <StatusBadge kind={localStatus.kind} label={localStatus.label} />
          </header>

          <div className="cloud-card-body">
            {!localFolderSupported ? (
              <p className="hint">{t("localBackupUnsupported")}</p>
            ) : localFolderLabel ? (
              <p className="cloud-meta">
                <span className="cloud-meta-label">{t("localBackupFolder")}</span>
                <strong className="cloud-meta-value" title={localFolderLabel}>
                  {localFolderLabel}
                </strong>
              </p>
            ) : (
              <p className="hint">{t("localBackupNoFolder")}</p>
            )}
            {lastLocal ? (
              <p className="cloud-last-sync">{lastBackedUpLabel(lastLocal, t, digits)}</p>
            ) : null}
          </div>

          {localFolderSupported ? (
            <div className="cloud-card-actions">
              <button type="button" className="btn" disabled={cloudBusy} onClick={onPickLocalFolder}>
                {t("localBackupPickFolder")}
              </button>
              <button type="button" className="btn btn-primary" disabled={cloudBusy} onClick={onLocalBackup}>
                {t("localBackupSave")}
              </button>
              <button type="button" className="btn" disabled={cloudBusy} onClick={onLocalRestore}>
                {t("localBackupRestore")}
              </button>
              <button type="button" className="btn" disabled={cloudBusy} onClick={onLocalDownload}>
                {t("localBackupDownload")}
              </button>
            </div>
          ) : null}
        </article>

        {/* Google Drive */}
        <article
          id="cloud-panel-drive"
          role="tabpanel"
          aria-labelledby="cloud-tab-drive"
          data-provider="drive"
          className={`cloud-provider-card panel-subcard${providerTab === "drive" ? " is-active" : ""}`}
        >
          <header className="cloud-card-header">
            <div>
              <h3>
                {t("driveBackupTitle")}
                <span className="cloud-mobile-inline-status">
                  : {driveStatus.label}
                </span>
              </h3>
              <p className="hint cloud-card-hint">{t("driveBackupHint")}</p>
            </div>
            <StatusBadge kind={driveStatus.kind} label={driveStatus.label} />
          </header>

          <div className="cloud-card-body">
            {!driveConfigured ? (
              <p className="hint">{t("driveNotConfigured")}</p>
            ) : !driveConnected ? (
              <p className="hint">{t("driveConnectHint")}</p>
            ) : (
              <>
                {driveFiles?.length ? (
                  <ul className="cloud-file-list">
                    {driveFiles.slice(0, 2).map((f) => (
                      <li key={f.id} title={f.name}>
                        {f.name}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="hint">{t("driveNoFiles")}</p>
                )}
                {lastDrive ? (
                  <p className="cloud-last-sync">{lastBackedUpLabel(lastDrive, t, digits)}</p>
                ) : null}
              </>
            )}
          </div>

          <div className="cloud-card-actions">
            {!driveConfigured ? null : !driveConnected ? (
              <button type="button" className="btn btn-primary" disabled={cloudBusy} onClick={onDriveConnect}>
                {t("driveConnect")}
              </button>
            ) : (
              <>
                <button type="button" className="btn btn-primary" disabled={cloudBusy} onClick={onDriveUpload}>
                  {t("driveUpload")}
                </button>
                <button type="button" className="btn" disabled={cloudBusy} onClick={onDriveRestore}>
                  {t("driveRestore")}
                </button>
                <button type="button" className="btn" disabled={cloudBusy} onClick={onDriveDisconnect}>
                  {t("driveDisconnect")}
                </button>
              </>
            )}
          </div>
        </article>

        {/* Secure Cloud Sync */}
        <article
          id="cloud-panel-cloud"
          role="tabpanel"
          aria-labelledby="cloud-tab-cloud"
          data-provider="cloud"
          className={`cloud-provider-card panel-subcard${providerTab === "cloud" ? " is-active" : ""}`}
        >
          <header className="cloud-card-header">
            <div>
              <h3>
                {t("firebaseCloudTitle")}
                <span className="cloud-mobile-inline-status">
                  : {cloudStatus.label}
                </span>
              </h3>
              <p className="hint cloud-card-hint">{t("firebaseCloudHint")}</p>
            </div>
            <StatusBadge kind={cloudStatus.kind} label={cloudStatus.label} />
          </header>

          <div className="cloud-card-body">
            {!firebaseConfigured ? (
              <p className="hint">{t("firebaseNotConfigured")}</p>
            ) : !firebaseUser ? (
              <p className="hint">{t("firebaseSignInHint")}</p>
            ) : (
              <>
                <p className="cloud-meta">
                  <span className="cloud-meta-label">{t("account")}</span>
                  <strong className="cloud-meta-value">
                    {firebaseUser.displayName || firebaseUser.email}
                  </strong>
                </p>
                {lastCloud ? (
                  <p className="cloud-last-sync">{lastBackedUpLabel(lastCloud, t, digits)}</p>
                ) : (
                  <p className="hint">{t("firebaseNoSnapshotYet")}</p>
                )}
              </>
            )}
          </div>

          <div className="cloud-card-actions">
            {!firebaseConfigured ? null : !firebaseUser ? (
              <>
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={cloudBusy}
                  onClick={onFirebaseGoogleSignIn}
                >
                  {t("firebaseGoogleSignIn")}
                </button>
                <button type="button" className="btn" disabled={cloudBusy} onClick={onFirebaseEmailSignIn}>
                  {t("firebaseSignIn")}
                </button>
                <button type="button" className="btn" disabled={cloudBusy} onClick={onFirebaseEmailRegister}>
                  {t("firebaseSignUp")}
                </button>
              </>
            ) : (
              <>
                <button type="button" className="btn btn-primary" disabled={cloudBusy} onClick={onFirebaseSyncNow}>
                  {t("firebaseSyncNow")}
                </button>
                <button type="button" className="btn" disabled={cloudBusy} onClick={onFirebaseRestore}>
                  {t("firebaseRestore")}
                </button>
                <button type="button" className="btn" disabled={cloudBusy} onClick={onFirebaseSignOut}>
                  {t("firebaseSignOut")}
                </button>
              </>
            )}
          </div>
        </article>
      </div>
    </div>
  );
}
