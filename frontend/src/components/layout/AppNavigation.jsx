import { useEffect, useMemo, useRef, useState } from "react";

import { BRAND_LOGO_SRC } from "../../lib/brandAssets";
import { isNavItemActive } from "../../lib/navMenu";
import { NotificationBellDropdown } from "../notifications/NotificationBellDropdown";

function closeMobileDrawer() {
  document.body.classList.remove("mobile-drawer-open");
}

export function DesktopSidebar({
  navGroups,
  navItems,
  activeMenu,
  setActiveMenu,
  digits,
  t,
  email,
  currentUser,
  _avatarUrl = "",
  families = [],
  activeFamilyId,
  changeActiveFamily,
  familiesLoading,
  onLogout,
}) {
  const groups = useMemo(() => {
    if (Array.isArray(navGroups) && navGroups.length) return navGroups;
    return [
      {
        label: "",
        items: (navItems || []).map(([menu, label, icon]) => [menu, icon || "•", label]),
      },
    ];
  }, [navGroups, navItems]);

  const activeGroupLabel = useMemo(() => {
    for (const group of groups) {
      if ((group.items || []).some((item) => isNavItemActive(activeMenu, item[0]))) return group.label || "";
    }
    return groups[0]?.label || "";
  }, [groups, activeMenu]);

  const [openGroups, setOpenGroups] = useState(() => new Set([activeGroupLabel].filter(Boolean)));

  useEffect(() => {
    if (!activeGroupLabel) return;
    setOpenGroups((prev) => {
      if (prev.has(activeGroupLabel)) return prev;
      const next = new Set(prev);
      next.add(activeGroupLabel);
      return next;
    });
  }, [activeGroupLabel]);

  function toggleGroup(label) {
    if (!label) return;
    setOpenGroups((prev) => {
      const next = new Set(prev);
      if (next.has(label)) next.delete(label);
      else next.add(label);
      return next;
    });
  }

  function go(menu) {
    setActiveMenu(menu);
    closeMobileDrawer();
  }

  return (
    <>
      <button
        type="button"
        className="sidebar-scrim"
        aria-label={t("close")}
        onClick={closeMobileDrawer}
      />
      <aside className="sidebar arch-shell-sidebar">
        <div className="brand">
          <button
            type="button"
            className="brand-mark has-photo brand-mark--logo"
            onClick={() => go("settings")}
            title={t("settings")}
          >
            <img src={BRAND_LOGO_SRC} alt="S4 Family Finance" className="brand-avatar-img" />
          </button>
          <div>
            <div className="brand-title">{digits("S4 FAMILY 143")}</div>
            <div className="brand-sub">{currentUser?.full_name || t("brandTagline")}</div>
          </div>
        </div>

        <div className="sidebar-scroll">
          {groups.map((group) => {
            const label = group.label || "";
            const isOpen = !label || openGroups.has(label);
            const items = group.items || [];
            const groupActive = items.some((item) => isNavItemActive(activeMenu, item[0]));

            return (
              <div
                className={`nav-group ${isOpen ? "is-open" : "is-collapsed"} ${groupActive ? "has-active" : ""}`}
                key={label || "main"}
              >
                {label ? (
                  <button
                    type="button"
                    className="nav-label-btn"
                    onClick={() => toggleGroup(label)}
                    aria-expanded={isOpen}
                  >
                    <span className="nav-label-text">{label}</span>
                    <span className="nav-label-chevron" aria-hidden="true">
                      {isOpen ? "▾" : "▸"}
                    </span>
                  </button>
                ) : null}

                {isOpen
                  ? items.map((item) => {
                      const [menu, icon, itemLabel, badge] = item;
                      return (
                        <button
                          key={`${menu}-${itemLabel}`}
                          type="button"
                          className={`nav-item ${isNavItemActive(activeMenu, menu) ? "active" : ""}`}
                          onClick={() => go(menu)}
                          aria-current={isNavItemActive(activeMenu, menu) ? "page" : undefined}
                        >
                          <span className="nav-icon" aria-hidden="true">
                            {icon}
                          </span>
                          <span className="nav-text">{itemLabel}</span>
                          {badge ? <span className="nav-badge">{badge}</span> : null}
                        </button>
                      );
                    })
                  : null}
              </div>
            );
          })}
        </div>

        <div className="profile">
          <div className="profile-meta profile-meta-only">
            <div className="profile-name">{currentUser?.full_name || email || "S4 Family Owner"}</div>
            {families.length > 1 ? (
              <select
                className="profile-family"
                aria-label={t("activeFamily")}
                disabled={familiesLoading}
                value={activeFamilyId}
                onChange={(e) => changeActiveFamily?.(e.target.value)}
              >
                {families.map((family) => (
                  <option key={family.id} value={family.id}>
                    {family.name}
                  </option>
                ))}
              </select>
            ) : (
              <div className="profile-role">{t("ownerFullAccess")}</div>
            )}
            <button type="button" className="sidebar-logout" onClick={() => onLogout?.()}>
              {t("logout")}
            </button>
          </div>
          <button
            type="button"
            className="icon-btn"
            onClick={() => go("settings")}
            title={t("settings")}
          >
            ⚙
          </button>
        </div>
      </aside>
    </>
  );
}

export function TopHeader({
  appLanguage,
  activeMenu = "dashboard",
  setActiveMenu,
  changeAppLanguage,
  t,
  lockedLanguages,
  unreadCount = 0,
  notifications = [],
  notificationsLoading = false,
  notifyPermission = "default",
  notifyPermissionHint = "",
  notifyDropdownOpen = false,
  setNotifyDropdownOpen,
  onEnablePush,
  onRefreshNotifications,
  onMarkNotificationRead,
  onMarkAllNotificationsRead,
  onLogout,
  _avatarUrl = "",
  currentUser,
  email,
}) {
  const menuHistoryRef = useRef([]);
  const prevMenuRef = useRef(activeMenu);

  useEffect(() => {
    const prev = prevMenuRef.current;
    if (prev && prev !== activeMenu) {
      menuHistoryRef.current = [...menuHistoryRef.current, prev].slice(-20);
    }
    prevMenuRef.current = activeMenu;
  }, [activeMenu]);

  function handleMobileBack() {
    closeMobileDrawer();
    const history = menuHistoryRef.current;
    if (history.length > 0) {
      const previous = history[history.length - 1];
      menuHistoryRef.current = history.slice(0, -1);
      prevMenuRef.current = previous;
      setActiveMenu(previous);
      return;
    }
    if (activeMenu !== "dashboard") {
      prevMenuRef.current = "dashboard";
      setActiveMenu("dashboard");
    }
  }

  const canGoBack = activeMenu !== "dashboard";
  const backAria = appLanguage === "bn" ? "পিছনে" : "Back";

  function toggleTheme() {
    const root = document.documentElement;
    const next = root.getAttribute("data-theme") === "dark" ? "light" : "dark";
    if (next === "dark") root.setAttribute("data-theme", "dark");
    else root.removeAttribute("data-theme");
    try {
      localStorage.setItem("s4-theme", next);
    } catch {
      /* ignore */
    }
  }

  function toggleNotifyDropdown() {
    const next = !notifyDropdownOpen;
    setNotifyDropdownOpen?.(next);
    if (next) {
      onRefreshNotifications?.();
      // User gesture: request permission + register FCM / SW when opening the bell
      onEnablePush?.();
    }
  }

  const _initials = String(currentUser?.full_name || email || "SH")
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0] || "")
    .join("")
    .toUpperCase() || "SH";

  return (
    <header className={`topbar arch-shell-topbar${canGoBack ? "" : " is-dashboard-root"}`}>
      <div className="mobile-header-leading" aria-label="Navigation">
        {canGoBack ? (
          <button
            className="mobile-back"
            type="button"
            onClick={handleMobileBack}
            aria-label={backAria}
            title={backAria}
          >
            <span className="mobile-back-icon" aria-hidden="true">
              ←
            </span>
          </button>
        ) : null}

        <button
          className="mobile-menu"
          type="button"
          onClick={() => document.body.classList.toggle("mobile-drawer-open")}
          aria-label={t("openMobileMenu")}
          title={t("openMobileMenu")}
        >
          <span className="mobile-menu-bars" aria-hidden="true">
            <span />
            <span />
            <span />
          </span>
          <span className="mobile-menu-text">{appLanguage === "bn" ? "মেনু" : "Menu"}</span>
        </button>
      </div>

      <div className="shoyb-top-copy">
        <div className="brand-heading">
          <span className="s4">S4</span> FAMILY 143 — Dashboard
        </div>
        <div className="brand-sub">{t("welcomeBackOverview")}</div>
      </div>

      <div className="mobile-brand" aria-label="S4 FAMILY 143">
        <div className="mobile-brand-copy">
          <div className="mobile-brand-title">
            <span className="s4">S4</span> FAMILY 143
          </div>
          <div className="mobile-brand-sub">{t("brandTagline")}</div>
        </div>
      </div>

      <div className="search" role="search">
        <span className="sicon" aria-hidden="true">
          ⌕
        </span>
        <input placeholder={t("searchModules")} aria-label={t("searchModules")} />
        <kbd>Ctrl K</kbd>
      </div>

      <div className="top-actions">
        <div className="online-pill">
          <span className="online-dot" />
          <span>{t("syncAllOk")}</span>
        </div>

        <label className="lang-select-wrap" title={t("languageLock")}>
          <span className="sr-only">{t("languageLock")}</span>
          <select
            className="lang-select"
            aria-label={t("languageLock")}
            value={appLanguage}
            onChange={(e) => changeAppLanguage(e.target.value)}
          >
            {lockedLanguages.map((language) => (
              <option key={language.code} value={language.code}>
                {language.nativeName}
              </option>
            ))}
          </select>
        </label>

        <button type="button" className="icon-btn" title={t("theme")} onClick={toggleTheme}>
          ☾
        </button>

        <div className="notify-bell-wrap">
          <button
            type="button"
            className="icon-btn mobile-notify-btn shoyb-bell bell-btn"
            onClick={toggleNotifyDropdown}
            title={t("notifications")}
            aria-expanded={Boolean(notifyDropdownOpen)}
            aria-haspopup="dialog"
          >
            🔔
            {Number(unreadCount) > 0 ? (
              <span className="dot-badge bell-dot">{Number(unreadCount) > 9 ? "9+" : unreadCount}</span>
            ) : null}
          </button>
          <NotificationBellDropdown
            open={Boolean(notifyDropdownOpen)}
            onClose={() => setNotifyDropdownOpen?.(false)}
            notifications={notifications}
            loading={notificationsLoading}
            permission={notifyPermission}
            permissionHint={notifyPermissionHint}
            onEnablePush={onEnablePush}
            onOpenFull={() => setActiveMenu("notifications")}
            onMarkRead={onMarkNotificationRead}
            onMarkAllRead={onMarkAllNotificationsRead}
            onRefresh={onRefreshNotifications}
            t={t}
          />
        </div>

        <button
          type="button"
          className="avatar-mini"
          onClick={() => setActiveMenu("settings")}
          title={t("settings")}
        >
          {_initials}
        </button>

        <button type="button" className="btn topbar-logout" onClick={() => onLogout?.()} title={t("logout")}>
          <span className="topbar-logout-label">{t("logout")}</span>
        </button>
      </div>
    </header>
  );
}

export function MobileBottomNavigation({ navItems, activeMenu, setActiveMenu }) {
  const primary = (navItems || []).slice(0, 5);
  return (
    <nav className="mobile-bottom-nav" aria-label="Primary">
      {primary.map(([menu, label, icon]) => {
        const isMenu = menu === "__menu__";
        const isAdd = menu === "__add__";
        const active = !isMenu && !isAdd && isNavItemActive(activeMenu, menu);
        return (
          <button
            key={menu}
            type="button"
            className={`${active ? "active" : ""}${isMenu ? " is-menu-tab" : ""}${isAdd ? " is-add-tab" : ""}`}
            aria-label={label || "Add"}
            onClick={() => {
              if (isMenu) {
                document.body.classList.toggle("mobile-drawer-open");
                return;
              }
              if (isAdd) {
                setActiveMenu("transactions");
                closeMobileDrawer();
                return;
              }
              setActiveMenu(menu);
              closeMobileDrawer();
            }}
          >
            <span className="mb-icon" aria-hidden="true">
              {icon}
            </span>
            {label ? <small>{label}</small> : <small />}
          </button>
        );
      })}
    </nav>
  );
}
