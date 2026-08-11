import { useState } from "react";

const NOTIFY_TABS = ["inbox", "delivery", "devices"];

const TITLE_BN = {
  BUDGET_OVER: "বাজেট অতিক্রম",
  BUDGET_WARNING: "বাজেট সতর্কতা",
  RECURRING_DUE: "পুনরাবৃত্ত লেনদেন বাকি",
  LOAN_ACTIVE: "ঋণ বাকি সতর্কতা",
  LOAN_INSTALLMENT_DUE: "ঋণ কিস্তি বাকি",
  INVESTMENT_MATURITY: "বিনিয়োগ মেয়াদ",
  VEHICLE_SERVICE_DUE: "যানবাহন সার্ভিস",
  SUBSCRIPTION_RENEWAL: "সাবস্ক্রিপশন নবায়ন",
  DOCUMENT_EXPIRY: "ডকুমেন্ট মেয়াদ",
  SAVINGS_LOW_PROGRESS: "সঞ্চয় অগ্রগতি কম",
  SAVINGS_TARGET_DONE: "সঞ্চয় লক্ষ্য পূরণ",
};

function shortTime(value, digits, t) {
  if (!value) return t("noDate");
  const cleaned = String(value).replace("T", " ").replace(/\.\d+.*/, "");
  return digits(cleaned);
}

function severityClass(severity) {
  const s = String(severity || "").toUpperCase();
  if (s === "HIGH" || s === "CRITICAL") return "warn";
  if (s === "MEDIUM") return "role";
  return "ok";
}

function pickLocalized(text, appLanguage) {
  if (!text) return "—";
  const parts = String(text)
    .split(/\s*\|\s*/)
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length < 2) return String(text);
  return appLanguage === "bn" ? parts[1] || parts[0] : parts[0] || parts[1];
}

function notificationTitle(item, appLanguage) {
  const fromPipe = pickLocalized(item.title, appLanguage);
  if (fromPipe && fromPipe !== "—" && String(item.title || "").includes("|")) {
    return fromPipe;
  }
  if (appLanguage === "bn") {
    const bn = TITLE_BN[item.notification_type];
    if (bn) return bn;
  }
  return item.title || item.notification_type || "—";
}

export function NotificationsPanel({
  t,
  digits,
  appLanguage = "en",
  notifications = [],
  notificationSummary,
  notificationDelivery,
  notificationsLoading,
  pushDevices = [],
  pushTokenDraft = "",
  setPushTokenDraft,
  pushPlatform = "WEB",
  setPushPlatform,
  onRefresh,
  onScan,
  onMarkAllRead,
  onMarkRead,
  onDelete,
  onTestEmail,
  onRegisterDevice,
  onUnregisterDevice,
  onTestPush,
}) {
  const [notifyTab, setNotifyTab] = useState("inbox");

  const total = Number(notificationSummary?.total_notifications || 0);
  const unread = Number(notificationSummary?.unread_notifications || 0);
  const high = Number(notificationSummary?.high_notifications || 0);
  const medium = Number(notificationSummary?.medium_notifications || 0);
  const templates = notificationDelivery?.templates || [];
  const fcmOn = Boolean(notificationDelivery?.fcm_configured);
  const emailOn = Boolean(notificationDelivery?.email_configured);
  const smtpHost = notificationDelivery?.smtp?.configured
    ? notificationDelivery.smtp.host
    : null;
  const deliveryMode = notificationDelivery?.delivery_mode || "IN_APP_ONLY";
  const fcmNote = notificationDelivery?.fcm?.note || notificationDelivery?.smtp?.note;

  return (
    <section className="panel settings-panel settings-smart notify-smart">
      <div className="settings-head">
        <div>
          <p className="settings-kicker">{t("deliveryMode")}</p>
          <h2>{t("notifications")}</h2>
        </div>
        <button type="button" className="btn" disabled={notificationsLoading} onClick={onRefresh}>
          {notificationsLoading ? t("loading") : t("refreshNotifications")}
        </button>
      </div>

      <div className="settings-tabs" role="tablist">
        {NOTIFY_TABS.map((tab) => (
          <button
            key={tab}
            type="button"
            role="tab"
            aria-selected={notifyTab === tab}
            className={notifyTab === tab ? "settings-tab active" : "settings-tab"}
            onClick={() => setNotifyTab(tab)}
          >
            {t(`notifyTab_${tab}`) || tab}
          </button>
        ))}
      </div>

      <div className="settings-identity notify-identity">
        <div className={`sync-health ${unread ? "warn" : "ok"}`}>
          <strong>{digits(unread)}</strong>
          <span>{t("unread")}</span>
        </div>
        <div className="settings-identity-copy">
          <h3>
            {digits(total)} {t("totalNotifications")}
          </h3>
          <p>
            {deliveryMode}
            {templates.length ? ` · ${digits(templates.length)} ${t("templates")}` : ""}
          </p>
          <div className="settings-badges">
            <span className={`settings-badge ${fcmOn ? "ok" : "warn"}`}>
              {fcmOn ? t("fcmOn") : t("fcmOff")}
            </span>
            <span className={`settings-badge ${emailOn ? "ok" : "warn"}`}>
              Email: {emailOn ? "ON" : "OFF"}
              {smtpHost ? ` · ${smtpHost}` : ` · ${t("smtpOff")}`}
            </span>
            <span className={`settings-badge ${high ? "warn" : "ok"}`}>
              {t("highSeverity")}: {digits(high)}
            </span>
            <span className={`settings-badge ${pushDevices.length ? "ok" : "warn"}`}>
              {t("pushDevices") || "Devices"}: {digits(pushDevices.length)}
            </span>
          </div>
        </div>
      </div>

      <div className="settings-stat-row">
        <div className="settings-stat">
          <span>{t("totalNotifications")}</span>
          <strong>{digits(total)}</strong>
        </div>
        <div className="settings-stat">
          <span>{t("unread")}</span>
          <strong>{digits(unread)}</strong>
        </div>
        <div className="settings-stat">
          <span>{t("highSeverity")}</span>
          <strong>{digits(high)}</strong>
        </div>
        <div className="settings-stat">
          <span>{t("mediumSeverity")}</span>
          <strong>{digits(medium)}</strong>
        </div>
      </div>

      {notifyTab === "inbox" ? (
        <div className="settings-stack">
          <div className="settings-block">
            <div className="settings-block-head">
              <div>
                <h4>{t("notifyTab_inbox")}</h4>
                <p>
                  {digits(unread)} {t("unread")} · {digits(total)} {t("totalNotifications")}
                </p>
              </div>
              <div className="notify-actions">
                <button type="button" className="btn" disabled={notificationsLoading} onClick={onScan}>
                  {notificationsLoading ? t("loading") : t("scanNotifications")}
                </button>
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={notificationsLoading || !unread}
                  onClick={onMarkAllRead}
                >
                  {t("markAllRead")}
                </button>
              </div>
            </div>

            {notificationsLoading ? (
              <p className="settings-empty">{t("loading")}</p>
            ) : notifications.length === 0 ? (
              <p className="settings-empty">{t("noNotificationsFound")}</p>
            ) : (
              <div className="notify-feed">
                {notifications.map((item) => (
                  <div className={`notify-card ${item.is_read ? "is-read" : "is-unread"}`} key={item.id}>
                    <div className="notify-card-main">
                      <div className="audit-feed-tags">
                        <span className="settings-badge role">{item.notification_type || "ALERT"}</span>
                        <span className={`settings-badge ${severityClass(item.severity)}`}>
                          {item.severity || "INFO"}
                        </span>
                        <span className={`settings-badge ${item.is_read ? "ok" : "warn"}`}>
                          {item.is_read ? t("statusRead") : t("statusUnread")}
                        </span>
                      </div>
                      <strong>{notificationTitle(item, appLanguage)}</strong>
                      <p>{pickLocalized(item.message, appLanguage)}</p>
                      <time>{shortTime(item.created_at, digits, t)}</time>
                    </div>
                    <div className="notify-card-actions">
                      {!item.is_read ? (
                        <button type="button" className="btn" onClick={() => onMarkRead(item.id)}>
                          {t("read")}
                        </button>
                      ) : null}
                      <button type="button" className="btn" onClick={() => onDelete(item.id)}>
                        {t("delete")}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      ) : null}

      {notifyTab === "delivery" ? (
        <div className="settings-stack">
          <div className="settings-block">
            <div className="settings-block-head">
              <div>
                <h4>{t("deliveryMode")}</h4>
                <p>
                  {deliveryMode} · FCM {fcmOn ? "ON" : "OFF"} · Email {emailOn ? "ON" : "OFF"}
                </p>
              </div>
              <div className="notify-actions">
                <button type="button" className="btn btn-primary" disabled={notificationsLoading} onClick={onTestEmail}>
                  {t("testNotificationEmail")}
                </button>
              </div>
            </div>

            {fcmNote ? <p className="settings-help">{String(fcmNote)}</p> : null}
            {notificationDelivery?.pipeline?.architecture_status ? (
              <p className="budget-hero-sub">
                Delivery pipeline: {notificationDelivery.pipeline.architecture_status}
                {notificationDelivery.pipeline.email_outbox ? " · email outbox" : ""}
                {notificationDelivery.pipeline.push_outbox ? " · push outbox" : ""}
              </p>
            ) : null}

            {templates.length === 0 ? (
              <p className="settings-empty">{t("templates")}: 0</p>
            ) : (
              <div className="settings-perm-grid sync-count-grid" style={{ marginTop: 12 }}>
                {templates.map((name) => (
                  <div className="sync-count-chip" key={name}>
                    <span>{name}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      ) : null}

      {notifyTab === "devices" ? (
        <div className="settings-stack">
          <div className="settings-block">
            <div className="settings-block-head">
              <div>
                <h4>{t("registerPushDevice") || "Register push device"}</h4>
                <p>
                  FCM {fcmOn ? "ON" : "OFF"} · {digits(pushDevices.length)}{" "}
                  {t("pushDevices") || "devices"}
                </p>
              </div>
              <div className="notify-actions">
                <button type="button" className="btn" disabled={notificationsLoading} onClick={onTestPush}>
                  {t("sendTestPush") || "Send test push"}
                </button>
              </div>
            </div>

            <div className="settings-badges" style={{ marginBottom: 12 }}>
              {["WEB", "ANDROID", "IOS"].map((item) => (
                <button
                  key={item}
                  type="button"
                  className={`settings-badge ${pushPlatform === item ? "ok" : "role"}`}
                  disabled={notificationsLoading}
                  onClick={() => setPushPlatform?.(item)}
                >
                  {item}
                </button>
              ))}
            </div>

            <div className="finance-form">
              <input
                placeholder={t("pastePushToken") || "Paste FCM / Expo push token"}
                value={pushTokenDraft}
                disabled={notificationsLoading}
                onChange={(e) => setPushTokenDraft?.(e.target.value)}
              />
              <button
                type="button"
                className="btn btn-primary"
                disabled={notificationsLoading || !onRegisterDevice}
                onClick={onRegisterDevice}
              >
                {t("registerDevice") || "Register device"}
              </button>
            </div>
          </div>

          <div className="settings-block">
            <h4>{t("pushDevices") || "Registered devices"}</h4>
            {pushDevices.length === 0 ? (
              <p className="settings-empty">{t("noPushDevices") || "No devices registered"}</p>
            ) : (
              <div className="notify-feed">
                {pushDevices.map((device) => (
                  <div className="notify-card is-read" key={device.id}>
                    <div className="notify-card-main">
                      <div className="audit-feed-tags">
                        <span className="settings-badge role">{device.platform || "WEB"}</span>
                        <span className="settings-badge ok">{device.provider || "FCM"}</span>
                      </div>
                      <strong>{device.device_label || device.platform || "Device"}</strong>
                      <p>{device.token_preview || device.id}</p>
                    </div>
                    <div className="notify-card-actions">
                      <button
                        type="button"
                        className="btn"
                        disabled={notificationsLoading}
                        onClick={() => onUnregisterDevice?.(device.id)}
                      >
                        {t("unregisterDevice") || "Unregister"}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      ) : null}
    </section>
  );
}
