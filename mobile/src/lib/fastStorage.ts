/**
 * Fast local KV — prefers react-native-mmkv (native/dev builds),
 * falls back to in-memory + SecureStore so Expo Go / web still work.
 */
import Constants from "expo-constants";
import { Platform } from "react-native";
import * as SecureStore from "expo-secure-store";

type FastStorage = {
  getString: (key: string) => string | undefined;
  set: (key: string, value: string) => void;
  delete: (key: string) => void;
  backend: "mmkv" | "secure-memory";
};

const memory = new Map<string, string>();

function createSecureMemoryStorage(): FastStorage {
  return {
    backend: "secure-memory",
    getString(key) {
      return memory.get(key);
    },
    set(key, value) {
      memory.set(key, value);
      void SecureStore.setItemAsync(`mmkv_fb_${key}`, value).catch(() => undefined);
    },
    delete(key) {
      memory.delete(key);
      void SecureStore.deleteItemAsync(`mmkv_fb_${key}`).catch(() => undefined);
    },
  };
}

function isExpoGo(): boolean {
  // Expo Go cannot load custom native modules (MMKV / Nitro).
  return Constants.appOwnership === "expo";
}

function createMmkvStorage(): FastStorage | null {
  if (Platform.OS === "web" || isExpoGo()) return null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { createMMKV } = require("react-native-mmkv") as {
      createMMKV: (opts: { id: string }) => {
        getString: (k: string) => string | undefined;
        set: (k: string, v: string) => void;
        delete: (k: string) => void;
      };
    };
    const mmkv = createMMKV({ id: "s4-family-finance" });
    return {
      backend: "mmkv",
      getString: (key) => mmkv.getString(key),
      set: (key, value) => mmkv.set(key, value),
      delete: (key) => mmkv.delete(key),
    };
  } catch {
    return null;
  }
}

export const fastStorage: FastStorage = createMmkvStorage() || createSecureMemoryStorage();

export async function hydrateFastStorageKeys(keys: string[]) {
  if (fastStorage.backend !== "secure-memory") return;
  for (const key of keys) {
    try {
      const value = await SecureStore.getItemAsync(`mmkv_fb_${key}`);
      if (value != null) memory.set(key, value);
    } catch {
      /* ignore */
    }
  }
}
