import nextEnv from "@next/env";
const { loadEnvConfig } = nextEnv;
import { spawnSync } from "node:child_process";
import process from "node:process";
import { validateMigrationEnv, getDatabaseHostAndName } from "./lib/test-env.mjs";

// 1. Load environment variables (.env, .env.local, etc.)
loadEnvConfig(process.cwd());

const normalDb = process.env.DATABASE_URL;
const normalDirect = process.env.DIRECT_URL;
const testDb = process.env.DATABASE_URL_TEST;
const testDirect = process.env.DIRECT_URL_TEST;

// 2. Validate test database environment variables using shared validator
try {
  validateMigrationEnv(normalDb, testDb, normalDirect, testDirect);
} catch (err) {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
}

// 3. Extract and log ONLY database hostname and database name (no credentials or paths)
const testHostAndDb = getDatabaseHostAndName(testDb);
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
    DATABASE_URL: testDb.trim(),
    DIRECT_URL: testDirect.trim(),
  },
});

if (result.error) {
  console.error(result.error);
}

process.exit(result.status !== null ? result.status : 1);
