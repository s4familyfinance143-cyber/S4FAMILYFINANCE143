/** Settings → Cloud: local folder, Google Drive, Firebase. */
import { CLOUD_SYNC_INTERVALS } from "../../lib/cloudAutoSync";

export function CloudBackupPanel({
  t,
  cloudBusy,
  // Auto backup
  cloudAutoSync,
  onCloudAutoSyncChange,
  // Local
  localFolderSupported,
  localFolderLabel,
  onPickLocalFolder,
  onLocalBackup,
  onLocalRestore,
  onLocalDownload,
  // Google Drive
  driveConfigured,
  driveConnected,
  driveFiles,
  onDriveConnect,
  onDriveDisconnect,
  onDriveUpload,
  onDriveRestore,
  // Firebase
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
  function patchAutoSync(patch) {
    onCloudAutoSyncChange?.({ ...cloudAutoSync, ...patch });
  }

  return (
    <div className="settings-cloud-stack">
      <section className="settings-cloud panel-subcard">
        <h3>{t("cloudAutoBackupTitle")}</h3>
        <p className="hint">{t("cloudAutoBackupHint")}</p>
        <label className="settings-check-row">
          <input
            type="checkbox"
            checked={Boolean(cloudAutoSync?.enabled)}
            onChange={(e) => patchAutoSync({ enabled: e.target.checked })}
          />
          <span>{t("cloudAutoBackupEnable")}</span>
        </label>
        <div className="settings-cloud-actions" style={{ marginTop: 8 }}>
          <label className="hint">
            {t("cloudAutoBackupInterval")}
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
        </div>
        <div className="settings-cloud-targets">
          <label className="settings-check-row">
            <input
              type="checkbox"
              checked={Boolean(cloudAutoSync?.local)}
              disabled={!cloudAutoSync?.enabled}
              onChange={(e) => patchAutoSync({ local: e.target.checked })}
            />
            <span>{t("cloudAutoBackupLocal")}</span>
          </label>
          <label className="settings-check-row">
            <input
              type="checkbox"
              checked={Boolean(cloudAutoSync?.drive)}
              disabled={!cloudAutoSync?.enabled}
              onChange={(e) => patchAutoSync({ drive: e.target.checked })}
            />
            <span>{t("cloudAutoBackupDrive")}</span>
          </label>
          <label className="settings-check-row">
            <input
              type="checkbox"
              checked={Boolean(cloudAutoSync?.firebase)}
              disabled={!cloudAutoSync?.enabled}
              onChange={(e) => patchAutoSync({ firebase: e.target.checked })}
            />
            <span>{t("cloudAutoBackupFirebase")}</span>
          </label>
        </div>
        {cloudAutoSync?.enabled ? (
          <ul className="hint cloud-auto-last-runs">
            {cloudAutoSync.local && cloudAutoSync.lastRun?.local ? (
              <li>
                {t("localBackupTitle")}: {cloudAutoSync.lastRun.local}
              </li>
            ) : null}
            {cloudAutoSync.drive && cloudAutoSync.lastRun?.drive ? (
              <li>
                {t("driveBackupTitle")}: {cloudAutoSync.lastRun.drive}
              </li>
            ) : null}
            {cloudAutoSync.firebase && cloudAutoSync.lastRun?.firebase ? (
              <li>
                {t("firebaseCloudTitle")}: {cloudAutoSync.lastRun.firebase}
              </li>
            ) : null}
            {!cloudAutoSync.lastRun?.local &&
            !cloudAutoSync.lastRun?.drive &&
            !cloudAutoSync.lastRun?.firebase ? (
              <li>{t("cloudAutoBackupNever")}</li>
            ) : null}
          </ul>
        ) : (
          <p className="hint">{t("cloudAutoBackupOff")}</p>
        )}
      </section>

      <section className="settings-cloud panel-subcard">
        <h3>{t("localBackupTitle")}</h3>
        <p className="hint">{t("localBackupHint")}</p>
        {!localFolderSupported ? (
          <p className="hint">{t("localBackupUnsupported")}</p>
        ) : (
          <>
            {localFolderLabel ? (
              <p className="hint">
                {t("localBackupFolder")}: <strong>{localFolderLabel}</strong>
              </p>
            ) : (
              <p className="hint">{t("localBackupNoFolder")}</p>
            )}
            <div className="settings-cloud-actions">
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
          </>
        )}
      </section>

      <section className="settings-cloud panel-subcard">
        <h3>{t("driveBackupTitle")}</h3>
        <p className="hint">{t("driveBackupHint")}</p>
        {!driveConfigured ? (
          <p className="hint">{t("driveNotConfigured")}</p>
        ) : !driveConnected ? (
          <button type="button" className="btn btn-primary" disabled={cloudBusy} onClick={onDriveConnect}>
            {t("driveConnect")}
          </button>
        ) : (
          <>
            <div className="settings-badges" style={{ marginBottom: 8 }}>
              <span className="settings-badge ok">{t("driveConnected")}</span>
            </div>
            {driveFiles?.length ? (
              <ul className="hint" style={{ marginBottom: 8 }}>
                {driveFiles.slice(0, 3).map((f) => (
                  <li key={f.id}>{f.name}</li>
                ))}
              </ul>
            ) : (
              <p className="hint">{t("driveNoFiles")}</p>
            )}
            <div className="settings-cloud-actions">
              <button type="button" className="btn btn-primary" disabled={cloudBusy} onClick={onDriveUpload}>
                {t("driveUpload")}
              </button>
              <button type="button" className="btn" disabled={cloudBusy} onClick={onDriveRestore}>
                {t("driveRestore")}
              </button>
              <button type="button" className="btn" disabled={cloudBusy} onClick={onDriveDisconnect}>
                {t("driveDisconnect")}
              </button>
            </div>
          </>
        )}
      </section>

      <section className="settings-cloud panel-subcard">
        <h3>{t("firebaseCloudTitle")}</h3>
        <p className="hint">{t("firebaseCloudHint")}</p>
        {!firebaseConfigured ? (
          <p className="hint">{t("firebaseNotConfigured")}</p>
        ) : !firebaseUser ? (
          <div className="settings-cloud-auth">
            <button type="button" className="btn btn-primary" disabled={cloudBusy} onClick={onFirebaseGoogleSignIn}>
              {t("firebaseGoogleSignIn")}
            </button>
            <button type="button" className="btn" disabled={cloudBusy} onClick={onFirebaseEmailSignIn}>
              {t("firebaseSignIn")}
            </button>
            <button type="button" className="btn" disabled={cloudBusy} onClick={onFirebaseEmailRegister}>
              {t("firebaseSignUp")}
            </button>
          </div>
        ) : (
          <>
            <div className="settings-badges" style={{ marginBottom: 8 }}>
              <span className="settings-badge ok">{t("firebaseConnected")}</span>
              <span className="settings-badge">
                {firebaseUser.displayName || firebaseUser.email}
              </span>
            </div>
            {firebaseMeta?.exportedAt ? (
              <p className="hint">
                {t("firebaseLastSync")}: {firebaseMeta.exportedAt}
              </p>
            ) : (
              <p className="hint">{t("firebaseNoSnapshotYet")}</p>
            )}
            <div className="settings-cloud-actions">
              <button type="button" className="btn btn-primary" disabled={cloudBusy} onClick={onFirebaseSyncNow}>
                {t("firebaseSyncNow")}
              </button>
              <button type="button" className="btn" disabled={cloudBusy} onClick={onFirebaseRestore}>
                {t("firebaseRestore")}
              </button>
              <button type="button" className="btn" disabled={cloudBusy} onClick={onFirebaseSignOut}>
                {t("firebaseSignOut")}
              </button>
            </div>
          </>
        )}
      </section>
    </div>
  );
}
