import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const LANGUAGES = ["bn", "en", "ar", "hi", "ur"];
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const messagesDir = path.join(ROOT, "src", "i18n", "messages");
const packs = Object.fromEntries(
  await Promise.all(
    LANGUAGES.map(async (language) => [
      language,
      JSON.parse(await fs.readFile(path.join(messagesDir, `${language}.json`), "utf8")),
    ]),
  ),
);

const expected = Object.keys(packs.en).sort();
const failures = [];
for (const language of LANGUAGES) {
  const actual = Object.keys(packs[language]).sort();
  const missing = expected.filter((key) => !(key in packs[language]));
  const extra = actual.filter((key) => !(key in packs.en));
  const empty = expected.filter((key) => !String(packs[language][key] ?? "").trim());
  if (missing.length) failures.push(`${language}: missing ${missing.join(", ")}`);
  if (extra.length) failures.push(`${language}: extra ${extra.join(", ")}`);
  if (empty.length) failures.push(`${language}: empty ${empty.join(", ")}`);
  if (actual.length !== expected.length) {
    failures.push(`${language}: expected ${expected.length} keys, found ${actual.length}`);
  }
}

if (failures.length) {
  console.error(failures.join("\n"));
  process.exit(1);
}
console.log(`i18n parity OK: ${expected.length} keys × ${LANGUAGES.length} languages (100%).`);
