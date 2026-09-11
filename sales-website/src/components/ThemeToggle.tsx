"use client";

import { useTheme } from "@/components/ThemeProvider";

export function ThemeToggle({ className = "" }: { className?: string }) {
  const { theme, toggleTheme } = useTheme();
  const isDark = theme === "dark";

  return (
    <button
      type="button"
      onClick={toggleTheme}
      aria-label={isDark ? "Switch to light mode" : "Switch to dark mode"}
      aria-pressed={isDark}
      className={`inline-flex items-center gap-2 rounded-lg border px-3 py-1.5 text-xs font-bold transition-colors ${className}`}
    >
      <span aria-hidden>{isDark ? "☾" : "☀"}</span>
      <span>{isDark ? "Dark" : "Light"}</span>
    </button>
  );
}
