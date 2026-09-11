import { initializeApp, getApps, getApp } from "firebase/app";
import { initializeAuth, getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";
import AsyncStorage from "@react-native-async-storage/async-storage";
import Constants from "expo-constants";

/** Same project as web — overridable via EXPO_PUBLIC_FIREBASE_* */
export const firebaseConfig = {
  apiKey:
    process.env.EXPO_PUBLIC_FIREBASE_API_KEY ||
    "AIzaSyDO05KM8i2WlERcajsqCIMNvKos8tw14lc",
  authDomain:
    process.env.EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN || "s4-family-finance.firebaseapp.com",
  projectId: process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID || "s4-family-finance",
  storageBucket:
    process.env.EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET || "s4-family-finance.firebasestorage.app",
  messagingSenderId:
    process.env.EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID || "1089437513968",
  appId:
    process.env.EXPO_PUBLIC_FIREBASE_APP_ID ||
    "1:1089437513968:web:0e4438c9489251bf00ea35",
  measurementId: process.env.EXPO_PUBLIC_FIREBASE_MEASUREMENT_ID || "G-XPQ83E8VC4",
};

const app = getApps().length ? getApp() : initializeApp(firebaseConfig);

let authInstance: ReturnType<typeof getAuth> | null = null;

function getReactNativePersistenceSafe() {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const authMod = require("firebase/auth");
    if (typeof authMod.getReactNativePersistence === "function") {
      return authMod.getReactNativePersistence(AsyncStorage);
    }
  } catch {
    /* fall through */
  }
  try {
    // Metro resolves @firebase/auth to the RN build which exports persistence helper
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const rnAuth = require("@firebase/auth");
    if (typeof rnAuth.getReactNativePersistence === "function") {
      return rnAuth.getReactNativePersistence(AsyncStorage);
    }
  } catch {
    /* fall through — in-memory auth; SecureStore still restores app session */
  }
  return undefined;
}

export function isFirebaseConfigured() {
  return Boolean(firebaseConfig.apiKey && firebaseConfig.projectId);
}

export function getFirebaseApp() {
  return app;
}

export function getFirebaseAuth() {
  if (!isFirebaseConfigured()) return null;
  if (authInstance) return authInstance;
  const persistence = getReactNativePersistenceSafe();
  try {
    authInstance = persistence
      ? initializeAuth(app, { persistence })
      : initializeAuth(app);
  } catch {
    authInstance = getAuth(app);
  }
  return authInstance;
}

export function getFirestoreDb() {
  if (!isFirebaseConfigured()) return null;
  return getFirestore(app);
}

export function isFirebaseFirstMode() {
  if (!isFirebaseConfigured()) return false;
  const extra = Constants.expoConfig?.extra || {};
  const raw = process.env.EXPO_PUBLIC_FIREBASE_FIRST ?? extra.firebaseFirst ?? "true";
  const flag = String(raw).trim().toLowerCase();
  return flag !== "0" && flag !== "false" && flag !== "no";
}
