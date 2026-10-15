/**
 * Safely extracts the database name from a connection string URL.
 * e.g., "postgresql://user:pass@host:5432/my_db?ssl=true" -> "my_db"
 */
export function getDatabaseName(urlStr?: string): string {
  if (!urlStr || typeof urlStr !== "string" || urlStr.trim() === "") {
    return "";
  }
  try {
    const parsed = new URL(urlStr);
    const pathname = parsed.pathname.replace(/^\/+/, "");
    return pathname.split("/")[0] || "";
  } catch {
    return "";
  }
}

/**
 * Safely extracts only the database hostname and database name from a connection string URL.
 * e.g., "postgresql://user:pass@host:5432/my_db?ssl=true" -> "host/my_db"
 * Strips usernames, passwords, ports, and query parameters.
 */
export function getDatabaseHostAndName(urlStr?: string): string {
  if (!urlStr || typeof urlStr !== "string" || urlStr.trim() === "") {
    return "unknown";
  }
  try {
    const parsed = new URL(urlStr);
    const host = parsed.hostname || "unknown";
    const dbname = getDatabaseName(urlStr);
    return dbname ? `${host}/${dbname}` : host;
  } catch {
    return "invalid-url";
  }
}

/**
 * Backwards-compatible alias for getDatabaseHostAndName.
 * Returns "host/dbname" (or "host" if dbname is empty) with no credentials or query parameters.
 */
export function getDatabaseHost(urlStr?: string): string {
  return getDatabaseHostAndName(urlStr);
}

/**
 * Validates that an isolated test database is configured for E2E and integration tests.
 * Requirements:
 * 1. DATABASE_URL_TEST must be defined and non-empty.
 * 2. DATABASE_URL_TEST must not be identical to normal DATABASE_URL.
 * 3. The test URL's database name must differ from the normal URL's database name.
 * 4. The test URL's database name must contain "test" (case-insensitive).
 */
export function validateTestDatabaseEnv(
  normalDatabaseUrl?: string,
  testDatabaseUrl?: string
): void {
  if (!testDatabaseUrl || testDatabaseUrl.trim() === "") {
    throw new Error(
      "Playwright E2E tests refused to start: DATABASE_URL_TEST is not set. Please define DATABASE_URL_TEST in .env pointing to an isolated test database."
    );
  }

  if (normalDatabaseUrl && testDatabaseUrl.trim() === normalDatabaseUrl.trim()) {
    throw new Error(
      "Playwright E2E tests refused to start: DATABASE_URL_TEST is identical to normal DATABASE_URL. E2E tests must never run against the real dev/prod database."
    );
  }

  const testDbName = getDatabaseName(testDatabaseUrl);
  if (!testDbName || !testDbName.toLowerCase().includes("test")) {
    throw new Error(
      `Playwright E2E tests refused to start: DATABASE_URL_TEST database name ("${testDbName}") must contain "test" (case-insensitive).`
    );
  }

  const normalDbName = getDatabaseName(normalDatabaseUrl);
  if (normalDbName && testDbName.toLowerCase() === normalDbName.toLowerCase()) {
    throw new Error(
      `Playwright E2E tests refused to start: DATABASE_URL_TEST database name ("${testDbName}") is identical to normal database name ("${normalDbName}"). E2E tests must use a distinct test database.`
    );
  }
}

/**
 * Validates environment variables for test migrations.
 * Refuses to run if either DATABASE_URL_TEST or DIRECT_URL_TEST is missing, identical to normal URLs,
 * or does not contain "test" in the database name.
 */
export function validateMigrationEnv(
  normalDatabaseUrl?: string,
  testDatabaseUrl?: string,
  normalDirectUrl?: string,
  testDirectUrl?: string
): void {
  if (!testDatabaseUrl || testDatabaseUrl.trim() === "") {
    throw new Error(
      "Migration refused to run: DATABASE_URL_TEST is not set. Please define DATABASE_URL_TEST in .env pointing to an isolated test database."
    );
  }

  if (!testDirectUrl || testDirectUrl.trim() === "") {
    throw new Error(
      "Migration refused to run: DIRECT_URL_TEST is not set. Please define DIRECT_URL_TEST in .env pointing to the test database direct URL."
    );
  }

  if (normalDatabaseUrl && testDatabaseUrl.trim() === normalDatabaseUrl.trim()) {
    throw new Error(
      "Migration refused to run: DATABASE_URL_TEST is identical to normal DATABASE_URL. Migrations must never be applied to the dev/prod database using the test command."
    );
  }

  if (normalDirectUrl && testDirectUrl.trim() === normalDirectUrl.trim()) {
    throw new Error(
      "Migration refused to run: DIRECT_URL_TEST is identical to normal DIRECT_URL. Migrations must never be applied to the dev/prod database using the test command."
    );
  }

  const testDbName = getDatabaseName(testDatabaseUrl);
  if (!testDbName || !testDbName.toLowerCase().includes("test")) {
    throw new Error(
      `Migration refused to run: DATABASE_URL_TEST database name ("${testDbName}") must contain "test" (case-insensitive).`
    );
  }

  const normalDbName = getDatabaseName(normalDatabaseUrl);
  if (normalDbName && testDbName.toLowerCase() === normalDbName.toLowerCase()) {
    throw new Error(
      `Migration refused to run: DATABASE_URL_TEST database name ("${testDbName}") is identical to normal database name ("${normalDbName}").`
    );
  }
}
