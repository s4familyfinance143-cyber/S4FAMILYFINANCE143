import { colors, darkColors } from "./colors";
import { spacing, radii } from "./spacing";
import { typography } from "./typography";

export const lightTheme = {
  mode: "light" as const,
  colors,
  spacing,
  radii,
  typography,
};

export const darkTheme = {
  mode: "dark" as const,
  colors: darkColors,
  spacing,
  radii,
  typography,
};

export type AppTheme = typeof lightTheme;

export function getTheme(mode: "light" | "dark"): AppTheme {
  return mode === "dark" ? darkTheme : lightTheme;
}
