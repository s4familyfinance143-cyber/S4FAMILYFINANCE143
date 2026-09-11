/** Static asset registry for checklist src/assets. */
export const AppImages = {
  icon: require("./images/icon.png"),
  splash: require("./images/splash-icon.png"),
  favicon: require("./images/favicon.png"),
  logoGlow: require("./images/logo-glow.png"),
};

/** Base icons only — Metro auto-picks @2x/@3x; do not require those paths. */
export const AppIcons = {
  home: require("./icons/home.png"),
  explore: require("./icons/explore.png"),
};
