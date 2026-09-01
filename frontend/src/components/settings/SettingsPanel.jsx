import { useEffect, useState } from "react";
import { CloudBackupPanel } from "./CloudBackupPanel";

const SETTINGS_TABS = ["profile", "family", "permissions", "security", "cloud"];

function langOptionLabel(language) {
  if (language.nativeName === language.name) return language.nativeName;
  return `${language.nativeName} (${language.name})`;
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
  permissionForms,
  updatePermissionForm,
  saveMemberPermission,
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
}) {
  const displayName = currentUser?.full_name || currentUser?.email || email || "—";
  const displayEmail = currentUser?.email || email || "—";
  const role = myPermissions?.normalized_role || myPermissions?.role || "—";
  const relationship = myPermissions?.relationship || "—";
  const initials = String(displayName).trim().slice(0, 2).toUpperCase();
  const [apiBaseDraft, setApiBaseDraft] = useState(apiBase || "");

  useEffect(() => {
    setApiBaseDraft(apiBase || "");
  }, [apiBase]);

  function saveApiBase() {
    const next = String(apiBaseDraft || "").trim().replace(/\/$/, "");
    if (!next) return;
    onApiBaseChange?.(next);
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
          <div className="settings-identity">
            <div className={`settings-avatar ${avatarUrl ? "has-photo" : ""}`}>
              {avatarUrl ? <img src={avatarUrl} alt="" /> : <span>{initials}</span>}
            </div>
            <div className="settings-identity-copy">
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
            <div className="settings-identity-actions">
              <label className="btn btn-primary settings-upload">
                {t("changePhoto")}
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  hidden
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) onUploadPhoto?.(file);
                    e.target.value = "";
                  }}
                />
              </label>
              {avatarUrl ? (
                <button type="button" className="btn" onClick={() => onRemovePhoto?.()}>
                  {t("removePhoto")}
                </button>
              ) : null}
              <small>{t("photoHint")}</small>
            </div>
          </div>

          <div className="settings-stat-row">
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
        <div className="settings-stack">
          <div className="settings-block">
            <div className="settings-block-head">
              <div>
                <h4>{t("activeFamily")}</h4>
                <p>
                  {activeFamily?.name || t("selectedFamily")} · {activeFamily?.default_currency || "—"} ·{" "}
                  {activeFamily?.timezone || "—"}
                </p>
              </div>
            </div>
          </div>
          <div className="settings-block">
            <h4>{t("familySettings")}</h4>
            <div className="settings-form-row">
              <input
                aria-label={t("currency")}
                maxLength={10}
                placeholder={t("currency")}
                value={familyCurrencyForm}
                onChange={(e) => setFamilyCurrencyForm(e.target.value.toUpperCase())}
              />
              <input
                aria-label={t("timezone")}
                placeholder={t("timezone")}
                value={familyTimezoneForm}
                onChange={(e) => setFamilyTimezoneForm(e.target.value)}
              />
              <button type="button" className="btn btn-primary" disabled={settingsSaving} onClick={onSaveFamilySettings}>
                {settingsSaving ? t("saving") : t("saveFamilySettings")}
              </button>
            </div>
            <div className="override-chips">
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
            <div className="override-chips">
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
            <p className="settings-help">{t("familySettingsHelp")}</p>
          </div>
          <div className="settings-block">
            <h4>{t("apiBaseUrl")}</h4>
            <p className="budget-hero-sub" style={{ marginTop: 4 }}>
              {t("apiBaseHelp")}
            </p>
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
          </div>
        </div>
      )}

      {settingsTab === "permissions" && (
        <div className="settings-stack">
          <div className="settings-block">
            <h4>{t("effectivePermissions")}</h4>
            {effectivePermissions.length === 0 ? (
              <p className="settings-empty">{t("noPermissionSummary")}</p>
            ) : (
              <div className="settings-perm-grid">
                {effectivePermissions.map((permission) => (
                  <div className="settings-perm-chip" key={permission}>
                    {permission}
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="settings-block">
            <h4>{t("myOverrides")}</h4>
            {permissionOverrides.length === 0 ? (
              <p className="settings-empty">{t("noOverrides")}</p>
            ) : (
              <div className="table">
                {permissionOverrides.map((item) => (
                  <div className="row" key={item.id || item.permission_key}>
                    <span>{item.permission_key}</span>
                    <strong className={item.allow ? "perm-allow" : "perm-deny"}>
                      {item.allow ? t("allow") : t("deny")}
                    </strong>
                    <span>{item.scope || "family"}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="settings-block">
            <h4>{t("familyMemberPermissions")}</h4>
            {String(role).toUpperCase() !== "OWNER" ? (
              <p className="settings-empty">{t("ownerOnlyUnavailable")}</p>
            ) : memberPermissions.length === 0 ? (
              <p className="settings-empty">{t("noPermissionSummary")}</p>
            ) : (
              <div className="table">
                {memberPermissions.map((member) => (
                  <div className="member-perm-block" key={member.member_id}>
                    <div className="row">
                      <span>{member.relationship || member.user_id}</span>
                      <span>{member.normalized_role || member.role}</span>
                      <strong>
                        {digits(member.effective_permissions?.length || 0)} {t("effectivePermissions")}
                      </strong>
                      {member.normalized_role === "OWNER" ? (
                        <span>{t("ownerPermissionsLocked")}</span>
                      ) : (
                        <div className="settings-form-row compact">
                          <select
                            aria-label={t("permissionKey")}
                            value={permissionForms[member.member_id]?.permission_key || ""}
                            onChange={(e) =>
                              updatePermissionForm(member.member_id, {
                                permission_key: e.target.value,
                              })
                            }
                          >
                            <option value="">{t("selectPermission")}</option>
                            {commonPermissionKeys.map((permission) => (
                              <option key={permission} value={permission}>
                                {permission}
                              </option>
                            ))}
                          </select>
                          <select
                            aria-label={t("permissionAction")}
                            value={permissionForms[member.member_id]?.allow === false ? "deny" : "allow"}
                            onChange={(e) =>
                              updatePermissionForm(member.member_id, {
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
                            disabled={permissionSavingMemberId === member.member_id}
                            onClick={() => saveMemberPermission(member)}
                          >
                            {permissionSavingMemberId === member.member_id ? t("saving") : t("apply")}
                          </button>
                        </div>
                      )}
                    </div>
                    {(member.overrides || []).length > 0 ? (
                      <div className="override-chips">
                        {member.overrides.map((item) => (
                          <span key={item.id || item.permission_key} className={item.allow ? "chip allow" : "chip deny"}>
                            {item.permission_key}: {item.allow ? t("allow") : t("deny")}
                          </span>
                        ))}
                      </div>
                    ) : null}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {settingsTab === "security" && (
        <div className="settings-stat-row security-grid">
          <div className="settings-block">
            <span className="settings-label">{t("emailDelivery")}</span>
            <strong>{emailStatus?.can_send ? t("smtpReady") : t("smtpNotConfigured")}</strong>
            <p>{emailStatus?.note || t("smtpHelp")}</p>
            {emailStatus?.smtp?.host ? (
              <small>
                {emailStatus.smtp.host}:{emailStatus.smtp.port} · {emailStatus.smtp.from_email || "-"}
              </small>
            ) : null}
          </div>
          <div className="settings-block">
            <span className="settings-label">{t("session")}</span>
            <strong>{refreshToken ? t("refreshReady") : t("loginRequired")}</strong>
            <p>{t("refreshSessionHelp")}</p>
            <button
              type="button"
              className="btn"
              disabled={securityAction === "refresh" || !refreshToken}
              onClick={refreshSession}
            >
              {securityAction === "refresh" ? t("refreshing") : t("refreshSession")}
            </button>
          </div>
          <div className="settings-block">
            <span className="settings-label">{t("password")}</span>
            <strong>{t("passwordReset")}</strong>
            <p>{t("passwordResetHelp")}</p>
            <button
              type="button"
              className="btn"
              disabled={securityAction === "password-reset"}
              onClick={requestPasswordReset}
            >
              {securityAction === "password-reset" ? t("requesting") : t("requestPasswordReset")}
            </button>
          </div>
          <div className="settings-block">
            <span className="settings-label">{t("emailVerification")}</span>
            <strong>{currentUser?.is_email_verified ? t("verified") : t("notVerified")}</strong>
            <p>{displayEmail}</p>
            <button
              type="button"
              className="btn"
              disabled={securityAction === "verification" || currentUser?.is_email_verified}
              onClick={resendVerification}
            >
              {securityAction === "verification" ? t("sending") : t("resendVerification")}
            </button>
          </div>
        </div>
      )}

      {settingsTab === "cloud" && (
        <CloudBackupPanel
          t={t}
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
