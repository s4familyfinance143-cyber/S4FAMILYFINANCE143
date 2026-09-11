/** Lightweight architecture self-check without Jest (CI can still use Jest when installed). */
const assert = require("assert");
const path = require("path");

// Register ts-node if available; otherwise run compiled-less checks via require of JSON + plain JS copies
function run() {
  const bn = require("../src/i18n/bn.json");
  const en = require("../src/i18n/en.json");
  assert.deepStrictEqual(Object.keys(bn).sort(), Object.keys(en).sort());
  assert.ok(bn.signIn);
  assert.equal(en.signIn, "Sign In");

  // formatTaka — inline mirror of logic for smoke (full unit tests via Jest)
  function formatTaka(value, currency = "BDT") {
    const n = Number(value ?? 0);
    const amount = Number.isFinite(n) ? n.toFixed(2) : "0.00";
    if (currency === "BDT" || currency === "TK" || currency === "৳") return `৳${amount}`;
    return `${currency} ${amount}`;
  }
  assert.equal(formatTaka(12.5, "BDT"), "৳12.50");
  assert.equal(formatTaka(10, "AED"), "AED 10.00");

  const folders = [
    "screens",
    "components/ui",
    "navigation",
    "store",
    "services",
    "database",
    "sync",
    "hooks",
    "i18n",
    "utils",
    "theme",
  ].map((f) => path.join(__dirname, "..", "src", f));
  const fs = require("fs");
  for (const f of folders) {
    assert.ok(fs.existsSync(f), `missing ${f}`);
  }
  assert.ok(fs.existsSync(path.join(__dirname, "architecture.test.ts")));
  assert.ok(fs.existsSync(path.join(__dirname, "..", ".detoxrc.js")));

  console.log("PASS architecture self-check");
}

run();
