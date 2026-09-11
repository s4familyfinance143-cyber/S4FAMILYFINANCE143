export const colors = {
  primary: "#0f6b56",
  primaryDark: "#0a473a",
  accent: "#1f8f72",
  danger: "#b42318",
  warning: "#b54708",
  success: "#067647",
  background: "#f3f7f6",
  surface: "#ffffff",
  border: "#dce7e3",
  text: "#10231c",
  textSecondary: "#5b7169",
  muted: "#8aa399",
} as const;

export const darkColors = {
  primary: "#3ecfad",
  primaryDark: "#1f8f72",
  accent: "#6ee7c5",
  danger: "#f97066",
  warning: "#fdb022",
  success: "#47cd89",
  background: "#07140f",
  surface: "#0f221b",
  border: "#1f3a31",
  text: "#e8f5f0",
  textSecondary: "#9fb5ac",
  muted: "#6d857c",
} as const;

export type AppColors = typeof colors;
