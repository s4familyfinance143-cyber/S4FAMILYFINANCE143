const PREFIX = "s4_backup_onboarding_";

export function loadBackupOnboardingDone(uid) {
  if (!uid) return true;
  try {
    const v = localStorage.getItem(`${PREFIX}${uid}`);
    return v === "done" || v === "skipped";
  } catch {
    return false;
  }
}

export function saveBackupOnboardingDone(uid, skipped = false) {
  if (!uid) return;
  try {
    localStorage.setItem(`${PREFIX}${uid}`, skipped ? "skipped" : "done");
  } catch {
    /* ignore */
  }
}
