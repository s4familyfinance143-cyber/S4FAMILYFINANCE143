import { useEffect, useRef } from "react";

function shortTime(value) {
  if (!value) return "";
  return String(value).replace("T", " ").replace(/\.\d+.*/, "").slice(0, 16);
}

/**
 * Compact in-app notification dropdown for the header bell.
 * Always available even when browser push is blocked.
 */
export function NotificationBellDropdown({
  open,
  onClose,
  notifications = [],
  loading = false,
  permission = "default",
  permissionHint = "",
  onEnablePush,
  onOpenFull,
  onMarkRead,
  onMarkAllRead,
  onRefresh,
  t,
}) {
  const panelRef = useRef(null);
  const unread = notifications.filter((n) => !n.read && !n.is_read);
  const rows = (unread.length ? unread : notifications).slice(0, 8);

  useEffect(() => {
    if (!open) return undefined;
    function onDoc(e) {
      if (panelRef.current && !panelRef.current.contains(e.target)) onClose?.();
    }
    function onKey(e) {
      if (e.key === "Escape") onClose?.();
    }
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, onClose]);

  if (!open) return null;

  const denied = permission === "denied";
  const needsGrant = permission === "default" || permission === "unsupported";

  return (
    <div className="notify-bell-dropdown" ref={panelRef} role="dialog" aria-label={t("notifications")}>
      <div className="notify-bell-head">
        <strong>{t("notifications")}</strong>
        <div className="notify-bell-head-actions">
          <button type="button" className="btn notify-bell-mini" onClick={onRefresh} disabled={loading}>
            {loading ? "…" : t("refreshNotifications") || "Refresh"}
          </button>
          <button type="button" className="btn notify-bell-mini" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
      </div>

      {(denied || needsGrant || permissionHint) && (
        <div className={`notify-bell-hint ${denied ? "is-warn" : ""}`}>
          {denied ? (
            <p>
              {t("notifyPermissionDenied") ||
                "Browser notifications are blocked. Allow them in site settings, then retry."}
            </p>
          ) : needsGrant ? (
            <p>
              {t("notifyPermissionPrompt") ||
                "Enable browser alerts to get push updates. In-app alerts still work below."}
            </p>
          ) : (
            <p>{permissionHint}</p>
          )}
          {!denied && (
            <button type="button" className="btn btn-primary notify-bell-enable" onClick={onEnablePush}>
              {t("enableBrowserNotifications") || "Enable browser notifications"}
            </button>
          )}
        </div>
      )}

      <div className="notify-bell-list">
        {loading && rows.length === 0 ? (
          <p className="notify-bell-empty">{t("loading")}</p>
        ) : rows.length === 0 ? (
          <p className="notify-bell-empty">{t("noNotificationsFound") || "No notifications yet"}</p>
        ) : (
          rows.map((item) => {
            const isUnread = !item.read && !item.is_read;
            return (
              <button
                key={item.id}
                type="button"
                className={`notify-bell-item ${isUnread ? "is-unread" : ""}`}
                onClick={() => onMarkRead?.(item.id)}
              >
                <span className="notify-bell-item-title">{item.title || item.notification_type || "Alert"}</span>
                <span className="notify-bell-item-body">{item.body || item.message || ""}</span>
                <span className="notify-bell-item-meta">{shortTime(item.created_at)}</span>
              </button>
            );
          })
        )}
      </div>

      <div className="notify-bell-foot">
        {unread.length > 0 ? (
          <button type="button" className="btn notify-bell-mini" onClick={onMarkAllRead}>
            {t("markAllRead") || "Mark all read"}
          </button>
        ) : (
          <span />
        )}
        <button
          type="button"
          className="btn btn-primary notify-bell-mini"
          onClick={() => {
            onOpenFull?.();
            onClose?.();
          }}
        >
          {t("viewAllNotifications") || "View all"}
        </button>
      </div>
    </div>
  );
}
