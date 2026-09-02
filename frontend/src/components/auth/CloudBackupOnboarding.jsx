import "./cloud-backup-onboarding.css";

/**
 * First-login optional backup setup: Google Drive + local folder (skip allowed).
 */
export function CloudBackupOnboarding({
  t,
  lang,
  cloudBusy,
  driveConfigured,
  driveConnected,
  localFolderSupported,
  localFolderLabel,
  onDriveConnect,
  onPickLocalFolder,
  onSkip,
  onContinue,
}) {
  const L = lang === "en" ? UI.en : UI.bn;

  return (
    <div className="cloud-onboard-overlay" role="dialog" aria-modal="true" aria-labelledby="cloud-onboard-title">
      <div className="cloud-onboard-card">
        <p className="cloud-onboard-eyebrow">{L.eyebrow}</p>
        <h2 id="cloud-onboard-title">{L.title}</h2>
        <p className="cloud-onboard-sub">{L.subtitle}</p>

        <div className="cloud-onboard-row cloud-onboard-row--ok">
          <div className="cloud-onboard-row-head">
            <span className="cloud-onboard-ico" aria-hidden="true">☁</span>
            <div>
              <strong>{L.firebaseTitle}</strong>
              <p>{L.firebaseHint}</p>
            </div>
          </div>
          <span className="cloud-onboard-badge">{L.active}</span>
        </div>

        <div className="cloud-onboard-row">
          <div className="cloud-onboard-row-head">
            <span className="cloud-onboard-ico" aria-hidden="true">📁</span>
            <div>
              <strong>{L.driveTitle}</strong>
              <p>{L.driveHint}</p>
            </div>
          </div>
          {!driveConfigured ? (
            <p className="cloud-onboard-note">{t("driveNotConfigured")}</p>
          ) : driveConnected ? (
            <span className="cloud-onboard-badge">{L.connected}</span>
          ) : (
            <button type="button" className="btn btn-outline" disabled={cloudBusy} onClick={onDriveConnect}>
              {L.driveConnect}
            </button>
          )}
        </div>

        <div className="cloud-onboard-row">
          <div className="cloud-onboard-row-head">
            <span className="cloud-onboard-ico" aria-hidden="true">💾</span>
            <div>
              <strong>{L.localTitle}</strong>
              <p>{localFolderSupported ? L.localHint : L.localHintMobile}</p>
            </div>
          </div>
          {localFolderLabel ? (
            <span className="cloud-onboard-badge cloud-onboard-badge--muted">{localFolderLabel}</span>
          ) : localFolderSupported ? (
            <button type="button" className="btn btn-outline" disabled={cloudBusy} onClick={onPickLocalFolder}>
              {L.localPick}
            </button>
          ) : (
            <p className="cloud-onboard-note">{L.localLater}</p>
          )}
        </div>

        <div className="cloud-onboard-actions">
          <button type="button" className="btn btn-ghost" disabled={cloudBusy} onClick={onSkip}>
            {L.skip}
          </button>
          <button type="button" className="btn btn-primary" disabled={cloudBusy} onClick={onContinue}>
            {L.continue}
          </button>
        </div>
      </div>
    </div>
  );
}

const UI = {
  bn: {
    eyebrow: "প্রথম লগইন",
    title: "ব্যাকআপ সেটআপ (ঐচ্ছিক)",
    subtitle: "Firebase-এ আপনার ডেটা ইতিমধ্যে online save হচ্ছে। চাইলে Google Drive বা local folder যোগ করুন — না চাইলে Skip করুন।",
    firebaseTitle: "Firebase Cloud",
    firebaseHint: "অ্যাকাউন্ট login থাকলে automatic online backup",
    active: "চালু",
    driveTitle: "Google Drive",
    driveHint: "Extra backup — Gmail Drive-এ copy",
    driveConnect: "Drive যোগ করুন",
    connected: "যুক্ত",
    localTitle: "Local Folder",
    localHint: "PC/ব্রাউজারে folder select করে backup",
    localHintMobile: "ফোনে folder picker সীমিত — PC Settings থেকেও করা যাবে",
    localPick: "Folder বেছে নিন",
    localLater: "পরে Settings → Cloud থেকে করুন",
    skip: "Skip — পরে করব",
    continue: "অ্যাপে যান",
  },
  en: {
    eyebrow: "First sign-in",
    title: "Backup setup (optional)",
    subtitle: "Firebase already saves your data online. Add Google Drive or a local folder if you want — or skip for now.",
    firebaseTitle: "Firebase Cloud",
    firebaseHint: "Automatic online backup while you are signed in",
    active: "Active",
    driveTitle: "Google Drive",
    driveHint: "Extra backup copy in your Google Drive",
    driveConnect: "Connect Drive",
    connected: "Connected",
    localTitle: "Local folder",
    localHint: "Pick a folder on this device for backup files",
    localHintMobile: "Folder picker is limited on phone — you can also set this later on PC in Settings",
    localPick: "Choose folder",
    localLater: "Set up later in Settings → Cloud",
    skip: "Skip for now",
    continue: "Continue to app",
  },
};
