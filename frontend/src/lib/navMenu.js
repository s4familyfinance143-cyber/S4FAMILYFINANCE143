/** Match sidebar highlight for composite keys like phase15:HEALTH */
export function isNavItemActive(activeMenu, menuKey) {
  return activeMenu === menuKey;
}

export function isSettingsMenu(menu) {
  return menu === "settings" || menu.startsWith("settings:");
}

export function parseSettingsTab(menu) {
  if (!menu.startsWith("settings:")) return null;
  return menu.slice("settings:".length) || null;
}

export function isPhase15Menu(menu) {
  return menu === "phase15" || menu.startsWith("phase15:");
}

export function isPhase16Menu(menu) {
  return menu === "phase16" || menu.startsWith("phase16:");
}

export function parsePhaseTab(menu, prefix) {
  if (!menu.startsWith(`${prefix}:`)) return null;
  return menu.slice(prefix.length + 1) || null;
}
