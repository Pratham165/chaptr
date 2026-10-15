/**
 * @file scripts/lib/test-env.mjs
 * Shared validation and helper utilities for test databases and test migrations.
 */

/**
 * Safely extracts the database name from a connection string URL.
 * e.g., "postgresql://user:pass@host:5432/my_db?ssl=true" -> "my_db"
 * @param {string} [urlStr]
 * @returns {string}
 */
export function getDatabaseName(urlStr) {
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
 * Normalizes a database host for comparison by lowercasing and stripping any "-pooler" suffix.
 * e.g., "ep-xyz-pooler.c-4.aws.neon.tech" -> "ep-xyz.c-4.aws.neon.tech"
 * @param {string} [urlStr]
 * @returns {string}
 */
export function getNormalizedHost(urlStr) {
  if (!urlStr || typeof urlStr !== "string" || urlStr.trim() === "") {
    return "";
  }
  try {
    const parsed = new URL(urlStr);
    const hostname = (parsed.hostname || "").toLowerCase();
    return hostname.replace(/-pooler(?=\.|$)/g, "");
  } catch {
    return "";
  }
}

/**
 * Safely extracts only the database hostname and database name from a connection string URL.
 * Strips usernames, passwords, ports, and query parameters.
 * @param {string} [urlStr]
 * @returns {string}
 */
export function getDatabaseHostAndName(urlStr) {
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
 * @param {string} [urlStr]
 * @returns {string}
 */
export function getDatabaseHost(urlStr) {
  return getDatabaseHostAndName(urlStr);
}

/**
 * Validates that an isolated test database is configured for E2E and integration tests.
 * @param {string} [normalDatabaseUrl]
 * @param {string} [testDatabaseUrl]
 */
export function validateTestDatabaseEnv(normalDatabaseUrl, testDatabaseUrl) {
  const normalDb = normalDatabaseUrl?.trim();
  const testDb = testDatabaseUrl?.trim();

  if (!testDb) {
    throw new Error(
      "Playwright E2E tests refused to start: DATABASE_URL_TEST is not set. Please define DATABASE_URL_TEST in .env pointing to an isolated test database."
    );
  }

  if (normalDb && testDb === normalDb) {
    throw new Error(
      "Playwright E2E tests refused to start: DATABASE_URL_TEST is identical to normal DATABASE_URL. E2E tests must never run against the real dev/prod database."
    );
  }

  const testDbName = getDatabaseName(testDb);
  if (!testDbName || !testDbName.toLowerCase().includes("test")) {
    throw new Error(
      `Playwright E2E tests refused to start: DATABASE_URL_TEST database name ("${testDbName}") must contain "test" (case-insensitive).`
    );
  }

  const normalDbName = getDatabaseName(normalDb);
  if (normalDbName && testDbName.toLowerCase() === normalDbName.toLowerCase()) {
    throw new Error(
      `Playwright E2E tests refused to start: DATABASE_URL_TEST database name ("${testDbName}") is identical to normal database name ("${normalDbName}"). E2E tests must use a distinct test database.`
    );
  }
}

/**
 * Validates environment variables for test migrations.
 * Refuses to run if either DATABASE_URL_TEST or DIRECT_URL_TEST is missing, identical to normal URLs,
 * does not contain "test" in the database name, has different test database names, or points at different hosts.
 * @param {string} [normalDatabaseUrl]
 * @param {string} [testDatabaseUrl]
 * @param {string} [normalDirectUrl]
 * @param {string} [testDirectUrl]
 */
export function validateMigrationEnv(
  normalDatabaseUrl,
  testDatabaseUrl,
  normalDirectUrl,
  testDirectUrl
) {
  const normalDb = normalDatabaseUrl?.trim();
  const testDb = testDatabaseUrl?.trim();
  const normalDirect = normalDirectUrl?.trim();
  const testDirect = testDirectUrl?.trim();

  if (!testDb) {
    throw new Error(
      "Migration refused to run: DATABASE_URL_TEST is not set. Please define DATABASE_URL_TEST in .env pointing to an isolated test database."
    );
  }

  if (!testDirect) {
    throw new Error(
      "Migration refused to run: DIRECT_URL_TEST is not set. Please define DIRECT_URL_TEST in .env pointing to the test database direct URL."
    );
  }

  if (normalDb && testDb === normalDb) {
    throw new Error(
      "Migration refused to run: DATABASE_URL_TEST is identical to normal DATABASE_URL. Migrations must never be applied to the dev/prod database using the test command."
    );
  }

  if (normalDirect && testDirect === normalDirect) {
    throw new Error(
      "Migration refused to run: DIRECT_URL_TEST is identical to normal DIRECT_URL. Migrations must never be applied to the dev/prod database using the test command."
    );
  }

  const testDbName = getDatabaseName(testDb);
  if (!testDbName || !testDbName.toLowerCase().includes("test")) {
    throw new Error(
      `Migration refused to run: DATABASE_URL_TEST database name ("${testDbName}") must contain "test" (case-insensitive).`
    );
  }

  const normalDbName = getDatabaseName(normalDb);
  if (normalDbName && testDbName.toLowerCase() === normalDbName.toLowerCase()) {
    throw new Error(
      `Migration refused to run: DATABASE_URL_TEST database name ("${testDbName}") is identical to normal database name ("${normalDbName}").`
    );
  }

  // DIRECT_URL_TEST database name validation
  const testDirectDbName = getDatabaseName(testDirect);
  if (!testDirectDbName || !testDirectDbName.toLowerCase().includes("test")) {
    throw new Error(
      `Migration refused to run: DIRECT_URL_TEST database name ("${testDirectDbName}") must contain "test" (case-insensitive).`
    );
  }

  const normalDirectDbName = getDatabaseName(normalDirect) || normalDbName;
  if (normalDirectDbName && testDirectDbName.toLowerCase() === normalDirectDbName.toLowerCase()) {
    throw new Error(
      `Migration refused to run: DIRECT_URL_TEST database name ("${testDirectDbName}") is identical to normal database name ("${normalDirectDbName}").`
    );
  }

  if (testDirectDbName.toLowerCase() !== testDbName.toLowerCase()) {
    throw new Error(
      `Migration refused to run: DIRECT_URL_TEST database name ("${testDirectDbName}") does not match DATABASE_URL_TEST database name ("${testDbName}").`
    );
  }

  // Host comparison after stripping "-pooler" suffix
  const testHost = getNormalizedHost(testDb);
  const testDirectHost = getNormalizedHost(testDirect);
  if (!testHost || !testDirectHost || testHost !== testDirectHost) {
    throw new Error(
      `Migration refused to run: DATABASE_URL_TEST host ("${testHost}") and DIRECT_URL_TEST host ("${testDirectHost}") do not point to the same host.`
    );
  }
}
