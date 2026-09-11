import fs from "node:fs/promises";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const LANGUAGES = ["bn", "en", "ar", "hi", "ur"];
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SOURCE = path.join(ROOT, "src", "i18n.ts");
const OUTPUT_DIR = path.join(ROOT, "src", "i18n");
const FRONTEND_MESSAGES = path.resolve(ROOT, "..", "frontend", "src", "i18n", "messages");

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
    if (char === '"' || char === "'" || char === "`") quote = char;
    else if (char === "{") depth += 1;
    else if (char === "}" && --depth === 0) return source.slice(start, index + 1);
  }
  throw new Error(`Unclosed object literal at ${start}`);
}

function readObject(source, marker) {
  const markerIndex = source.indexOf(marker);
  if (markerIndex < 0) throw new Error(`Missing ${marker}`);
  const start = source.indexOf("{", markerIndex + marker.length);
  return vm.runInNewContext(`(${objectLiteralAt(source, start)})`, Object.create(null));
}

async function translate(text, target) {
  const url = new URL("https://translate.googleapis.com/translate_a/single");
  Object.entries({ client: "gtx", sl: "en", tl: target, dt: "t", q: text }).forEach(([key, value]) =>
    url.searchParams.set(key, value),
  );
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    const response = await fetch(url);
    if (response.ok) {
      const payload = await response.json();
      return payload[0].map((part) => part[0]).join("");
    }
    if (attempt === 4) throw new Error(`Translation failed (${response.status}) for ${target}`);
    await new Promise((resolve) => setTimeout(resolve, attempt * 750));
  }
  return text;
}

async function mapConcurrent(entries, concurrency, worker) {
  const output = new Array(entries.length);
  let cursor = 0;
  async function run() {
    while (cursor < entries.length) {
      const index = cursor++;
      output[index] = await worker(entries[index]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, entries.length) }, run));
  return output;
}

const source = await fs.readFile(SOURCE, "utf8");
const dictionary = readObject(source, "const DICT:");
const messages = { bn: dictionary.bn, en: dictionary.en };
messages.en.signIn = "Sign In";
const overrides = {
  ar: readObject(source, "const AR_OVERRIDES:"),
  hi: readObject(source, "const HI_OVERRIDES:"),
  ur: readObject(source, "const UR_OVERRIDES:"),
};
const manualCorrections = {
  ar: {
    belowNisabZakatable: "أقل من النصاب. المبلغ الخاضع للزكاة: {amount}",
    groceryLoaded: "تم تحميل البقالة · {n} قوائم",
    postType: "تسجيل {type}",
    reportsLoaded: "تم تحميل التقارير · {tab}",
    tx: "معاملة",
    zakatDueAmount: "الزكاة المستحقة: {amount}",
    zakatLoaded: "تم تحميل الزكاة ({n})",
  },
  hi: {
    belowNisabZakatable: "निसाब से कम। ज़कात योग्य: {amount}",
    financeLoaded: "वित्त लोड हुआ · {n} वॉलेट",
    postType: "{type} दर्ज करें",
    reportsLoaded: "रिपोर्ट लोड हुई · {tab}",
    tx: "लेनदेन",
    zakatDueAmount: "देय ज़कात: {amount}",
  },
  ur: {
    belowNisabZakatable: "نصاب سے کم۔ قابل زکوٰۃ رقم: {amount}",
    tx: "لین دین",
    zakatDueAmount: "واجب زکوٰۃ: {amount}",
  },
};
const frontend = {};
for (const language of LANGUAGES) {
  try {
    frontend[language] = JSON.parse(
      await fs.readFile(path.join(FRONTEND_MESSAGES, `${language}.json`), "utf8"),
    );
  } catch {
    frontend[language] = {};
  }
}

for (const language of ["ar", "hi", "ur"]) {
  messages[language] = { ...overrides[language], ...manualCorrections[language] };
  try {
    const existing = JSON.parse(
      await fs.readFile(path.join(OUTPUT_DIR, `${language}.json`), "utf8"),
    );
    for (const key of Object.keys(messages.en)) {
      if (!messages[language][key] && existing[key]) messages[language][key] = existing[key];
    }
  } catch {
    /* First extraction has no generated locale snapshot yet. */
  }
  for (const key of Object.keys(messages.en)) {
    if (!messages[language][key] && frontend[language][key]) {
      messages[language][key] = frontend[language][key];
    }
  }
  const missing = Object.entries(messages.en).filter(([key]) => !messages[language][key]);
  console.log(`Translating ${missing.length} missing mobile ${language} messages...`);
  Object.assign(
    messages[language],
    Object.fromEntries(
      await mapConcurrent(missing, 12, async ([key, value]) => [
        key,
        await translate(String(value), language),
      ]),
    ),
  );
}

const keys = Object.keys(messages.en).sort();
await fs.mkdir(OUTPUT_DIR, { recursive: true });
for (const language of LANGUAGES) {
  const ordered = Object.fromEntries(keys.map((key) => [key, messages[language][key] ?? messages.en[key]]));
  await fs.writeFile(path.join(OUTPUT_DIR, `${language}.json`), `${JSON.stringify(ordered, null, 2)}\n`);
}
console.log(`Wrote ${keys.length} mobile keys for ${LANGUAGES.join(", ")}.`);
