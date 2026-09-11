/**
 * Copy web cloud modules into mobile with import path rewrites.
 */
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const fe = path.resolve(root, "../frontend/src");
const outLib = path.join(root, "src/lib");
const outFb = path.join(root, "src/firebase");

function copyRewrite(srcRel, destAbs, rewrites = []) {
  let text = fs.readFileSync(path.join(fe, srcRel), "utf8");
  for (const [from, to] of rewrites) {
    text = text.split(from).join(to);
  }
  fs.writeFileSync(destAbs, text, "utf8");
  console.log("wrote", destAbs);
}

fs.mkdirSync(outLib, { recursive: true });
fs.mkdirSync(outFb, { recursive: true });

copyRewrite("lib/cloudLocalFinance.js", path.join(outLib, "cloudLocalFinance.js"));
copyRewrite("lib/familyRoles.js", path.join(outLib, "familyRoles.js"));
copyRewrite("lib/familyRelationships.js", path.join(outLib, "familyRelationships.js"));
copyRewrite("lib/backupPayload.js", path.join(outLib, "backupPayload.js"), [
  ['./offlineCache', "./offlineCache"],
]);
copyRewrite("lib/cloudApiShim.js", path.join(outLib, "cloudApiShim.js"), [
  ['./offlineCache', "./offlineCache"],
  ['./cloudLocalFinance', "./cloudLocalFinance"],
  ['./familyRoles', "./familyRoles"],
  ['../firebase/familyCloud', "../firebase/familyCloud"],
]);

copyRewrite("firebase/familyCloud.js", path.join(outFb, "familyCloud.js"), [
  ['./config', "./config"],
  ['../lib/backupPayload', "../lib/backupPayload"],
]);
copyRewrite("firebase/cloudSync.js", path.join(outFb, "cloudSync.js"), [
  ['./config', "./config"],
  ['./familyCloud', "./familyCloud"],
  ['../lib/backupPayload', "../lib/backupPayload"],
]);
copyRewrite("firebase/cloudOnboarding.js", path.join(outFb, "cloudOnboarding.js"), [
  ['./familyCloud', "./familyCloud"],
  ['./cloudSync', "./cloudSync"],
  ['./auth', "./auth"],
  ['./config', "./config"],
  ['../lib/', "../lib/"],
]);

console.log("done");
