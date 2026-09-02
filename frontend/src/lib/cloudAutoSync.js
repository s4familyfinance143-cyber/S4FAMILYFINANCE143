const STORAGE_KEY = "s4_cloud_auto_backup";

export const CLOUD_SYNC_INTERVALS = [
  { minutes: 15, key: "cloudAutoSync15m" },
  { minutes: 30, key: "cloudAutoSync30m" },
  { minutes: 60, key: "cloudAutoSync1h" },
  { minutes: 240, key: "cloudAutoSync4h" },
  { minutes: 1440, key: "cloudAutoSync24h" },
];

const DEFAULT_SETTINGS = {
  enabled: false,
  intervalMinutes: 15,
  local: true,
  drive: true,
  firebase: true,
  lastRun: {
    local: null,
    drive: null,
    firebase: null,
  },
};

export function loadCloudAutoSyncSettings() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    const parsed = JSON.parse(raw);
    return {
      ...DEFAULT_SETTINGS,
      ...parsed,
      lastRun: { ...DEFAULT_SETTINGS.lastRun, ...(parsed.lastRun || {}) },
    };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveCloudAutoSyncSettings(next) {
  const merged = {
    ...DEFAULT_SETTINGS,
    ...next,
    lastRun: { ...DEFAULT_SETTINGS.lastRun, ...(next.lastRun || {}) },
  };
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(merged));
  } catch {
    /* ignore */
  }
  return merged;
}

export function intervalMs(settings) {
  const minutes = Number(settings?.intervalMinutes) || 60;
  return Math.max(15, minutes) * 60 * 1000;
}

export function shouldRunTarget(settings, target, now = Date.now()) {
  if (!settings?.enabled || !settings[target]) return false;
  const last = settings.lastRun?.[target];
  if (!last) return true;
  const elapsed = now - new Date(last).getTime();
  return elapsed >= intervalMs(settings);
}

export function markTargetRun(settings, target, at = new Date().toISOString()) {
  return saveCloudAutoSyncSettings({
    ...settings,
    lastRun: { ...settings.lastRun, [target]: at },
  });
}
