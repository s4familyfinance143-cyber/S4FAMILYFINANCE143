import fs from "node:fs/promises";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const LANGUAGES = ["bn", "en", "ar", "hi", "ur"];
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const APP_FILE = path.join(ROOT, "src", "App.jsx");
const OUTPUT_DIR = path.join(ROOT, "src", "i18n", "messages");
const TRANSLATE_MISSING = process.argv.includes("--translate-missing");
const MANUAL_CORRECTIONS = {
  ar: {
    backupCreatedFile: "تم إنشاء النسخة الاحتياطية: {file}",
    conflictResolvedStrategy: "تم حل التعارض: {strategy}",
    zakatDueAmount: "الزكاة المستحقة: {amount}",
  },
  hi: {
    backupCreatedFile: "बैकअप बनाया गया: {file}",
    conflictResolvedStrategy: "विरोध हल हुआ: {strategy}",
    ocrItemAdded: "OCR आइटम जोड़ा गया: {name}",
    zakatDueAmount: "देय ज़कात: {amount}",
  },
  ur: {
    zakatDueAmount: "واجب زکوٰۃ: {amount}",
  },
};

function objectLiteralAt(source, start) {
  let depth = 0;
  let quote = "";
  let escaped = false;
  for (let index = start; index < source.length; index += 1) {
    const char = source[index];
    if (quote) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === quote) quote = "";
      continue;
    }
    if (char === '"' || char === "'" || char === "`") {
      quote = char;
      continue;
    }
    if (char === "{") depth += 1;
    if (char === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(start, index + 1);
    }
  }
  throw new Error(`Unclosed object literal at offset ${start}`);
}

function extractPacks(source) {
  const declaration = /const\s+([A-Z0-9_]*UI_TEXT)\s*=\s*\{/g;
  const packs = [];
  for (const match of source.matchAll(declaration)) {
    const literal = objectLiteralAt(source, match.index + match[0].lastIndexOf("{"));
    try {
      packs.push({
        name: match[1],
        value: vm.runInNewContext(`(${literal})`, Object.create(null), { timeout: 1000 }),
      });
    } catch (error) {
      throw new Error(`Could not parse ${match[1]}: ${error.message}`);
    }
  }
  return packs;
}

async function translate(text, target) {
  const url = new URL("https://translate.googleapis.com/translate_a/single");
  url.searchParams.set("client", "gtx");
  url.searchParams.set("sl", "en");
  url.searchParams.set("tl", target);
  url.searchParams.set("dt", "t");
  url.searchParams.set("q", text);
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    const response = await fetch(url);
    if (response.ok) {
      const payload = await response.json();
      return payload[0].map((part) => part[0]).join("");
    }
    if (attempt === 4) throw new Error(`Translation failed (${response.status}) for ${target}: ${text}`);
    await new Promise((resolve) => setTimeout(resolve, attempt * 750));
  }
  return text;
}

async function mapConcurrent(entries, concurrency, worker) {
  const result = new Array(entries.length);
  let cursor = 0;
  async function run() {
    while (cursor < entries.length) {
      const index = cursor;
      cursor += 1;
      result[index] = await worker(entries[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, entries.length) }, run));
  return result;
}

const source = await fs.readFile(APP_FILE, "utf8");
const messages = Object.fromEntries(LANGUAGES.map((language) => [language, {}]));
for (const { value } of extractPacks(source)) {
  for (const language of LANGUAGES) Object.assign(messages[language], value[language] || {});
}

const englishEntries = Object.entries(messages.en);
for (const language of ["ar", "hi", "ur"]) {
  try {
    const existing = JSON.parse(
      await fs.readFile(path.join(OUTPUT_DIR, `${language}.json`), "utf8"),
    );
    for (const [key] of englishEntries) {
      if (!messages[language][key] && existing[key]) messages[language][key] = existing[key];
    }
  } catch {
    /* First extraction has no generated locale snapshot yet. */
  }
  Object.assign(messages[language], MANUAL_CORRECTIONS[language]);
  const missing = englishEntries.filter(([key]) => !messages[language][key]);
  if (missing.length && !TRANSLATE_MISSING) {
    throw new Error(
      `${language} is missing ${missing.length} keys. Re-run with --translate-missing to populate them.`,
    );
  }
  if (missing.length) {
    console.log(`Translating ${missing.length} missing ${language} messages...`);
    const translated = await mapConcurrent(missing, 12, async ([key, value]) => [
      key,
      await translate(String(value), language),
    ]);
    Object.assign(messages[language], Object.fromEntries(translated));
  }
}

const englishKeys = Object.keys(messages.en).sort();
for (const language of LANGUAGES) {
  const ordered = Object.fromEntries(englishKeys.map((key) => [key, messages[language][key] ?? messages.en[key]]));
  await fs.mkdir(OUTPUT_DIR, { recursive: true });
  await fs.writeFile(path.join(OUTPUT_DIR, `${language}.json`), `${JSON.stringify(ordered, null, 2)}\n`);
}

console.log(`Wrote ${englishKeys.length} keys for ${LANGUAGES.join(", ")}.`);
