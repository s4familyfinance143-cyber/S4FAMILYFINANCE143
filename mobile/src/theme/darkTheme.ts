import { colors, darkColors, type AppColors } from "./colors";
import { spacing, radii } from "./spacing";
import { typography } from "./typography";

export type AppTheme = {
  mode: "light" | "dark";
  colors: AppColors;
  spacing: typeof spacing;
  radii: typeof radii;
  typography: typeof typography;
};

export const lightTheme: AppTheme = {
  mode: "light" as const,
  colors,
  spacing,
  radii,
  typography,
};

export const darkTheme: AppTheme = {
  mode: "dark" as const,
  colors: darkColors,
  spacing,
  radii,
  typography,
};

export function getTheme(mode: "light" | "dark"): AppTheme {
  return mode === "dark" ? darkTheme : lightTheme;
}
