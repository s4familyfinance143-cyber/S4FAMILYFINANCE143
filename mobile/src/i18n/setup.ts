import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import arJson from "./ar.json";
import bnJson from "./bn.json";
import enJson from "./en.json";
import hiJson from "./hi.json";
import urJson from "./ur.json";

let initialized = false;

function buildResources() {
  let dictBn: Record<string, string> = {};
  let dictEn: Record<string, string> = {};
  let dictAr: Record<string, string> = {};
  let dictHi: Record<string, string> = {};
  let dictUr: Record<string, string> = {};
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const i18nMod = require("../i18n") as { __DICT__?: Record<string, Record<string, string>> };
    const d = i18nMod.__DICT__ || {};
    dictBn = d.bn || {};
    dictEn = d.en || {};
    dictAr = d.ar || dictEn;
    dictHi = d.hi || dictEn;
    dictUr = d.ur || dictEn;
  } catch {
    /* DICT optional at cold start */
  }

  return {
    bn: { translation: { ...dictBn, ...bnJson } },
    en: { translation: { ...dictEn, ...enJson } },
    ar: { translation: { ...dictAr, ...arJson } },
    hi: { translation: { ...dictHi, ...hiJson } },
    ur: { translation: { ...dictUr, ...urJson } },
  };
}

export function initI18n(lang: string = "bn") {
  const resources = buildResources();
  if (initialized || i18n.isInitialized) {
    for (const lng of Object.keys(resources)) {
      i18n.addResourceBundle(lng, "translation", (resources as any)[lng].translation, true, true);
    }
    void i18n.changeLanguage(lang);
    initialized = true;
    return i18n;
  }
  void i18n.use(initReactI18next).init({
    compatibilityJSON: "v4",
    resources,
    lng: lang,
    fallbackLng: "en",
    interpolation: { escapeValue: false },
  });
  initialized = true;
  return i18n;
}

export function tI18n(lang: string, key: string): string | null {
  if (!i18n.isInitialized) return null;
  const value = i18n.getFixedT(lang)(key);
  if (!value || value === key) return null;
  return value;
}

export { i18n };
export default i18n;
