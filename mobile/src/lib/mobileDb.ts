import Constants from "expo-constants";
import * as SQLite from "expo-sqlite";
import {
  ENCRYPTED_DB_NAME,
  getOrCreateOfflineDbKeyHex,
  setOfflineDbSecurityStatus,
} from "./mobileDbCrypto";

/** Fresh plain DB for Expo Go — avoids corrupt file left by failed SQLCipher PRAGMA key. */
export const EXPO_GO_DB_NAME = "s4_family_finance_mobile_go_v4.db";

let cachedDb: SQLite.SQLiteDatabase | null = null;
let cachedDbName: string | null = null;
let openLock: Promise<SQLite.SQLiteDatabase> | null = null;
let chain: Promise<unknown> = Promise.resolve();

function isExpoGo() {
  return Constants.appOwnership === "expo";
}

/** Serialize method calls on the shared DB — Redmi NPEs on concurrent NativeDatabase use. */
function serializeDb(db: SQLite.SQLiteDatabase): SQLite.SQLiteDatabase {
  return new Proxy(db, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);
      if (typeof value !== "function") return value;
      return (...args: unknown[]) => {
        const run = chain.then(() => (value as (...a: unknown[]) => unknown).apply(target, args));
        chain = run.then(
          () => undefined,
          () => undefined
        );
        return run;
      };
    },
  }) as SQLite.SQLiteDatabase;
}

/** Run work against the shared DB (methods are already serialized via proxy). */
export async function withMobileDb<T>(fn: (db: SQLite.SQLiteDatabase) => Promise<T>): Promise<T> {
  const db = await openMobileDatabase();
  return fn(db);
}

export async function openMobileDatabase(name: string = ENCRYPTED_DB_NAME) {
  const dbName = isExpoGo() ? EXPO_GO_DB_NAME : name || ENCRYPTED_DB_NAME;

  if (cachedDb && cachedDbName === dbName) {
    return cachedDb;
  }

  if (openLock) {
    return openLock;
  }

  openLock = (async () => {
    try {
      // useNewConnection avoids stale/null native handles on some Android OEMs (Redmi etc.)
      let db = await SQLite.openDatabaseAsync(dbName, { useNewConnection: true });

      try {
        await db.getFirstAsync("SELECT 1 AS ok");
      } catch {
        try {
          await SQLite.deleteDatabaseAsync(dbName);
        } catch {
          /* ignore */
        }
        db = await SQLite.openDatabaseAsync(dbName, { useNewConnection: true });
        await db.getFirstAsync("SELECT 1 AS ok");
      }

      if (isExpoGo()) {
        setOfflineDbSecurityStatus({
          mode: "expo_go_plain_sqlite",
          dbName,
          keyPresent: false,
          cipherVersion: null,
          note: "Expo Go: plain SQLite (SQLCipher needs custom/dev build).",
        });
        cachedDb = serializeDb(db);
        cachedDbName = dbName;
        return cachedDb;
      }

      const keyHex = await getOrCreateOfflineDbKeyHex();
      try {
        await db.execAsync(`PRAGMA key = "x'${keyHex}'"`);
      } catch {
        setOfflineDbSecurityStatus({
          mode: "sqlcipher_pending_custom_build",
          dbName,
          keyPresent: true,
          cipherVersion: null,
          note: "PRAGMA key failed — using DB without SQLCipher unlock.",
        });
        cachedDb = serializeDb(db);
        cachedDbName = dbName;
        return cachedDb;
      }

      let cipherVersion: string | null = null;
      try {
        const row = await db.getFirstAsync<{ cipher_version?: string }>("PRAGMA cipher_version");
        cipherVersion = row?.cipher_version ? String(row.cipher_version) : null;
      } catch {
        cipherVersion = null;
      }

      setOfflineDbSecurityStatus(
        cipherVersion
          ? {
              mode: "sqlcipher",
              dbName,
              keyPresent: true,
              cipherVersion,
              note: `SQLCipher active (${cipherVersion})`,
            }
          : {
              mode: "sqlcipher_pending_custom_build",
              dbName,
              keyPresent: true,
              cipherVersion: null,
              note: "Key ready in SecureStore. Full SQLCipher needs custom native build (not Expo Go).",
            }
      );
      if (cipherVersion) {
        console.info(`[SQLCipher] runtime ON cipher_version=${cipherVersion} db=${dbName}`);
      } else {
        console.warn(`[SQLCipher] pending — cipher_version missing for db=${dbName}`);
      }

      cachedDb = serializeDb(db);
      cachedDbName = dbName;
      return cachedDb;
    } finally {
      openLock = null;
    }
  })();

  return openLock;
}

export function isNativeSqliteAvailable() {
  return true;
}

export { ENCRYPTED_DB_NAME, getOfflineDbSecurityStatus } from "./mobileDbCrypto";
