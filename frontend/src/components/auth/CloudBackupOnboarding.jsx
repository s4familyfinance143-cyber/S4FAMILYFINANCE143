import "./cloud-backup-onboarding.css";

/**
 * First-login optional backup setup: Google Drive (own account) + local folder.
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
  onLocalDownload,
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
            <span className="cloud-onboard-ico" aria-hidden="true">
              📁
            </span>
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
            <span className="cloud-onboard-ico" aria-hidden="true">
              💾
            </span>
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
            <>
              <p className="cloud-onboard-note">{L.localLater}</p>
              {onLocalDownload ? (
                <button
                  type="button"
                  className="btn btn-outline"
                  disabled={cloudBusy}
                  onClick={onLocalDownload}
                  style={{ marginTop: 8 }}
                >
                  {L.localDownload}
                </button>
              ) : null}
            </>
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
    title: "নিজের Google Drive সেটআপ",
    subtitle:
      "ডাটা আপনার নিজের Google Drive-এ সেভ হবে। একই Google অ্যাকাউন্ট দিয়ে অন্য ডিভাইসে কানেক্ট করলে ব্যাকআপ থেকে ফিরে আসবে।",
    driveTitle: "Google Drive (নিজের অ্যাকাউন্ট)",
    driveHint: "কোম্পানি ফোল্ডার নয় — শুধু আপনার Drive",
    driveConnect: "Drive যোগ করুন",
    connected: "যুক্ত",
    localTitle: "Local Folder",
    localHint: "PC/ব্রাউজারে folder select করে extra backup",
    localHintMobile: "ফোনে folder picker সীমিত — PC Settings থেকেও করা যাবে",
    localPick: "Folder বেছে নিন",
    localDownload: "Backup file download (ফোন)",
    localLater: "PC-তে folder select করুন, অথবা নিচে download",
    skip: "Skip — পরে করব",
    continue: "অ্যাপে যান",
  },
  en: {
    eyebrow: "First sign-in",
    title: "Connect your Google Drive",
    subtitle:
      "Your backup is saved in your own Google Drive. Connect the same Google account on another device to bring your data back.",
    driveTitle: "Google Drive (your account)",
    driveHint: "Not a company folder — only your Drive",
    driveConnect: "Connect Drive",
    connected: "Connected",
    localTitle: "Local folder",
    localHint: "Optional extra backup folder on this device",
    localHintMobile: "Folder picker is limited on phone — you can also set this later on PC in Settings",
    localPick: "Choose folder",
    localDownload: "Download backup file (phone)",
    localLater: "Pick a folder on PC, or download backup below",
    skip: "Skip for now",
    continue: "Continue to app",
  },
};
