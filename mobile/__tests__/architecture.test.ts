import { conflictResolver } from "../src/sync/conflictResolver";
import { formatTaka, parseMoney } from "../src/utils/formatTaka";
import { formatDate } from "../src/utils/formatDate";
import { isEmail, isStrongPassword, passwordStrengthScore } from "../src/utils/validators";
import { SCHEMA_VERSION } from "../src/database/schema";
import bn from "../src/i18n/bn.json";
import en from "../src/i18n/en.json";

describe("utils/formatTaka", () => {
  test("formats BDT with taka sign", () => {
    expect(formatTaka(12.5, "BDT")).toBe("৳12.50");
  });
  test("formats other currencies with code", () => {
    expect(formatTaka(10, "AED")).toBe("AED 10.00");
  });
  test("parseMoney", () => {
    expect(parseMoney("3.14")).toBeCloseTo(3.14);
  });
});

describe("utils/validators", () => {
  test("email", () => {
    expect(isEmail("a@b.com").ok).toBe(true);
    expect(isEmail("bad").ok).toBe(false);
  });
  test("strong password", () => {
    expect(isStrongPassword("Weak").ok).toBe(false);
    expect(isStrongPassword("Strong1!").ok).toBe(true);
    expect(passwordStrengthScore("Strong1!")).toBe(4);
  });
});

describe("utils/formatDate", () => {
  test("formats valid date", () => {
    const out = formatDate("2026-08-09T12:00:00Z", "en");
    expect(out).toContain("2026");
  });
});

describe("database schema", () => {
  test("schema version locked", () => {
    expect(SCHEMA_VERSION).toBe(4);
  });
});

describe("i18n json", () => {
  test("bn and en share keys", () => {
    expect(Object.keys(bn).sort()).toEqual(Object.keys(en).sort());
    expect(bn.signIn).toBeTruthy();
    expect(en.signIn).toBe("Sign In");
  });
});

describe("conflictResolver", () => {
  test("detects conflict counts", () => {
    expect(conflictResolver.hasConflict({ conflict_count: 1 })).toBe(true);
    expect(conflictResolver.hasConflict({ conflict_count: 0, applied: { conflict_count: 0, failed: [] } })).toBe(false);
  });
  test("merge strategies", () => {
    expect(conflictResolver.mergeKeepLocal({ a: 1 }, { a: 2, b: 3 })).toMatchObject({ a: 1, b: 3 });
    expect(conflictResolver.mergeKeepServer({ a: 1 }, { a: 2 })).toMatchObject({ a: 2 });
  });
});
