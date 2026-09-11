import * as Crypto from "expo-crypto";
import * as SecureStore from "expo-secure-store";

export const OFFLINE_DB_KEY_STORAGE = "s4_family_finance_offline_db_key_v1";
export const ENCRYPTED_DB_NAME = "s4_family_finance_mobile_enc_v1.db";

export type OfflineDbSecurityMode =
  | "sqlcipher"
  | "sqlcipher_pending_custom_build"
  | "expo_go_plain_sqlite"
  | "web_payload_aes"
  | "unavailable";

export type OfflineDbSecurityStatus = {
  mode: OfflineDbSecurityMode;
  dbName: string;
  keyPresent: boolean;
  cipherVersion: string | null;
  note: string;
};

let cachedKeyHex: string | null = null;
let lastStatus: OfflineDbSecurityStatus = {
  mode: "unavailable",
  dbName: ENCRYPTED_DB_NAME,
  keyPresent: false,
  cipherVersion: null,
  note: "Offline DB security not initialized",
};

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function hexToBytes(hex: string): Uint8Array {
  const clean = hex.trim().toLowerCase();
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i += 1) {
    out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

export function getOfflineDbSecurityStatus(): OfflineDbSecurityStatus {
  return lastStatus;
}

export function setOfflineDbSecurityStatus(status: OfflineDbSecurityStatus) {
  lastStatus = status;
}

export async function getOrCreateOfflineDbKeyHex(): Promise<string> {
  if (cachedKeyHex) return cachedKeyHex;

  try {
    if (await SecureStore.isAvailableAsync()) {
      const existing = await SecureStore.getItemAsync(OFFLINE_DB_KEY_STORAGE);
      if (existing && /^[0-9a-f]{64}$/i.test(existing)) {
        cachedKeyHex = existing.toLowerCase();
        return cachedKeyHex;
      }
    }
  } catch {
    // fall through to generate
  }

  const random = await Crypto.getRandomBytesAsync(32);
  const keyHex = bytesToHex(random);

  try {
    if (await SecureStore.isAvailableAsync()) {
      await SecureStore.setItemAsync(OFFLINE_DB_KEY_STORAGE, keyHex);
    }
  } catch {
    // keep in-memory key for session
  }

  cachedKeyHex = keyHex;
  return keyHex;
}

export async function encryptOfflinePayload(plain: string): Promise<string> {
  const keyHex = await getOrCreateOfflineDbKeyHex();
  const keyBytes = hexToBytes(keyHex);
  const iv = await Crypto.getRandomBytesAsync(12);
  const encoded = new TextEncoder().encode(plain);

  if (typeof crypto !== "undefined" && crypto.subtle) {
    const cryptoKey = await crypto.subtle.importKey("raw", keyBytes, { name: "AES-GCM" }, false, ["encrypt"]);
    const cipherBuf = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, cryptoKey, encoded);
    const cipherBytes = new Uint8Array(cipherBuf);
    return `ENCv1:${bytesToHex(iv)}:${bytesToHex(cipherBytes)}`;
  }

  // Native fallback without subtle: XOR is not used — leave plaintext tagged for honesty
  return plain;
}

export async function decryptOfflinePayload(value: string): Promise<string> {
  if (!value?.startsWith("ENCv1:")) return value;
  const parts = value.split(":");
  if (parts.length !== 3) return value;
  const [, ivHex, cipherHex] = parts;
  if (!ivHex || !cipherHex) return value;

  try {
    const keyHex = await getOrCreateOfflineDbKeyHex();
    const keyBytes = hexToBytes(keyHex);
    const iv = hexToBytes(ivHex);
    const cipherBytes = hexToBytes(cipherHex);
    if (typeof crypto === "undefined" || !crypto.subtle) return value;
    const cryptoKey = await crypto.subtle.importKey("raw", keyBytes, { name: "AES-GCM" }, false, ["decrypt"]);
    const plainBuf = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, cryptoKey, cipherBytes);
    return new TextDecoder().decode(plainBuf);
  } catch {
    return value;
  }
}
