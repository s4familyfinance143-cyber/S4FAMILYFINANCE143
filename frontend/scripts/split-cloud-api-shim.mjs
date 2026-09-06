/**
 * Split cloudApiShim.js into cloudApi/{_core,get,post,patch,delete,seed,index}.js
 */
import fs from "fs";
import path from "path";

const root = path.resolve("src/lib");
const srcPath = path.join(root, "cloudApiShim.js");
const outDir = path.join(root, "cloudApi");

// If already split, restore from git? Prefer reading current if still monolithic
let src = fs.readFileSync(srcPath, "utf8");
if (src.includes('from "./cloudApi/index.js"') && !src.includes("export async function cloudApiGet")) {
  console.log("Already split — skip");
  process.exit(0);
}

const lines = src.split(/\r?\n/);
function findLine(re, from = 0) {
  for (let i = from; i < lines.length; i++) if (re.test(lines[i])) return i;
  return -1;
}

const importEnd = findLine(/^function normalizeMemberRole/);
const getStart = findLine(/^export async function cloudApiGet/);
const postStart = findLine(/^export async function cloudApiPost/);
const patchStart = findLine(/^export async function cloudApiPatch/);
const deleteStart = findLine(/^export async function cloudApiDelete/);
const seedStart = findLine(/^export async function seedCloudModuleCaches/);

if ([importEnd, getStart, postStart, patchStart, deleteStart, seedStart].some((n) => n < 0)) {
  throw new Error("boundary not found");
}

fs.mkdirSync(outDir, { recursive: true });

const imports = lines
  .slice(0, importEnd)
  .join("\n")
  .replaceAll('from "./offlineCache"', 'from "../offlineCache"')
  .replaceAll('from "./cloudLocalFinance"', 'from "../cloudLocalFinance"')
  .replaceAll('from "./familyRoles"', 'from "../familyRoles"');

const coreHelpers = lines
  .slice(importEnd, getStart)
  .map((line) => {
    if (/^async function /.test(line)) return `export ${line}`;
    if (/^function /.test(line)) return `export ${line}`;
    return line;
  })
  .join("\n");

fs.writeFileSync(outDir + "/_core.js", `${imports}\n\n${coreHelpers}\n`, "utf8");

const coreNames = [...coreHelpers.matchAll(/^export (?:async )?function ([A-Za-z0-9_]+)/gm)].map((m) => m[1]);
const importCore = `import {\n  ${coreNames.join(",\n  ")}\n} from "./_core.js";\n\n`;

function writePart(file, start, end) {
  const body = lines.slice(start, end).join("\n");
  fs.writeFileSync(path.join(outDir, file), importCore + body + "\n", "utf8");
}

writePart("get.js", getStart, postStart);
writePart("post.js", postStart, patchStart);
writePart("patch.js", patchStart, deleteStart);
writePart("delete.js", deleteStart, seedStart);
writePart("seed.js", seedStart, lines.length);

fs.writeFileSync(
  path.join(outDir, "index.js"),
  `export { cloudApiGet } from "./get.js";
export { cloudApiPost } from "./post.js";
export { cloudApiPatch } from "./patch.js";
export { cloudApiDelete } from "./delete.js";
export { seedCloudModuleCaches } from "./seed.js";
`,
  "utf8",
);

fs.writeFileSync(
  srcPath,
  `/** Stable path — implementation lives in ./cloudApi/ */
export {
  cloudApiGet,
  cloudApiPost,
  cloudApiPatch,
  cloudApiDelete,
  seedCloudModuleCaches,
} from "./cloudApi/index.js";
`,
  "utf8",
);

console.log("split cloudApiShim -> cloudApi/", { helpers: coreNames.length });
