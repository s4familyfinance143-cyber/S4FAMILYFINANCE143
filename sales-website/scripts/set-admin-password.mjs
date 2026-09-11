// Sets (or updates) the admin username/password in .env.local.
// Usage:  node scripts/set-admin-password.mjs "<password>" [username]
//
// - Password is stored only as a scrypt hash (never plain text).
// - AUTH_SECRET is generated once and preserved on subsequent runs.

import { scryptSync, randomBytes } from "node:crypto";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ENV_PATH = path.join(__dirname, "..", ".env.local");

const password = process.argv[2];
const username = process.argv[3] || "admin";

if (!password || password.length < 6) {
  console.error("Password required (min 6 characters).");
  console.error('Usage: node scripts/set-admin-password.mjs "<password>" [username]');
  process.exit(1);
}

function parseEnv(text) {
  const out = {};
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m) out[m[1]] = m[2];
  }
  return out;
}

const existing = existsSync(ENV_PATH)
  ? parseEnv(readFileSync(ENV_PATH, "utf8"))
  : {};

const authSecret = existing.AUTH_SECRET || randomBytes(32).toString("hex");

const salt = randomBytes(16);
const hash = scryptSync(password, salt, 64);
const passwordHash = `scrypt:${salt.toString("hex")}:${hash.toString("hex")}`;

const env = [
  "# Auto-generated. Do NOT commit. Contains admin secrets.",
  `AUTH_SECRET=${authSecret}`,
  `ADMIN_USERNAME=${username}`,
  `ADMIN_PASSWORD_HASH=${passwordHash}`,
  "",
].join("\n");

writeFileSync(ENV_PATH, env, "utf8");
console.log(`Admin credentials updated. Username: ${username}`);
console.log("Restart the dev server for changes to take effect.");
