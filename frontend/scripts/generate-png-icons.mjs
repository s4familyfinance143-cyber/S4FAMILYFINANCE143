/**
 * Generate PWA / store PNG icons from public/brand/s4-family-logo.png
 * Run: npm run generate:icons
 */
import { mkdir, access } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const logoPath = path.join(root, "public", "brand", "s4-family-logo.png");
const publicDir = path.join(root, "public");
const tauriIcons = path.join(root, "..", "desktop", "src-tauri", "icons");
const androidRes = path.join(root, "android", "app", "src", "main", "res");

const androidMipmaps = [
  ["mipmap-mdpi", 48],
  ["mipmap-hdpi", 72],
  ["mipmap-xhdpi", 96],
  ["mipmap-xxhdpi", 144],
  ["mipmap-xxxhdpi", 192],
];

const androidSplashes = [
  ["drawable-port-mdpi", 320],
  ["drawable-port-hdpi", 480],
  ["drawable-port-xhdpi", 720],
  ["drawable-port-xxhdpi", 1080],
  ["drawable-port-xxxhdpi", 1440],
];

const sizes = [72, 96, 128, 144, 152, 192, 384, 512];

async function fileExists(p) {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

async function squareIcon(input, size, out) {
  await sharp(input)
    .resize(size, size, { fit: "cover", position: "centre" })
    .png()
    .toFile(out);
}

async function main() {
  if (!(await fileExists(logoPath))) {
    throw new Error(`Brand logo missing: ${logoPath}`);
  }
  await mkdir(publicDir, { recursive: true });

  for (const size of sizes) {
    const out = path.join(publicDir, `icon-${size}.png`);
    await squareIcon(logoPath, size, out);
    console.log("wrote", path.relative(root, out));
  }

  await mkdir(tauriIcons, { recursive: true });
  await squareIcon(logoPath, 32, path.join(tauriIcons, "32x32.png"));
  await squareIcon(logoPath, 128, path.join(tauriIcons, "128x128.png"));
  await squareIcon(logoPath, 256, path.join(tauriIcons, "128x128@2x.png"));
  await squareIcon(logoPath, 256, path.join(tauriIcons, "icon.png"));
  console.log("wrote Tauri icons in desktop/src-tauri/icons/");

  if (await fileExists(androidRes)) {
    for (const [folder, size] of androidMipmaps) {
      const dir = path.join(androidRes, folder);
      await mkdir(dir, { recursive: true });
      await squareIcon(logoPath, size, path.join(dir, "ic_launcher.png"));
      await squareIcon(logoPath, size, path.join(dir, "ic_launcher_round.png"));
      await squareIcon(logoPath, size, path.join(dir, "ic_launcher_foreground.png"));
    }
    for (const [folder, width] of androidSplashes) {
      const dir = path.join(androidRes, folder);
      await mkdir(dir, { recursive: true });
      const height = Math.round(width * 1.78);
      await sharp(logoPath)
        .resize(width, height, { fit: "cover", position: "centre" })
        .png()
        .toFile(path.join(dir, "splash.png"));
    }
    const splashRoot = path.join(androidRes, "drawable", "splash.png");
    await mkdir(path.dirname(splashRoot), { recursive: true });
    await squareIcon(logoPath, 512, splashRoot);
    console.log("wrote Android launcher + splash icons");
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
