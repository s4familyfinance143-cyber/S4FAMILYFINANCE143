/**
 * Expo config — loads EXPO_PUBLIC_* from .env into app extra.
 */
const appJson = require("./app.json");

module.exports = ({ config }) => {
  const base = appJson.expo || config || {};
  const sentryDsn = process.env.EXPO_PUBLIC_SENTRY_DSN || base.extra?.sentryDsn || "";
  const firebaseFirstRaw = process.env.EXPO_PUBLIC_FIREBASE_FIRST ?? "true";
  const firebaseFirst =
    String(firebaseFirstRaw).trim().toLowerCase() !== "0" &&
    String(firebaseFirstRaw).trim().toLowerCase() !== "false";
  const apiBaseUrl =
    process.env.EXPO_PUBLIC_API_BASE_URL ||
    base.extra?.apiBaseUrl ||
    (firebaseFirst ? "" : "http://127.0.0.1:8000");

  return {
    ...base,
    extra: {
      ...(base.extra || {}),
      apiBaseUrl,
      sentryDsn,
      firebaseFirst,
      crashVault: "local+optional-sentry",
    },
  };
};
