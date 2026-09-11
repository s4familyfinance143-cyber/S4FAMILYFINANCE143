// One-time bootstrap for admin auth.
// Creates .env.local with a fresh AUTH_SECRET, ADMIN_USERNAME=admin and a
// RANDOM password hash. The random password is intentionally NOT printed:
// the site owner must set their own password with:
//
//   npm run set-admin-password "<your-password>"

import { scryptSync, randomBytes } from "node:crypto";
import { existsSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ENV_PATH = path.join(__dirname, "..", ".env.local");

if (existsSync(ENV_PATH)) {
  console.log(".env.local already exists — leaving it untouched.");
  process.exit(0);
}

const authSecret = randomBytes(32).toString("hex");
const randomPassword = randomBytes(24).toString("base64url");
const salt = randomBytes(16);
const hash = scryptSync(randomPassword, salt, 64);
const passwordHash = `scrypt:${salt.toString("hex")}:${hash.toString("hex")}`;

const env = [
  "# Auto-generated. Do NOT commit. Contains admin secrets.",
  `AUTH_SECRET=${authSecret}`,
  "ADMIN_USERNAME=admin",
  `ADMIN_PASSWORD_HASH=${passwordHash}`,
  "",
].join("\n");

writeFileSync(ENV_PATH, env, "utf8");
console.log("Created .env.local (AUTH_SECRET + admin, random password).");
console.log('Set your own password:  npm run set-admin-password "<your-password>"');
