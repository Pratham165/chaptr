import { defineConfig, devices } from "@playwright/test";
import { loadEnvConfig } from "@next/env";
import { validateTestDatabaseEnv, getDatabaseHost } from "./src/lib/test-env";

// Load environment variables (.env, .env.local, etc.)
loadEnvConfig(process.cwd());

// Preserve original normal DATABASE_URL before overriding so worker processes don't compare against overridden value
const normalDatabaseUrl = process.env.ORIGINAL_DATABASE_URL || process.env.DATABASE_URL;
if (!process.env.ORIGINAL_DATABASE_URL && process.env.DATABASE_URL) {
  process.env.ORIGINAL_DATABASE_URL = process.env.DATABASE_URL;
}

const testDatabaseUrl = process.env.DATABASE_URL_TEST;
const testDirectUrl = process.env.DIRECT_URL_TEST;

// Enforce test database isolation:
// Refuse to run if DATABASE_URL_TEST is missing or identical to normal DATABASE_URL
validateTestDatabaseEnv(normalDatabaseUrl, testDatabaseUrl);

// Override DATABASE_URL and DIRECT_URL in the test runner process so any spec importing db connects to the test DB
process.env.DATABASE_URL = testDatabaseUrl!;
if (testDirectUrl) {
  process.env.DIRECT_URL = testDirectUrl;
}
process.env.REDIS_KEY_PREFIX = "e2e:";

// Log ONLY the database hostname in the Playwright runner (no credentials, usernames, or paths)
console.log(`[Playwright Runner] Database host: ${getDatabaseHost(testDatabaseUrl)}`);

export default defineConfig({
  testDir: "./e2e",
  globalTeardown: "./e2e/global-teardown.ts",
  timeout: 60000,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 1,
  reporter: "list",
  use: {
    baseURL: process.env.PLAYWRIGHT_TEST_BASE_URL || "http://localhost:3000",
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    command: "node scripts/start-test-server.mjs",
    url: "http://localhost:3000",
    reuseExistingServer: false,
    timeout: 120 * 1000,
    stdout: "pipe",
    env: {
      AUTH_TRUST_HOST: "true",
      NEXTAUTH_URL: "http://localhost:3000",
      DATABASE_URL: testDatabaseUrl as string,
      REDIS_KEY_PREFIX: "e2e:",
      ...(testDirectUrl ? { DIRECT_URL: testDirectUrl } : {}),
    },
  },
});
