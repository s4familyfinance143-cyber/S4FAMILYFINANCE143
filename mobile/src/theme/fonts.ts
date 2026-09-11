/**
 * Design-system fonts — Noto Sans (Latin) + Bengali.
 * Prefer bundled files under src/assets/fonts; fall back to @expo-google-fonts packages.
 */
import * as Font from "expo-font";

let loaded = false;

export const fontFamilies = {
  regular: "NotoSans_400Regular",
  medium: "NotoSans_500Medium",
  bold: "NotoSans_700Bold",
  bangla: "NotoSansBengali_400Regular",
} as const;

export async function loadAppFonts() {
  if (loaded) return fontFamilies;
  try {
    let map: Record<string, number> | null = null;
    try {
      // Bundled copies in src/assets/fonts (checklist + offline-friendly).
      map = {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        NotoSans_400Regular: require("../assets/fonts/NotoSans_400Regular.ttf"),
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        NotoSans_500Medium: require("../assets/fonts/NotoSans_500Medium.ttf"),
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        NotoSans_700Bold: require("../assets/fonts/NotoSans_700Bold.ttf"),
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        NotoSansBengali_400Regular: require("../assets/fonts/NotoSansBengali_400Regular.ttf"),
      };
    } catch {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const latin = require("@expo-google-fonts/noto-sans") as {
        NotoSans_400Regular: number;
        NotoSans_500Medium: number;
        NotoSans_700Bold: number;
      };
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const bengali = require("@expo-google-fonts/noto-sans-bengali") as {
        NotoSansBengali_400Regular: number;
      };
      map = {
        NotoSans_400Regular: latin.NotoSans_400Regular,
        NotoSans_500Medium: latin.NotoSans_500Medium,
        NotoSans_700Bold: latin.NotoSans_700Bold,
        NotoSansBengali_400Regular: bengali.NotoSansBengali_400Regular,
      };
    }
    await Font.loadAsync(map);
    loaded = true;
  } catch {
    // Packages optional until installed — system fonts still work.
  }
  return fontFamilies;
}
