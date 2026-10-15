/**
 * Expo config — loads EXPO_PUBLIC_* from .env into app extra.
 * The app talks only to the VPS API (no Firebase / cloud mode).
 */
const appJson = require("./app.json");

const PRODUCTION_API_BASE_URL = "https://app.s4businessthinking.com";

module.exports = ({ config }) => {
  const base = appJson.expo || config || {};
  const sentryDsn = process.env.EXPO_PUBLIC_SENTRY_DSN || base.extra?.sentryDsn || "";
  const apiBaseUrl =
    process.env.EXPO_PUBLIC_API_BASE_URL || base.extra?.apiBaseUrl || PRODUCTION_API_BASE_URL;

  return {
    ...base,
    extra: {
      ...(base.extra || {}),
      apiBaseUrl,
      sentryDsn,
      crashVault: "local+optional-sentry",
    },
  };
};
