import { useState } from "react";

const NOTIFY_TABS = ["inbox", "delivery"];

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
  INVITE: "আমন্ত্রণ কোড",
  FAMILY: "পরিবার",
};

function extractInviteCode(item) {
  if (item?.invite_code) return String(item.invite_code).trim();
  const blob = `${item?.body || ""} ${item?.message || ""} ${item?.title || ""}`;
  const match = blob.match(/S4-[A-Z0-9]{4,12}/i);
  return match ? match[0].toUpperCase() : "";
}

/** Every notification comes from the VPS server, so invite codes in it are real. */
function isShareableInviteNotification(item) {
  return Boolean(item);
}

function shortTime(value, digits, t) {
  if (!value) return t("noDate");
  try {
    const d = new Date(value);
    if (!Number.isNaN(d.getTime())) {
      const pad = (n) => String(n).padStart(2, "0");
      const local = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
      return digits(local);
    }
  } catch {
    /* fall through */
  }
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
  onRefresh,
  onScan,
  onMarkAllRead,
  onMarkRead,
  onDelete,
  onTestEmail,
  onEnableBrowserPush,
}) {
  const [notifyTab, setNotifyTab] = useState("inbox");

  const total = Number(notificationSummary?.total_notifications || 0);
  const unread = Number(notificationSummary?.unread_notifications || 0);
  const high = Number(notificationSummary?.high_notifications || 0);
  const medium = Number(notificationSummary?.medium_notifications || 0);
  const templates = notificationDelivery?.templates || [];
  // Browser-native notifications for live VPS events (no push service).
  const browserOn = String(notificationDelivery?.browser_permission || "").toLowerCase() === "granted";
  const emailOn = Boolean(notificationDelivery?.email_configured);
  const smtpHost = notificationDelivery?.smtp?.configured
    ? notificationDelivery.smtp.host
    : null;
  const deliveryMode = notificationDelivery?.delivery_mode || "IN_APP_ONLY";
  const smtpNote = notificationDelivery?.smtp?.note;

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
            <span className={`settings-badge ${browserOn ? "ok" : "warn"}`}>
              Browser: {browserOn ? "ON" : "OFF"}
            </span>
            <span className={`settings-badge ${emailOn ? "ok" : "warn"}`}>
              Email: {emailOn ? "ON" : "OFF"}
              {smtpHost ? ` · ${smtpHost}` : ` · ${t("smtpOff")}`}
            </span>
            <span className={`settings-badge ${high ? "warn" : "ok"}`}>
              {t("highSeverity")}: {digits(high)}
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
                {notifications.filter(isShareableInviteNotification).map((item) => {
                  const inviteCode = extractInviteCode(item);
                  const isInvite =
                    String(item.notification_type || item.type || "").toUpperCase() === "INVITE" ||
                    Boolean(inviteCode);
                  return (
                  <div className={`notify-card ${item.is_read ? "is-read" : "is-unread"} ${isInvite ? "is-invite" : ""}`} key={item.id}>
                    <div className="notify-card-main">
                      <div className="audit-feed-tags">
                        <span className="settings-badge role">
                          {isInvite ? "INVITE" : item.notification_type || "ALERT"}
                        </span>
                        <span className={`settings-badge ${severityClass(item.severity)}`}>
                          {item.severity || "INFO"}
                        </span>
                        <span className={`settings-badge ${item.is_read ? "ok" : "warn"}`}>
                          {item.is_read ? t("statusRead") : t("statusUnread")}
                        </span>
                      </div>
                      <strong>{isInvite ? (t("latestInviteCode") || notificationTitle(item, appLanguage)) : notificationTitle(item, appLanguage)}</strong>
                      {inviteCode ? (
                        <>
                          <p className="notify-invite-code">{inviteCode}</p>
                          <p className="notify-invite-hint">
                            {t("inviteNotifyHint") ||
                              "Share only the newest code from Family → Invite. Older notification codes may already be expired."}
                          </p>
                        </>
                      ) : (
                        <p>{pickLocalized(item.message || item.body, appLanguage)}</p>
                      )}
                      <time>{shortTime(item.created_at, digits, t)}</time>
                    </div>
                    <div className="notify-card-actions">
                      {inviteCode ? (
                        <button
                          type="button"
                          className="btn btn-primary"
                          onClick={async () => {
                            try {
                              await navigator.clipboard.writeText(inviteCode);
                            } catch {
                              /* ignore */
                            }
                          }}
                        >
                          Copy
                        </button>
                      ) : null}
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
                  );
                })}
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
                  {deliveryMode} · Browser {browserOn ? "ON" : "OFF"} · Email {emailOn ? "ON" : "OFF"}
                </p>
              </div>
              <div className="notify-actions">
                <button type="button" className="btn btn-primary" disabled={notificationsLoading} onClick={onTestEmail}>
                  {t("testNotificationEmail")}
                </button>
                <button type="button" className="btn" disabled={notificationsLoading || browserOn} onClick={onEnableBrowserPush}>
                  {t("enableBrowserNotifications") || "Enable browser notifications"}
                </button>
              </div>
            </div>

            {smtpNote ? <p className="settings-help">{String(smtpNote)}</p> : null}
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

    </section>
  );
}
