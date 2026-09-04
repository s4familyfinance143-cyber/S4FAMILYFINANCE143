import { useEffect, useState } from "react";
import { CloudBackupPanel } from "./CloudBackupPanel";

const SETTINGS_TABS = ["profile", "family", "permissions", "security", "cloud"];

const PERMISSION_CATEGORIES = [
  {
    id: "finance",
    titleKey: "permCategoryFinance",
    keys: [
      "dashboard.read",
      "accounts.create",
      "accounts.read",
      "transactions.create",
      "income.create",
      "expense.create",
      "transactions.read",
    ],
    memberKeys: [
      "expense.create",
      "income.create",
      "transactions.create",
      "transactions.read",
      "accounts.read",
    ],
  },
  {
    id: "reports",
    titleKey: "permCategoryReports",
    keys: ["reports.read"],
    memberKeys: ["reports.read"],
  },
  {
    id: "governance",
    titleKey: "permCategoryGovernance",
    memberTitleKey: "permCategoryBackups",
    keys: [
      "settings.manage",
      "audit.read",
      "backup.create",
      "backup.read",
      "backup.download",
      "backup.restore",
      "sync.view",
      "sync.pull",
      "sync.push",
      "sync.conflicts",
      "sync.resolve",
      "sync.manage",
    ],
    memberKeys: ["backup.create", "backup.read", "backup.restore"],
  },
];

function langOptionLabel(language) {
  if (language.nativeName === language.name) return language.nativeName;
  return `${language.nativeName} (${language.name})`;
}

function hasPermission(effective = [], key) {
  if (!key) return false;
  if (effective.includes("*")) return true;
  return effective.includes(key);
}

function categoryAccessLevel(effective = [], keys = []) {
  if (effective.includes("*")) return "full";
  const list = keys.filter(Boolean);
  if (!list.length) return "restricted";
  const allowed = list.filter((k) => hasPermission(effective, k));
  if (allowed.length === list.length) return "full";
  if (allowed.length === 0) return "restricted";
  const onlyRead =
    allowed.length > 0 &&
    allowed.every((k) => k.endsWith(".read") || k.endsWith(".view") || k.includes(".view"));
  if (onlyRead && allowed.length === list.filter((k) => k.endsWith(".read") || k.includes(".view")).length) {
    return "read";
  }
  const hasWrite = allowed.some(
    (k) =>
      k.includes(".create") ||
      k.includes(".manage") ||
      k.includes(".update") ||
      k.includes(".restore") ||
      k.includes(".push") ||
      k.includes(".resolve"),
  );
  if (!hasWrite) return "read";
  return "restricted";
}

function accessBadgeMeta(level, t) {
  if (level === "full") {
    return { kind: "ok", label: t("permAccessFull") || "Full Access" };
  }
  if (level === "read") {
    return { kind: "info", label: t("permAccessRead") || "Read Only" };
  }
  return { kind: "warn", label: t("permAccessRestricted") || "Restricted" };
}

function friendlyPermissionLabel(key) {
  const map = {
    "dashboard.read": "Can View Dashboard",
    "accounts.create": "Can Create Wallets",
    "accounts.read": "Can View Wallets",
    "transactions.create": "Can Add Transactions",
    "income.create": "Can Add Income",
    "expense.create": "Can Add Expenses",
    "transactions.read": "Can View Transactions",
    "reports.read": "Can View Reports",
    "audit.read": "Can View Audit",
    "backup.create": "Can Create Backups",
    "backup.read": "Can View Backups",
    "backup.download": "Can Download Backups",
    "backup.restore": "Can Restore Backups",
    "sync.view": "Can View Sync",
    "sync.pull": "Can Pull Sync",
    "sync.push": "Can Push Sync",
    "sync.conflicts": "Can View Conflicts",
    "sync.resolve": "Can Resolve Conflicts",
    "sync.manage": "Can Manage Sync",
    "settings.manage": "Can Manage Settings",
  };
  return map[key] || key;
}

function memberDisplayName(member) {
  return (
    member?.full_name ||
    member?.display_name ||
    member?.name ||
    member?.email ||
    member?.user_id ||
    member?.member_id ||
    "Member"
  );
}

function memberRelationshipLabel(member) {
  return (
    member?.relationship_display_label ||
    member?.relationship ||
    member?.relationship_type ||
    ""
  );
}

function formatRoleBadge(role) {
  const r = String(role || "MEMBER").toUpperCase();
  if (r === "OWNER") return "Owner";
  if (r === "ADMIN") return "Admin";
  if (r === "VIEWER") return "Viewer";
  if (r === "CHILD") return "Child";
  return "Member";
}

function normalizeMemberForPermissions(member) {
  const role = String(member?.normalized_role || member?.role || "MEMBER").toUpperCase();
  const memberId = member?.member_id || member?.id || member?.uid || member?.user_id;
  return {
    ...member,
    member_id: memberId,
    full_name: memberDisplayName(member),
    role,
    normalized_role: role,
    relationship: memberRelationshipLabel(member),
    overrides: Array.isArray(member?.overrides) ? member.overrides : [],
    effective_permissions: Array.isArray(member?.effective_permissions)
      ? member.effective_permissions
      : role === "OWNER" || role === "ADMIN"
        ? ["*"]
        : [
            "dashboard.read",
            "accounts.read",
            "transactions.read",
            "transactions.create",
            "income.create",
            "expense.create",
            "reports.read",
            "backup.read",
            "sync.view",
            "sync.pull",
          ],
  };
}

export function SettingsPanel({
  t,
  digits,
  settingsTab,
  setSettingsTab,
  settingsLoading,
  settingsSaving,
  currentUser,
  email,
  avatarUrl = "",
  onUploadPhoto,
  onRemovePhoto,
  activeFamily,
  familyCurrencyForm,
  setFamilyCurrencyForm,
  familyTimezoneForm,
  setFamilyTimezoneForm,
  onSaveFamilySettings,
  myPermissions,
  effectivePermissions,
  permissionOverrides,
  memberPermissions,
  governanceMembers = [],
  permissionForms,
  updatePermissionForm,
  saveMemberPermission,
  toggleMemberPermission,
  permissionSavingMemberId,
  commonPermissionKeys,
  currentLanguage: _currentLanguage,
  appLanguage,
  changeAppLanguage,
  lockedLanguages,
  refreshToken,
  securityAction,
  refreshSession,
  requestPasswordReset,
  resendVerification,
  emailStatus,
  onRefresh,
  apiBase = "",
  onApiBaseChange,
  browserOnline = typeof navigator !== "undefined" ? navigator.onLine : true,
  cloudBusy = false,
  cloudAutoSync,
  onCloudAutoSyncChange,
  localFolderSupported = false,
  localFolderLabel = "",
  onPickLocalFolder,
  onLocalBackup,
  onLocalRestore,
  onLocalDownload,
  driveConfigured = false,
  driveConnected = false,
  driveFiles = [],
  onDriveConnect,
  onDriveDisconnect,
  onDriveUpload,
  onDriveRestore,
  firebaseConfigured = false,
  firebaseUser = null,
  firebaseMeta = null,
  onFirebaseGoogleSignIn,
  onFirebaseEmailSignIn,
  onFirebaseEmailRegister,
  onFirebaseSignOut,
  onFirebaseSyncNow,
  onFirebaseRestore,
  cloudOnlyMode = false,
}) {
  const displayName = currentUser?.full_name || currentUser?.email || email || "—";
  const displayEmail = currentUser?.email || email || "—";
  const role = myPermissions?.normalized_role || myPermissions?.role || "—";
  const relationship = myPermissions?.relationship || "—";
  const initials = String(displayName).trim().slice(0, 2).toUpperCase();
  const [apiBaseDraft, setApiBaseDraft] = useState(apiBase || "");
  const [photoUploading, setPhotoUploading] = useState(false);
  const [photoRemoving, setPhotoRemoving] = useState(false);
  const [developerMode, setDeveloperMode] = useState(() => {
    try {
      return localStorage.getItem("s4-developer-mode") === "1";
    } catch {
      return false;
    }
  });

  const roleKey = String(role || "").toUpperCase();
  const isOwnerOrAdmin = roleKey === "OWNER" || roleKey === "ADMIN";
  const isLocalDev = Boolean(import.meta.env.DEV);
  // Family cloud/Firebase users never need localhost API URL.
  // Show only when Developer Mode is on AND not in cloud-only mode.
  const showApiBaseCard = Boolean(developerMode) && !cloudOnlyMode;
  const [permMobile, setPermMobile] = useState(() =>
    typeof window !== "undefined" ? window.matchMedia("(max-width: 768px)").matches : false,
  );

  const displayMemberPermissions = (() => {
    const keyOf = (m) => {
      const email = String(m?.email || "").trim().toLowerCase();
      if (email) return `email:${email}`;
      return `id:${String(m?.member_id || m?.id || m?.uid || m?.user_id || "").trim()}`;
    };
    const byKey = new Map();
    for (const raw of memberPermissions || []) {
      const m = normalizeMemberForPermissions(raw);
      const key = keyOf(m);
      if (key && key !== "id:") byKey.set(key, m);
    }
    for (const raw of governanceMembers || []) {
      const m = normalizeMemberForPermissions(raw);
      const key = keyOf(m);
      if (!key || key === "id:") continue;
      if (!byKey.has(key)) {
        byKey.set(key, m);
        continue;
      }
      const existing = byKey.get(key);
      byKey.set(key, {
        ...m,
        ...existing,
        full_name: existing.full_name || m.full_name,
        relationship: existing.relationship || m.relationship,
        email: existing.email || m.email,
        overrides: existing.overrides?.length ? existing.overrides : m.overrides,
        effective_permissions: existing.effective_permissions?.length
          ? existing.effective_permissions
          : m.effective_permissions,
      });
    }
    const rows = [...byKey.values()];
    // Non-owners first so Wife/Member toggles appear immediately under the heading
    return rows.sort((a, b) => {
      const ar = String(a.normalized_role || "").toUpperCase() === "OWNER" ? 1 : 0;
      const br = String(b.normalized_role || "").toUpperCase() === "OWNER" ? 1 : 0;
      return ar - br;
    });
  })();

  useEffect(() => {
    setApiBaseDraft(apiBase || "");
  }, [apiBase]);

  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return undefined;
    const mq = window.matchMedia("(max-width: 768px)");
    const apply = () => setPermMobile(mq.matches);
    apply();
    if (mq.addEventListener) mq.addEventListener("change", apply);
    else mq.addListener(apply);
    return () => {
      if (mq.removeEventListener) mq.removeEventListener("change", apply);
      else mq.removeListener(apply);
    };
  }, []);

  useEffect(() => {
    if (settingsTab !== "permissions" && settingsTab !== "security" && settingsTab !== "family") {
      return undefined;
    }
    if (!activeFamily?.id) return undefined;
    const id = window.setTimeout(() => {
      onRefresh?.();
    }, 0);
    return () => window.clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settingsTab, activeFamily?.id]);

  useEffect(() => {
    try {
      const params = new URLSearchParams(window.location.search);
      if (params.get("developer") === "1" || params.get("dev") === "1") {
        localStorage.setItem("s4-developer-mode", "1");
        setDeveloperMode(true);
      }
    } catch {
      /* ignore */
    }
  }, []);

  function saveApiBase() {
    const next = String(apiBaseDraft || "").trim().replace(/\/$/, "");
    if (!next) return;
    onApiBaseChange?.(next);
  }

  async function handlePhotoChange(file) {
    if (!file || !onUploadPhoto || photoUploading) return;
    setPhotoUploading(true);
    try {
      await onUploadPhoto(file);
    } finally {
      setPhotoUploading(false);
    }
  }

  async function handlePhotoRemove() {
    if (!onRemovePhoto || photoRemoving || photoUploading) return;
    setPhotoRemoving(true);
    try {
      await onRemovePhoto();
    } finally {
      setPhotoRemoving(false);
    }
  }

  function toggleDeveloperMode() {
    setDeveloperMode((prev) => {
      const next = !prev;
      try {
        localStorage.setItem("s4-developer-mode", next ? "1" : "0");
      } catch {
        /* ignore */
      }
      return next;
    });
  }

  return (
    <section className="panel settings-panel settings-smart">
      <div className="settings-head">
        <div>
          <p className="settings-kicker">{t("controlCenter")}</p>
          <h2>{t("settings")}</h2>
        </div>
        <button type="button" className="btn" onClick={onRefresh} disabled={settingsLoading}>
          {settingsLoading ? t("loading") : t("refresh")}
        </button>
      </div>

      <div className="settings-tabs" role="tablist">
        {SETTINGS_TABS.map((tab) => (
          <button
            key={tab}
            type="button"
            role="tab"
            aria-selected={settingsTab === tab}
            className={settingsTab === tab ? "settings-tab active" : "settings-tab"}
            onClick={() => setSettingsTab(tab)}
          >
            {t(`settingsTab_${tab}`)}
          </button>
        ))}
      </div>

      {settingsTab === "profile" && (
        <div className="settings-profile">
          <div className="settings-identity profile-header-card keep-identity">
            <div className="profile-header-main">
              <div className={`settings-avatar profile-header-avatar ${avatarUrl ? "has-photo" : ""}`}>
                {avatarUrl ? <img src={avatarUrl} alt="" /> : <span>{initials}</span>}
              </div>
              <div className="settings-identity-copy profile-header-copy">
                <h3>{displayName}</h3>
                <p>{displayEmail}</p>
                <div className="settings-badges">
                  <span className={`settings-badge ${currentUser?.is_active ? "ok" : ""}`}>
                    {currentUser?.is_active ? t("active") : t("unknown")}
                  </span>
                  <span className={`settings-badge ${currentUser?.is_email_verified ? "ok" : "warn"}`}>
                    {currentUser?.is_email_verified ? t("verified") : t("notVerified")}
                  </span>
                  <span className="settings-badge role">{String(role).toUpperCase()}</span>
                </div>
              </div>
            </div>

            <div className="settings-identity-actions profile-header-actions">
              <label
                className={`btn btn-primary settings-upload${photoUploading ? " is-uploading" : ""}`}
                aria-busy={photoUploading}
              >
                {photoUploading ? (
                  <>
                    <span className="CircularProgress" aria-hidden="true" />
                    <span>{t("changePhoto")}…</span>
                  </>
                ) : (
                  t("changePhoto")
                )}
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  hidden
                  disabled={photoUploading || photoRemoving}
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) handlePhotoChange(file);
                    e.target.value = "";
                  }}
                />
              </label>
              {avatarUrl ? (
                <button
                  type="button"
                  className="btn"
                  disabled={photoUploading || photoRemoving}
                  onClick={() => handlePhotoRemove()}
                >
                  {photoRemoving ? (
                    <>
                      <span className="CircularProgress" aria-hidden="true" />
                      {t("removePhoto")}
                    </>
                  ) : (
                    t("removePhoto")
                  )}
                </button>
              ) : null}
              <small>{t("photoHint")}</small>
            </div>
          </div>

          <div className="settings-stat-row profile-stat-grid">
            <div className="settings-stat">
              <span>{t("myRole")}</span>
              <strong>{String(role).toUpperCase()}</strong>
            </div>
            <div className="settings-stat">
              <span>{t("relationship")}</span>
              <strong>{relationship}</strong>
            </div>
            <div className="settings-stat">
              <span>{t("effectivePermissions")}</span>
              <strong>{digits(effectivePermissions.length)}</strong>
            </div>
            <div className="settings-stat">
              <span>{t("overrides")}</span>
              <strong>{digits(permissionOverrides.length)}</strong>
            </div>
          </div>

          <div className="settings-block">
            <div className="settings-block-head">
              <div>
                <h4>{t("languageLock")}</h4>
                <p>{t("languageLockedPrefix")}</p>
              </div>
              <select
                className="language-lock-select"
                aria-label={t("languageLock")}
                value={appLanguage}
                onChange={(e) => changeAppLanguage(e.target.value)}
              >
                {lockedLanguages.map((language) => (
                  <option key={language.code} value={language.code}>
                    {langOptionLabel(language)}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>
      )}

      {settingsTab === "family" && (
        <div className="settings-stack settings-family">
          <div className="family-status-strip" role="status" aria-live="polite">
            <div className="family-status-item">
              <span className="family-status-label">{t("activeFamily")}</span>
              {settingsLoading && !activeFamily?.name ? (
                <span className="family-skel" />
              ) : (
                <strong className="family-status-value">{activeFamily?.name || t("selectedFamily")}</strong>
              )}
            </div>
            <div className="family-status-item">
              <span className="family-status-label">{t("cloudSync") || "Cloud sync"}</span>
              {settingsLoading ? (
                <span className="family-skel family-skel-sm" />
              ) : (
                <strong className={`family-status-pill ${browserOnline ? "is-online" : "is-offline"}`}>
                  {cloudBusy
                    ? t("syncing") || "Syncing…"
                    : browserOnline
                      ? t("connected") || t("browserOnline") || "Connected"
                      : t("offline") || "Offline"}
                </strong>
              )}
            </div>
            <div className="family-status-item">
              <span className="family-status-label">{t("currency")}</span>
              {settingsLoading && !activeFamily?.default_currency && !familyCurrencyForm ? (
                <span className="family-skel family-skel-sm" />
              ) : (
                <strong className="family-status-value">
                  {activeFamily?.default_currency || familyCurrencyForm || "…"}
                </strong>
              )}
            </div>
            <div className="family-status-item">
              <span className="family-status-label">{t("timezone")}</span>
              {settingsLoading && !activeFamily?.timezone && !familyTimezoneForm ? (
                <span className="family-skel family-skel-sm" />
              ) : (
                <strong className="family-status-value family-status-zone">
                  {activeFamily?.timezone || familyTimezoneForm || "…"}
                </strong>
              )}
            </div>
          </div>

          <div className="settings-block family-settings-card">
            <h4>{t("familySettings")}</h4>
            <div className="family-settings-grid">
              <div className="family-field">
                <label className="family-field-label" htmlFor="family-currency-input">
                  {t("currency")}
                </label>
                <input
                  id="family-currency-input"
                  aria-label={t("currency")}
                  maxLength={10}
                  placeholder={t("currency")}
                  value={familyCurrencyForm}
                  onChange={(e) => setFamilyCurrencyForm(e.target.value.toUpperCase())}
                />
                <div className="family-chip-row" role="group" aria-label={t("currency")}>
                  {["BDT", "USD", "EUR", "INR", "SAR", "AED"].map((code) => (
                    <button
                      key={code}
                      type="button"
                      className={familyCurrencyForm === code ? "chip allow" : "chip"}
                      onClick={() => setFamilyCurrencyForm(code)}
                    >
                      {code}
                    </button>
                  ))}
                </div>
              </div>

              <div className="family-field">
                <label className="family-field-label" htmlFor="family-timezone-input">
                  {t("timezone")}
                </label>
                <input
                  id="family-timezone-input"
                  aria-label={t("timezone")}
                  placeholder={t("timezone")}
                  value={familyTimezoneForm}
                  onChange={(e) => setFamilyTimezoneForm(e.target.value)}
                />
                <div className="family-chip-row" role="group" aria-label={t("timezone")}>
                  {["Asia/Dhaka", "Asia/Kolkata", "Asia/Dubai", "UTC"].map((zone) => (
                    <button
                      key={zone}
                      type="button"
                      className={familyTimezoneForm === zone ? "chip allow" : "chip"}
                      onClick={() => setFamilyTimezoneForm(zone)}
                    >
                      {zone}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <p className="settings-help">{t("familySettingsHelp")}</p>

            <div className="family-settings-actions">
              <button
                type="button"
                className="btn btn-primary family-save-btn"
                disabled={settingsSaving}
                onClick={onSaveFamilySettings}
              >
                {settingsSaving ? t("saving") : t("saveFamilySettings")}
              </button>
            </div>
          </div>
          {showApiBaseCard ? (
            <div className="settings-block api-base-card">
              <div className="settings-block-head">
                <div>
                  <h4>{t("apiBaseUrl")}</h4>
                  <p className="budget-hero-sub" style={{ marginTop: 4 }}>
                    {t("apiBaseHelp")}
                  </p>
                </div>
                {isLocalDev ? (
                  <span className="settings-badge role">{developerMode ? "DEV MODE" : "LOCAL DEV"}</span>
                ) : (
                  <span className="settings-badge warn">DEV MODE</span>
                )}
              </div>
              <div className="settings-form-row">
                <input
                  aria-label={t("apiBaseUrl")}
                  placeholder="http://127.0.0.1:8000"
                  value={apiBaseDraft}
                  onChange={(e) => setApiBaseDraft(e.target.value)}
                />
                <button type="button" className="btn btn-primary" onClick={saveApiBase}>
                  {t("saveApiBase")}
                </button>
              </div>
              {isLocalDev && isOwnerOrAdmin ? (
                <button type="button" className="btn" style={{ marginTop: 8 }} onClick={toggleDeveloperMode}>
                  {developerMode ? "Disable developer mode" : "Enable developer mode"}
                </button>
              ) : null}
            </div>
          ) : null}
        </div>
      )}

      {settingsTab === "permissions" && (
        <div className="permissions-panel">
          {settingsLoading && !myPermissions ? (
            <div className="permissions-skeleton" aria-busy="true" aria-live="polite">
              <div className="permissions-skeleton-card" />
              <div className="permissions-skeleton-card" />
              <div className="permissions-skeleton-card" />
              <p className="hint">{t("loading") || "Loading…"}</p>
            </div>
          ) : (
            <>
              <section className="permissions-summary-card panel-subcard">
                <header className="permissions-section-head">
                  <div>
                    <h3>{t("effectivePermissions")}</h3>
                    <p className="hint">
                      {relationship !== "—"
                        ? `${relationship} · ${String(role).toUpperCase()}`
                        : String(role).toUpperCase()}
                    </p>
                  </div>
                  <button type="button" className="btn" disabled={settingsLoading} onClick={() => onRefresh?.()}>
                    {settingsLoading ? t("refreshing") || "…" : t("refresh")}
                  </button>
                </header>

                {!myPermissions ? (
                  <p className="settings-empty">{t("noPermissionSummary")}</p>
                ) : (
                  <div className={`permissions-category-grid${permMobile ? " is-accordion" : ""}`}>
                    {PERMISSION_CATEGORIES.map((cat) => {
                      const level = categoryAccessLevel(effectivePermissions, cat.keys);
                      const badge = accessBadgeMeta(level, t);
                      return (
                        <details
                          key={`${cat.id}-${permMobile ? "m" : "d"}`}
                          className="permissions-category-card permissions-cat-accordion"
                          {...(permMobile ? {} : { open: true })}
                        >
                          <summary className="permissions-category-top permissions-cat-summary">
                            <h4>{t(cat.titleKey) || cat.id}</h4>
                            <span className={`perm-access-badge ${badge.kind}`}>{badge.label}</span>
                          </summary>
                          <ul className="permissions-key-list">
                            {cat.keys.map((key) => {
                              const on = hasPermission(effectivePermissions, key);
                              return (
                                <li key={key} className={on ? "is-on" : "is-off"}>
                                  <span>{friendlyPermissionLabel(key)}</span>
                                  <span className={`perm-dot ${on ? "on" : "off"}`} aria-hidden="true" />
                                </li>
                              );
                            })}
                          </ul>
                        </details>
                      );
                    })}
                  </div>
                )}

                {permissionOverrides.length > 0 ? (
                  <div className="permissions-overrides-strip">
                    <span className="permissions-meta-label">{t("myOverrides")}</span>
                    <div className="override-chips">
                      {permissionOverrides.map((item) => (
                        <span
                          key={item.id || item.permission_key}
                          className={item.allow ? "chip allow" : "chip deny"}
                        >
                          {friendlyPermissionLabel(item.permission_key)}:{" "}
                          {item.allow ? t("allow") : t("deny")}
                        </span>
                      ))}
                    </div>
                  </div>
                ) : null}
              </section>

              <section className="permissions-members-card panel-subcard">
                <header className="permissions-section-head">
                  <div>
                    <h3>{t("familyMemberPermissions")}</h3>
                    <p className="hint">{t("familyMemberPermissionsHint")}</p>
                  </div>
                </header>

                {!isOwnerOrAdmin ? (
                  <p className="settings-empty">{t("ownerOnlyUnavailable")}</p>
                ) : settingsLoading && displayMemberPermissions.length === 0 ? (
                  <div className="permissions-skeleton compact" aria-busy="true">
                    <div className="permissions-skeleton-card" />
                    <div className="permissions-skeleton-card" />
                  </div>
                ) : displayMemberPermissions.length === 0 ? (
                  <p className="settings-empty">{t("noMembersYet") || t("noPermissionSummary")}</p>
                ) : (
                  <div className="permissions-member-list">
                    {displayMemberPermissions.map((member) => {
                      const memberRole = String(
                        member.normalized_role || member.role || "MEMBER",
                      ).toUpperCase();
                      const isOwnerMember = memberRole === "OWNER";
                      const memberId =
                        member.member_id || member.id || member.uid || member.user_id;
                      const saving = permissionSavingMemberId === memberId;
                      const memberName = memberDisplayName(member);
                      const relation = memberRelationshipLabel(member);
                      const roleBadge = formatRoleBadge(memberRole);

                      return (
                        <article className="permissions-member-card" key={memberId}>
                          <div className="permissions-member-head">
                            <div className="permissions-member-identity">
                              <strong>
                                {relation ? `${relation} / ${memberName}` : memberName}
                              </strong>
                              <div className="permissions-member-meta">
                                <span
                                  className={`perm-access-badge ${
                                    memberRole === "OWNER"
                                      ? "ok"
                                      : memberRole === "ADMIN"
                                        ? "info"
                                        : "neutral"
                                  }`}
                                >
                                  {roleBadge}
                                </span>
                                {member.email ? (
                                  <span className="hint">{member.email}</span>
                                ) : null}
                              </div>
                            </div>
                            {isOwnerMember ? (
                              <span className="perm-access-badge ok">
                                {t("ownerPermissionsLocked")}
                              </span>
                            ) : null}
                          </div>

                          {isOwnerMember ? (
                            <p className="hint permissions-owner-locked-note">
                              {t("ownerPermissionsLockedHint") ||
                                "Owner has full access. Permission toggles are locked."}
                            </p>
                          ) : (
                            <>
                              <div className="permissions-category-grid member">
                                {PERMISSION_CATEGORIES.map((cat) => {
                                  const toggleKeys = cat.memberKeys || cat.keys;
                                  const level = categoryAccessLevel(
                                    member.effective_permissions || [],
                                    toggleKeys,
                                  );
                                  const badge = accessBadgeMeta(level, t);
                                  const title =
                                    t(cat.memberTitleKey || cat.titleKey) ||
                                    cat.memberTitleKey ||
                                    cat.id;
                                  return (
                                    <div key={cat.id} className="permissions-category-card compact">
                                      <div className="permissions-category-top">
                                        <h4>{title}</h4>
                                        <span className={`perm-access-badge ${badge.kind}`}>
                                          {badge.label}
                                        </span>
                                      </div>
                                      <ul className="permissions-toggle-list">
                                        {toggleKeys.map((key) => {
                                          const on = hasPermission(
                                            member.effective_permissions || [],
                                            key,
                                          );
                                          return (
                                            <li key={key}>
                                              <span className="permissions-toggle-label">
                                                {friendlyPermissionLabel(key)}
                                              </span>
                                              <label className="perm-switch">
                                                <input
                                                  type="checkbox"
                                                  checked={on}
                                                  disabled={saving || !toggleMemberPermission}
                                                  onChange={(e) =>
                                                    toggleMemberPermission?.(
                                                      {
                                                        ...member,
                                                        member_id: memberId,
                                                      },
                                                      key,
                                                      e.target.checked,
                                                    )
                                                  }
                                                  aria-label={friendlyPermissionLabel(key)}
                                                />
                                                <span className="perm-switch-ui" aria-hidden="true" />
                                              </label>
                                            </li>
                                          );
                                        })}
                                      </ul>
                                    </div>
                                  );
                                })}
                              </div>

                              {(member.overrides || []).length > 0 ? (
                                <div className="override-chips">
                                  {member.overrides.map((item) => (
                                    <span
                                      key={item.id || item.permission_key}
                                      className={item.allow ? "chip allow" : "chip deny"}
                                    >
                                      {friendlyPermissionLabel(item.permission_key)}:{" "}
                                      {item.allow ? t("allow") : t("deny")}
                                    </span>
                                  ))}
                                </div>
                              ) : null}

                              <details className="permissions-advanced">
                                <summary>{t("advancedPermissionAssign") || "Quick assign"}</summary>
                                <div className="settings-form-row compact permissions-advanced-row">
                                  <select
                                    aria-label={t("permissionKey")}
                                    value={permissionForms[memberId]?.permission_key || ""}
                                    onChange={(e) =>
                                      updatePermissionForm(memberId, {
                                        permission_key: e.target.value,
                                      })
                                    }
                                  >
                                    <option value="">{t("selectPermission")}</option>
                                    {commonPermissionKeys.map((permission) => (
                                      <option key={permission} value={permission}>
                                        {friendlyPermissionLabel(permission)}
                                      </option>
                                    ))}
                                  </select>
                                  <select
                                    aria-label={t("permissionAction")}
                                    value={
                                      permissionForms[memberId]?.allow === false
                                        ? "deny"
                                        : "allow"
                                    }
                                    onChange={(e) =>
                                      updatePermissionForm(memberId, {
                                        allow: e.target.value === "allow",
                                      })
                                    }
                                  >
                                    <option value="allow">{t("allow")}</option>
                                    <option value="deny">{t("deny")}</option>
                                  </select>
                                  <button
                                    type="button"
                                    className="btn btn-primary"
                                    disabled={saving}
                                    onClick={() =>
                                      saveMemberPermission({
                                        ...member,
                                        member_id: memberId,
                                      })
                                    }
                                  >
                                    {saving ? t("saving") : t("apply")}
                                  </button>
                                </div>
                              </details>
                            </>
                          )}
                        </article>
                      );
                    })}
                  </div>
                )}
              </section>
            </>
          )}
        </div>
      )}

      {settingsTab === "security" && (
        <div className="security-panel">
          <header className="security-panel-head">
            <div>
              <h3 className="security-panel-title">{t("securityPanelTitle")}</h3>
              <p className="hint security-panel-hint">{t("securityPanelHint")}</p>
            </div>
          </header>

          <div className="security-list" role="list">
            <div className="security-row" role="listitem">
              <div className="security-row-copy">
                <div className="security-row-title">
                  <h4>{t("session")}</h4>
                  <span
                    className={`security-status-badge ${refreshToken ? "ok" : "warn"}`}
                  >
                    {refreshToken ? t("sessionActive") : t("loginRequired")}
                  </span>
                </div>
                <p>{t("refreshSessionHelp")}</p>
              </div>
              <button
                type="button"
                className="btn security-row-action"
                disabled={securityAction === "refresh" || !refreshToken}
                onClick={refreshSession}
              >
                {securityAction === "refresh" ? t("refreshing") : t("refreshSession")}
              </button>
            </div>

            <div className="security-row" role="listitem">
              <div className="security-row-copy">
                <div className="security-row-title">
                  <h4>{t("passwordReset")}</h4>
                  <span className="security-status-badge">{t("securityAvailable")}</span>
                </div>
                <p>{t("passwordResetHelp")}</p>
              </div>
              <button
                type="button"
                className="btn security-row-action"
                disabled={securityAction === "password-reset"}
                onClick={requestPasswordReset}
              >
                {securityAction === "password-reset" ? t("requesting") : t("requestPasswordReset")}
              </button>
            </div>

            <div className="security-row" role="listitem">
              <div className="security-row-copy">
                <div className="security-row-title">
                  <h4>{t("emailVerification")}</h4>
                  <span
                    className={`security-status-badge ${
                      currentUser?.is_email_verified ? "ok" : "warn"
                    }`}
                  >
                    {currentUser?.is_email_verified
                      ? t("verified")
                      : t("pendingVerification")}
                  </span>
                </div>
                <p>
                  {displayEmail}
                  {displayEmail !== "—" ? " · " : ""}
                  {t("emailVerificationHelp")}
                </p>
              </div>
              <button
                type="button"
                className="btn security-row-action"
                disabled={securityAction === "verification" || currentUser?.is_email_verified}
                onClick={() => {
                  Promise.resolve(resendVerification?.()).catch(() => {});
                }}
              >
                {securityAction === "verification"
                  ? t("sending")
                  : currentUser?.is_email_verified
                    ? t("verified")
                    : t("resendVerification")}
              </button>
            </div>

            {/* Soft mail readiness — no SMTP / .env jargon in UI */}
            <div className="security-row security-row-muted" role="listitem">
              <div className="security-row-copy">
                <div className="security-row-title">
                  <h4>{t("emailDelivery")}</h4>
                  <span
                    className={`security-status-badge ${
                      emailStatus?.can_send ? "ok" : "warn"
                    }`}
                  >
                    {emailStatus?.can_send ? t("mailReady") : t("mailUnavailable")}
                  </span>
                </div>
                <p>{t("emailDeliveryHelp")}</p>
              </div>
            </div>
          </div>
        </div>
      )}

      {settingsTab === "cloud" && (
        <CloudBackupPanel
          t={t}
          digits={digits}
          cloudBusy={cloudBusy}
          cloudAutoSync={cloudAutoSync}
          onCloudAutoSyncChange={onCloudAutoSyncChange}
          localFolderSupported={localFolderSupported}
          localFolderLabel={localFolderLabel}
          onPickLocalFolder={onPickLocalFolder}
          onLocalBackup={onLocalBackup}
          onLocalRestore={onLocalRestore}
          onLocalDownload={onLocalDownload}
          driveConfigured={driveConfigured}
          driveConnected={driveConnected}
          driveFiles={driveFiles}
          onDriveConnect={onDriveConnect}
          onDriveDisconnect={onDriveDisconnect}
          onDriveUpload={onDriveUpload}
          onDriveRestore={onDriveRestore}
          firebaseConfigured={firebaseConfigured}
          firebaseUser={firebaseUser}
          firebaseMeta={firebaseMeta}
          onFirebaseGoogleSignIn={onFirebaseGoogleSignIn}
          onFirebaseEmailSignIn={onFirebaseEmailSignIn}
          onFirebaseEmailRegister={onFirebaseEmailRegister}
          onFirebaseSignOut={onFirebaseSignOut}
          onFirebaseSyncNow={onFirebaseSyncNow}
          onFirebaseRestore={onFirebaseRestore}
        />
      )}
    </section>
  );
}
