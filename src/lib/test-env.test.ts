import { describe, it, expect } from "vitest";
import {
  validateTestDatabaseEnv,
  getDatabaseHost,
  getDatabaseHostAndName,
  getDatabaseName,
  validateMigrationEnv,
} from "./test-env";

describe("getDatabaseHost and getDatabaseHostAndName", () => {
  it("extracts hostname AND database name (host/dbname) without credentials, passwords, or query params", () => {
    const url =
      "postgresql://user:secretpass123@db.example.com:5432/testdb?sslmode=require&channel_binding=require";
    expect(getDatabaseHost(url)).toBe("db.example.com/testdb");
    expect(getDatabaseHostAndName(url)).toBe("db.example.com/testdb");
  });

  it("handles URLs with test database name correctly", () => {
    const url = "postgresql://user:pass@db.example.com:5432/chaptr_test?ssl=true";
    expect(getDatabaseHost(url)).toBe("db.example.com/chaptr_test");
  });

  it("returns hostname only when database path is empty or single slash", () => {
    expect(getDatabaseHost("postgresql://user:pass@db.example.com:5432/")).toBe(
      "db.example.com"
    );
  });

  it("returns unknown for undefined, empty string, or whitespace", () => {
    expect(getDatabaseHost(undefined)).toBe("unknown");
    expect(getDatabaseHost("")).toBe("unknown");
    expect(getDatabaseHost("   ")).toBe("unknown");
  });

  it("returns invalid-url for malformed URLs", () => {
    expect(getDatabaseHost("not a valid url")).toBe("invalid-url");
  });
});

describe("getDatabaseName", () => {
  it("extracts database name from pathname", () => {
    expect(
      getDatabaseName("postgresql://user:pass@host:5432/neondb_test?ssl=true")
    ).toBe("neondb_test");
  });

  it("returns empty string when no database name exists", () => {
    expect(getDatabaseName("postgresql://user:pass@host:5432/")).toBe("");
    expect(getDatabaseName("")).toBe("");
    expect(getDatabaseName(undefined)).toBe("");
  });
});

describe("validateTestDatabaseEnv", () => {
  const realDb = "postgresql://user:pass@host:5432/neondb";

  it("same host with different db names passes (when test db contains 'test')", () => {
    const normalOnHost = "postgresql://user:pass@shared-host.neon.tech:5432/neondb";
    const testOnHost = "postgresql://user:pass@shared-host.neon.tech:5432/neondb_test";
    expect(() => validateTestDatabaseEnv(normalOnHost, testOnHost)).not.toThrow();
  });

  it("same db name fails (even on different host)", () => {
    const db1 = "postgresql://user:pass@host1.neon.tech:5432/neondb_test";
    const db2 = "postgresql://user:pass@host2.neon.tech:5432/neondb_test";
    expect(() => validateTestDatabaseEnv(db1, db2)).toThrow(
      'DATABASE_URL_TEST database name ("neondb_test") is identical to normal database name ("neondb_test")'
    );
  });

  it("same db name fails on same host", () => {
    const db1 = "postgresql://user:pass@shared-host.neon.tech:5432/neondb_test";
    const db2 = "postgresql://user:pass@shared-host.neon.tech:5432/neondb_test";
    expect(() => validateTestDatabaseEnv(db1, db2)).toThrow(
      "DATABASE_URL_TEST is identical to normal DATABASE_URL"
    );
  });

  it("a test db name without 'test' fails", () => {
    const normal = "postgresql://user:pass@host:5432/neondb";
    const nonTestDb = "postgresql://user:pass@host:5432/neondb_staging";
    expect(() => validateTestDatabaseEnv(normal, nonTestDb)).toThrow(
      'DATABASE_URL_TEST database name ("neondb_staging") must contain "test" (case-insensitive)'
    );
  });

  it("case-insensitive test db name passes (e.g. TEST_DB or Neon_Test)", () => {
    const normal = "postgresql://user:pass@host:5432/neondb";
    const testUpper = "postgresql://user:pass@host:5432/neondb_TEST";
    expect(() => validateTestDatabaseEnv(normal, testUpper)).not.toThrow();
  });

  it("throws a clear error when testDatabaseUrl is undefined", () => {
    expect(() => validateTestDatabaseEnv(realDb, undefined)).toThrow(
      "Playwright E2E tests refused to start: DATABASE_URL_TEST is not set"
    );
  });

  it("throws a clear error when testDatabaseUrl is empty string or whitespace", () => {
    expect(() => validateTestDatabaseEnv(realDb, "")).toThrow(
      "Playwright E2E tests refused to start: DATABASE_URL_TEST is not set"
    );
    expect(() => validateTestDatabaseEnv(realDb, "   ")).toThrow(
      "Playwright E2E tests refused to start: DATABASE_URL_TEST is not set"
    );
  });

  it("throws when test database name is missing", () => {
    const noDbName = "postgresql://user:pass@host:5432/";
    expect(() => validateTestDatabaseEnv(realDb, noDbName)).toThrow(
      'DATABASE_URL_TEST database name ("") must contain "test"'
    );
  });
});

describe("validateMigrationEnv", () => {
  const realDb = "postgresql://user:pass@ep-prod-pooler.neon.tech:5432/neondb";
  const realDirect = "postgresql://user:pass@ep-prod.neon.tech:5432/neondb";
  const testDbPooler = "postgresql://user:pass@ep-test-pooler.neon.tech:5432/neondb_test";
  const testDirect = "postgresql://user:pass@ep-test.neon.tech:5432/neondb_test";

  it("throws when DATABASE_URL_TEST is missing or whitespace-only", () => {
    expect(() =>
      validateMigrationEnv(realDb, undefined, realDirect, testDirect)
    ).toThrow("DATABASE_URL_TEST is not set");
    expect(() =>
      validateMigrationEnv(realDb, "   ", realDirect, testDirect)
    ).toThrow("DATABASE_URL_TEST is not set");
  });

  it("throws when DIRECT_URL_TEST is missing or whitespace-only", () => {
    expect(() =>
      validateMigrationEnv(realDb, testDbPooler, realDirect, undefined)
    ).toThrow("DIRECT_URL_TEST is not set");
    expect(() =>
      validateMigrationEnv(realDb, testDbPooler, realDirect, "   ")
    ).toThrow("DIRECT_URL_TEST is not set");
  });

  it("throws when DATABASE_URL_TEST is identical to normal DATABASE_URL", () => {
    expect(() =>
      validateMigrationEnv(realDb, realDb, realDirect, testDirect)
    ).toThrow("DATABASE_URL_TEST is identical to normal DATABASE_URL");
  });

  it("throws when DIRECT_URL_TEST is identical to normal DIRECT_URL", () => {
    expect(() =>
      validateMigrationEnv(realDb, testDbPooler, realDirect, realDirect)
    ).toThrow("DIRECT_URL_TEST is identical to normal DIRECT_URL");
  });

  it("throws when test db name does not contain test", () => {
    const stagingDb = "postgresql://user:pass@ep-test-pooler.neon.tech:5432/neondb_staging";
    const stagingDirect = "postgresql://user:pass@ep-test.neon.tech:5432/neondb_staging";
    expect(() =>
      validateMigrationEnv(realDb, stagingDb, realDirect, stagingDirect)
    ).toThrow('DATABASE_URL_TEST database name ("neondb_staging") must contain "test"');
  });

  it("throws when direct URL has the normal DB name", () => {
    const directNormalDb = "postgresql://user:pass@ep-test.neon.tech:5432/neondb";
    expect(() =>
      validateMigrationEnv(realDb, testDbPooler, realDirect, directNormalDb)
    ).toThrow('DIRECT_URL_TEST database name ("neondb") must contain "test"');
  });

  it("throws when direct URL with test keyword is identical to normal DB name", () => {
    const normalWithTest = "postgresql://user:pass@ep-prod.neon.tech:5432/neondb_test";
    const directWithNormal = "postgresql://user:pass@ep-test.neon.tech:5432/neondb_test";
    expect(() =>
      validateMigrationEnv(normalWithTest, testDbPooler, normalWithTest, directWithNormal)
    ).toThrow('DATABASE_URL_TEST database name ("neondb_test") is identical to normal database name');
  });

  it("throws when test DB names differ between DATABASE_URL_TEST and DIRECT_URL_TEST", () => {
    const diffDbDirect = "postgresql://user:pass@ep-test.neon.tech:5432/other_test";
    expect(() =>
      validateMigrationEnv(realDb, testDbPooler, realDirect, diffDbDirect)
    ).toThrow(
      'DIRECT_URL_TEST database name ("other_test") does not match DATABASE_URL_TEST database name ("neondb_test")'
    );
  });

  it("throws when hosts do not match after stripping -pooler suffix", () => {
    const mismatchedDirect = "postgresql://user:pass@ep-different.neon.tech:5432/neondb_test";
    expect(() =>
      validateMigrationEnv(realDb, testDbPooler, realDirect, mismatchedDirect)
    ).toThrow("do not point to the same host");
  });

  it("a correct pair passes (pooler host and direct host matching after removing -pooler)", () => {
    expect(() =>
      validateMigrationEnv(realDb, testDbPooler, realDirect, testDirect)
    ).not.toThrow();
  });
});

