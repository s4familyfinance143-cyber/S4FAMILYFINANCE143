/**
 * Compatibility façade — delegates to split auth/family/settings stores.
 * Existing imports of useAppStore keep working.
 */
import { useAuthStore } from "./authStore";
import { useFamilyStore } from "./familyStore";
import { useSettingsStore } from "./settingsStore";

export { useAuthStore } from "./authStore";
export { useFamilyStore } from "./familyStore";
export { useSettingsStore } from "./settingsStore";

type AppStore = {
  token: string | null;
  familyId: string | null;
  theme: "light" | "dark";
  lang: string;
  setToken: (token: string | null) => void;
  setFamilyId: (familyId: string | null) => void;
  setTheme: (theme: "light" | "dark") => void;
  setLang: (lang: string) => void;
  hydrateFromStorage: () => void;
};

export function useAppStore(): AppStore;
export function useAppStore<T>(selector: (s: AppStore) => T): T;
export function useAppStore(selector?: (s: AppStore) => unknown) {
  const token = useAuthStore((s) => s.token);
  const familyId = useFamilyStore((s) => s.familyId);
  const theme = useSettingsStore((s) => s.theme);
  const lang = useSettingsStore((s) => s.lang);

  const state: AppStore = {
    token,
    familyId,
    theme,
    lang,
    setToken: (t) => useAuthStore.getState().hydrateToken(t),
    setFamilyId: (id) => useFamilyStore.getState().setFamilyId(id),
    setTheme: (t) => useSettingsStore.getState().setTheme(t),
    setLang: (l) => useSettingsStore.getState().setLang(l),
    hydrateFromStorage: () => {
      useFamilyStore.getState().hydrateFromStorage();
      useSettingsStore.getState().hydrateFromStorage();
    },
  };

  return selector ? selector(state) : state;
}

useAppStore.getState = (): AppStore => ({
  token: useAuthStore.getState().token,
  familyId: useFamilyStore.getState().familyId,
  theme: useSettingsStore.getState().theme,
  lang: useSettingsStore.getState().lang,
  setToken: (t) => useAuthStore.getState().hydrateToken(t),
  setFamilyId: (id) => useFamilyStore.getState().setFamilyId(id),
  setTheme: (t) => useSettingsStore.getState().setTheme(t),
  setLang: (l) => useSettingsStore.getState().setLang(l),
  hydrateFromStorage: () => {
    useFamilyStore.getState().hydrateFromStorage();
    useSettingsStore.getState().hydrateFromStorage();
  },
});
