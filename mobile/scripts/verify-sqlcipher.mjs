/**
 * Verify SQLCipher native build readiness (config + docs).
 * Runtime proof still requires a custom Expo binary (not Expo Go).
 *
 * Usage: node scripts/verify-sqlcipher.mjs
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");
const appJsonPath = path.join(root, "app.json");
const docsPath = path.join(root, "docs", "SQLCIPHER_NATIVE_BUILD.md");
const mobileDbPath = path.join(root, "src", "lib", "mobileDb.ts");
const cryptoPath = path.join(root, "src", "lib", "mobileDbCrypto.ts");
const pkgPath = path.join(root, "package.json");
const easPath = path.join(root, "eas.json");

let failed = false;
function fail(msg) {
  console.error(`FAIL: ${msg}`);
  failed = true;
}
function ok(msg) {
  console.log(`OK: ${msg}`);
}

const app = JSON.parse(fs.readFileSync(appJsonPath, "utf8"));
const plugins = app.expo?.plugins || [];
const sqlitePlugin = plugins.find(
  (p) => Array.isArray(p) && p[0] === "expo-sqlite" && p[1]?.useSQLCipher === true
);
if (sqlitePlugin) ok("app.json expo-sqlite useSQLCipher: true");
else fail("app.json missing expo-sqlite useSQLCipher: true");

if (fs.existsSync(docsPath)) ok("docs/SQLCIPHER_NATIVE_BUILD.md present");
else fail("missing docs/SQLCIPHER_NATIVE_BUILD.md");

const dbSrc = fs.readFileSync(mobileDbPath, "utf8");
if (dbSrc.includes("PRAGMA key") && dbSrc.includes("cipher_version")) {
  ok("mobileDb.ts applies PRAGMA key + checks cipher_version");
} else {
  fail("mobileDb.ts missing PRAGMA key / cipher_version check");
}

const cryptoSrc = fs.readFileSync(cryptoPath, "utf8");
if (cryptoSrc.includes("getOrCreateOfflineDbKeyHex") || cryptoSrc.includes("s4_family_finance_offline_db_key")) {
  ok("mobileDbCrypto.ts provides SecureStore DB key");
} else {
  fail("mobileDbCrypto.ts missing SecureStore key helpers");
}

const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
const scripts = pkg.scripts || {};
for (const name of ["prebuild:native", "android:native", "ios:native", "verify:sqlcipher"]) {
  if (scripts[name]) ok(`package.json script ${name}`);
  else fail(`package.json missing script ${name}`);
}

if (fs.existsSync(easPath)) {
  const eas = JSON.parse(fs.readFileSync(easPath, "utf8"));
  if (eas.build?.development || eas.build?.production) ok("eas.json has build profiles");
  else fail("eas.json missing build profiles");
} else {
  fail("eas.json missing — required for custom SQLCipher native builds");
}

if (!failed) {
  console.log("\nSQLCipher path COMPLETE (config).");
  console.log("Final runtime step: npm run prebuild:native && npm run android:native (or ios:native / EAS).");
  console.log('Expect getOfflineDbSecurityStatus().mode === "sqlcipher".');
  process.exit(0);
}
process.exit(1);
