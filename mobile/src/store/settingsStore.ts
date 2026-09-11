import { create } from "zustand";
import { fastStorage } from "../lib/fastStorage";

const THEME_KEY = "s4_theme";
const LANG_KEY = "s4_lang";

type SettingsStore = {
  theme: "light" | "dark";
  lang: string;
  setTheme: (theme: "light" | "dark") => void;
  setLang: (lang: string) => void;
  hydrateFromStorage: () => void;
};

export const useSettingsStore = create<SettingsStore>((set) => ({
  theme: "light",
  lang: "bn",
  setTheme: (theme) => {
    fastStorage.set(THEME_KEY, theme);
    set({ theme });
  },
  setLang: (lang) => {
    fastStorage.set(LANG_KEY, lang);
    set({ lang });
  },
  hydrateFromStorage: () => {
    const theme = fastStorage.getString(THEME_KEY);
    const lang = fastStorage.getString(LANG_KEY);
    set({
      theme: theme === "dark" ? "dark" : "light",
      lang: lang || "bn",
    });
  },
}));
