import { db } from "../src/lib/db";
import { getDatabaseHost } from "../src/lib/test-env";

/**
 * Playwright Global Teardown.
 * Runs once after all E2E test suites have completed.
 *
 * Safety Guards:
 * - Re-runs the database isolation guard before any delete:
 *   process.env.DATABASE_URL must equal DATABASE_URL_TEST and differ from normal DATABASE_URL.
 *   If not, aborts immediately without deleting anything.
 *
 * Scoped Deletions:
 * - Narrowed strictly to rows carrying e2e markers only:
 *   - Users with email matching e2e-*@example.test
 *   - Series with title starting with "E2E" or mangadexId starting with "e2e-"
 *   - Associated ReadingProgress records for those e2e users or series.
 * - No generic untracked or orphaned series deletion.
 */
export default async function globalTeardown() {
  const currentDbUrl = process.env.DATABASE_URL;
  const testDbUrl = process.env.DATABASE_URL_TEST;
  const normalDbUrl = process.env.ORIGINAL_DATABASE_URL;

  console.log("\n[Playwright Global Teardown] Verifying test database guard before teardown...");
  console.log(`[Playwright Global Teardown] Database host: ${getDatabaseHost(currentDbUrl)}`);

  // Guard: Current DB must be set, must equal DATABASE_URL_TEST, and must differ from normal DATABASE_URL
  if (!testDbUrl || !currentDbUrl || currentDbUrl.trim() !== testDbUrl.trim()) {
    console.error(
      "[Playwright Global Teardown] ABORTED: Database in use does not match DATABASE_URL_TEST. No rows were deleted."
    );
    throw new Error(
      "Global teardown aborted: active database does not match DATABASE_URL_TEST"
    );
  }

  if (normalDbUrl && currentDbUrl.trim() === normalDbUrl.trim()) {
    console.error(
      "[Playwright Global Teardown] ABORTED: Database in use is identical to normal DATABASE_URL. No rows were deleted."
    );
    throw new Error(
      "Global teardown aborted: active database is identical to normal DATABASE_URL"
    );
  }

  try {
    // 1. Delete reading progress for any E2E-marked user or E2E-marked series only
    const deletedProgress = await db.readingProgress.deleteMany({
      where: {
        OR: [
          {
            user: {
              email: {
                startsWith: "e2e-",
                endsWith: "@example.test",
              },
            },
          },
          { series: { title: { startsWith: "E2E" } } },
          { series: { mangadexId: { startsWith: "e2e-" } } },
        ],
      },
    });

    // 2. Delete all series with E2E markers only (no generic untracked/orphan cleanup)
    const deletedSeries = await db.series.deleteMany({
      where: {
        OR: [
          { title: { startsWith: "E2E" } },
          { mangadexId: { startsWith: "e2e-" } },
        ],
      },
    });

    // 3. Delete all users with e2e markers (email like e2e-*@example.test)
    const deletedUsers = await db.user.deleteMany({
      where: {
        AND: [
          { email: { startsWith: "e2e-" } },
          { email: { endsWith: "@example.test" } },
        ],
      },
    });

    console.log(
      `[Playwright Global Teardown] Cleaned up: ${deletedProgress.count} progress rows, ${deletedSeries.count} series, and ${deletedUsers.count} users.`
    );
  } catch (err: unknown) {
    console.error("[Playwright Global Teardown] Error during teardown:", err);
    throw err;
  } finally {
    await db.$disconnect();
  }
}
