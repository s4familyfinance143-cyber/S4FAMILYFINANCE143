/**
 * MOB-2: logout must wipe the previous user's cached family data and queue
 * (shared family phones), but keep the pure-offline account's rows.
 * Runs the real SQL against Node's built-in SQLite.
 */

jest.mock("../src/lib/mobileDb", () => ({ openMobileDatabase: jest.fn() }));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { DatabaseSync } = require("node:sqlite");
import { CREATE_TABLES_SQL } from "../src/database/schema";
import {
  FAMILY_SCOPED_TABLES,
  countUnsyncedChanges,
  wipeLocalUserData,
  type WipeDb,
} from "../src/database/localWipe";

function makeDb(): { raw: any; db: WipeDb } {
  const raw = new DatabaseSync(":memory:");
  raw.exec(CREATE_TABLES_SQL);
  const db: WipeDb = {
    async runAsync(sql, params = []) {
      return raw.prepare(sql).run(...(params as any[]));
    },
    async getFirstAsync<T>(sql: string, params: unknown[] = []) {
      return (raw.prepare(sql).get(...(params as any[])) ?? null) as T | null;
    },
  };
  return { raw, db };
}

function seed(raw: any, familyId: string) {
  const now = new Date().toISOString();
  raw
    .prepare(
      "INSERT INTO local_accounts (id, family_id, name, account_type, created_at, updated_at) VALUES (?, ?, 'W', 'CASH', ?, ?)"
    )
    .run(`acc-${familyId}`, familyId, now, now);
  raw
    .prepare(
      "INSERT INTO sync_queue (entity_type, entity_id, action, payload, status, created_at) VALUES ('transactions', ?, 'CREATE', ?, 'pending', ?)"
    )
    .run(`tx-${familyId}`, JSON.stringify({ family_id: familyId }), now);
}

const count = (raw: any, sql: string) => (raw.prepare(sql).get() as { n: number }).n;

describe("wipeLocalUserData", () => {
  test("covers every family-scoped table in schema.ts", () => {
    const tables = Array.from(CREATE_TABLES_SQL.matchAll(/CREATE TABLE IF NOT EXISTS (\w+)/g)).map((m) => m[1]);
    const scoped = tables.filter((t) => t.startsWith("local_") || t.startsWith("mobile_") && t !== "mobile_meta");
    expect([...FAMILY_SCOPED_TABLES].sort()).toEqual(scoped.sort());
  });

  test("removes server-synced family data and queue, keeps offline account", async () => {
    const { raw, db } = makeDb();
    seed(raw, "server-fam");
    seed(raw, "offline-fam");
    raw.prepare("INSERT INTO mobile_meta (key, value, updated_at) VALUES ('schema_version', '4', 'x')").run();

    expect(await countUnsyncedChanges("offline-fam", db)).toBe(1);
    await wipeLocalUserData("offline-fam", db);

    expect(count(raw, "SELECT COUNT(*) n FROM local_accounts WHERE family_id = 'server-fam'")).toBe(0);
    expect(count(raw, "SELECT COUNT(*) n FROM local_accounts WHERE family_id = 'offline-fam'")).toBe(1);
    expect(count(raw, "SELECT COUNT(*) n FROM sync_queue")).toBe(1);
    expect(count(raw, "SELECT COUNT(*) n FROM mobile_meta")).toBe(1);
  });

  test("without an offline account everything user-scoped goes", async () => {
    const { raw, db } = makeDb();
    seed(raw, "server-fam");
    raw
      .prepare(
        "INSERT INTO sync_queue (entity_type, entity_id, action, payload, status, created_at) VALUES ('x', 'y', 'CREATE', 'not-json', 'pending', 'now')"
      )
      .run();
    await wipeLocalUserData(null, db);
    expect(count(raw, "SELECT COUNT(*) n FROM local_accounts")).toBe(0);
    expect(count(raw, "SELECT COUNT(*) n FROM sync_queue")).toBe(0);
  });
});
