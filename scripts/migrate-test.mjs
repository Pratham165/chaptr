import nextEnv from "@next/env";
const { loadEnvConfig } = nextEnv;
import { spawnSync } from "node:child_process";
import process from "node:process";

// 1. Load environment variables (.env, .env.local, etc.)
loadEnvConfig(process.cwd());

const normalDb = process.env.DATABASE_URL;
const normalDirect = process.env.DIRECT_URL;
const testDb = process.env.DATABASE_URL_TEST;
const testDirect = process.env.DIRECT_URL_TEST;

// 2. Validate test database environment variables
if (!testDb || testDb.trim() === "") {
  console.error(
    "Migration aborted: DATABASE_URL_TEST is not set in environment or .env."
  );
  process.exit(1);
}

if (!testDirect) {
  console.error(
    "Migration aborted: DIRECT_URL_TEST is not set in environment or .env."
  );
  process.exit(1);
}

if (normalDb && testDb.trim() === normalDb.trim()) {
  console.error(
    "Migration aborted: DATABASE_URL_TEST is identical to normal DATABASE_URL. Refusing to run migrations on dev/prod database."
  );
  process.exit(1);
}

if (normalDirect && testDirect.trim() === normalDirect.trim()) {
  console.error(
    "Migration aborted: DIRECT_URL_TEST is identical to normal DIRECT_URL. Refusing to run migrations on dev/prod database."
  );
  process.exit(1);
}

function getDbName(urlStr) {
  if (!urlStr) return "";
  try {
    const parsed = new URL(urlStr);
    return parsed.pathname.replace(/^\/+/, "").split("/")[0] || "";
  } catch {
    return "";
  }
}

const testDbName = getDbName(testDb);
const normalDbName = getDbName(normalDb);

if (!testDbName || !testDbName.toLowerCase().includes("test")) {
  console.error(
    `Migration aborted: DATABASE_URL_TEST database name ("${testDbName}") must contain "test" (case-insensitive).`
  );
  process.exit(1);
}

if (normalDbName && testDbName.toLowerCase() === normalDbName.toLowerCase()) {
  console.error(
    `Migration aborted: DATABASE_URL_TEST database name ("${testDbName}") is identical to normal database name ("${normalDbName}").`
  );
  process.exit(1);
}

// 3. Extract and log ONLY database hostname and database name (no credentials or paths)
let testHostAndDb = "unknown";
try {
  const parsed = new URL(testDb);
  const host = parsed.hostname || "unknown";
  testHostAndDb = testDbName ? `${host}/${testDbName}` : host;
} catch {
  testHostAndDb = "invalid-url";
}

console.log(
  `[db:migrate:test] Deploying migrations to test database: ${testHostAndDb}`
);

// 4. Run `prisma migrate deploy` with overridden connection strings for child process only
const isWindows = process.platform === "win32";
const executable = isWindows ? "npx.cmd" : "npx";
const args = ["prisma", "migrate", "deploy"];

const result = spawnSync(executable, args, {
  stdio: "inherit",
  shell: isWindows,
  env: {
    ...process.env,
    DATABASE_URL: testDb,
    DIRECT_URL: testDirect,
  },
});

process.exit(result.status ?? 0);
