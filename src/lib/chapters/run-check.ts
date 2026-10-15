import crypto from "crypto";
import { db } from "@/lib/db";
import { redis, REDIS_KEY_PREFIX } from "@/lib/redis";
import { MangaDexRateLimitError } from "@/lib/mangadex";
import { fetchLatestChapter } from "./fetch-latest";

export interface RunChapterCheckOptions {
  batchSize?: number;
  timeBudgetMs?: number;
}

export interface ChapterCheckSummary {
  checked: number;
  updated: number;
  failed: number;
  skippedLocked: boolean;
  stoppedEarly: boolean;
}

const REDIS_LOCK_KEY = `${REDIS_KEY_PREFIX}lock:chapter-check`;
const DEFAULT_BATCH_SIZE = 30;
const DEFAULT_TIME_BUDGET_MS = 7000;
const LOCK_BUFFER_MS = 2000;
const MIN_REMAINING_BUFFER_MS = 1500;

// Lua script to safely release distributed lock only if token matches
const RELEASE_LOCK_SCRIPT = `
if redis.call("get", KEYS[1]) == ARGV[1] then
  return redis.call("del", KEYS[1])
else
  return 0
end
`;

async function releaseLock(token: string): Promise<void> {
  try {
    if (typeof redis.eval === "function") {
      await redis.eval(RELEASE_LOCK_SCRIPT, [REDIS_LOCK_KEY], [token]);
    } else {
      const current = await redis.get<string>(REDIS_LOCK_KEY);
      if (current === token) {
        await redis.del(REDIS_LOCK_KEY);
      }
    }
  } catch (releaseErr) {
    console.warn("Failed to release chapter-check Redis lock:", releaseErr);
  }
}

/**
 * Background runner that checks MangaDex for new chapters across tracked series.
 *
 * Guarantees:
 * - Lock Safety: Unique per-run token (crypto.randomUUID()). Released only if stored token matches.
 * - Redis Error Distinction: If redis.set throws, logs console.error and lets error propagate (no false skippedLocked).
 * - Deadline Enforcement: Computes deadline at start. Stops before each series if < ~1500ms remain.
 *   Passes remaining time down so outbound requests use AbortSignal.timeout(Math.min(8000, remaining))
 *   and rate-limit waits never sleep past the deadline. Default budget 7000ms.
 * - Flag Consistency: After every successful fetch where a latest chapter is known (new or stored),
 *   runs updateMany for ReadingProgress rows with status in (READING, ON_HOLD), lastReadChapter < latest,
 *   hasUpdate false, self-healing missed flags even when latestChapter is unchanged.
 * - Rate-Limit Handling: On MangaDexRateLimitError, does NOT update series lastCheckedAt and counts
 *   it as stoppedEarly (not as failed). Genuine errors update lastCheckedAt and increment failed.
 */
export async function runChapterCheck(
  options: RunChapterCheckOptions = {}
): Promise<ChapterCheckSummary> {
  const batchSize = Math.max(1, options.batchSize ?? DEFAULT_BATCH_SIZE);
  const timeBudgetMs = Math.max(1000, options.timeBudgetMs ?? DEFAULT_TIME_BUDGET_MS);
  const lockTtlMs = timeBudgetMs + LOCK_BUFFER_MS;
  const lockToken = crypto.randomUUID();

  // 1. Acquire Redis distributed lock with unique per-run token
  let lockAcquired = false;
  try {
    const lockResult = await redis.set(REDIS_LOCK_KEY, lockToken, {
      nx: true,
      px: lockTtlMs,
    });
    lockAcquired = lockResult === "OK";
  } catch (redisErr) {
    // Distinguish "lock held" from "Redis error": log and let error propagate
    console.error("Redis error acquiring chapter-check lock:", redisErr);
    throw redisErr;
  }

  if (!lockAcquired) {
    console.log("Chapter check skipped: lock already held by another runner.");
    return {
      checked: 0,
      updated: 0,
      failed: 0,
      skippedLocked: true,
      stoppedEarly: false,
    };
  }

  const startTime = Date.now();
  const deadline = startTime + timeBudgetMs;
  let checked = 0;
  let updated = 0;
  let failed = 0;
  let stoppedEarly = false;

  try {
    // 2. Select tracked series, ordered stalest first (NULLs first)
    const seriesBatch = await db.series.findMany({
      where: {
        trackedBy: {
          some: {},
        },
      },
      orderBy: {
        lastCheckedAt: {
          sort: "asc",
          nulls: "first",
        },
      },
      take: batchSize,
    });

    // 3. Process batch sequentially with deadline enforcement
    for (const series of seriesBatch) {
      const remainingMs = deadline - Date.now();
      if (remainingMs < MIN_REMAINING_BUFFER_MS) {
        stoppedEarly = true;
        break;
      }

      try {
        checked++;
        const latestChapter = await fetchLatestChapter(series.mangadexId, {
          timeoutMs: Math.min(8000, remainingMs),
          deadline,
        });
        const now = new Date();

        const shouldBumpLatest =
          latestChapter !== null &&
          (series.latestChapter === null || latestChapter > series.latestChapter);

        const knownLatest = shouldBumpLatest ? latestChapter : series.latestChapter;

        // Atomic update: bump latestChapter (if higher) and update lastCheckedAt
        const operations: Array<ReturnType<typeof db.series.update> | ReturnType<typeof db.readingProgress.updateMany>> = [
          db.series.update({
            where: { id: series.id },
            data: {
              ...(shouldBumpLatest ? { latestChapter } : {}),
              lastCheckedAt: now,
            },
          }),
        ];

        // Self-heal: If latest chapter is known (new or unchanged/stored), flag unflagged reading progresses
        if (knownLatest !== null) {
          operations.push(
            db.readingProgress.updateMany({
              where: {
                seriesId: series.id,
                status: { in: ["READING", "ON_HOLD"] },
                lastReadChapter: { lt: knownLatest },
                hasUpdate: false,
              },
              data: {
                hasUpdate: true,
              },
            })
          );
        }

        await db.$transaction(operations);

        if (shouldBumpLatest) {
          updated++;
        }
      } catch (err: unknown) {
        if (err instanceof MangaDexRateLimitError) {
          // When a series fails with MangaDexRateLimitError:
          // Do NOT update its lastCheckedAt (it wasn't actually checked).
          // Count it as stoppedEarly, NOT as failed.
          stoppedEarly = true;
          break;
        }

        // Genuine per-series failures: count as failed and update lastCheckedAt to prevent starvation
        failed++;
        const errorMessage = err instanceof Error ? err.message : String(err);
        console.error(
          `Series check failed: id=${series.id}, mangadexId=${series.mangadexId}, error=${errorMessage}`
        );

        try {
          await db.series.update({
            where: { id: series.id },
            data: {
              lastCheckedAt: new Date(),
            },
          });
        } catch {
          // Best-effort timestamp update
        }
      }
    }
  } finally {
    // Release distributed lock safely only if this run's token matches
    await releaseLock(lockToken);
  }

  // Log a one-line summary per run (no secrets, no full response bodies)
  console.log(
    `Chapter check completed: checked=${checked}, updated=${updated}, failed=${failed}, skippedLocked=false, stoppedEarly=${stoppedEarly}`
  );

  return {
    checked,
    updated,
    failed,
    skippedLocked: false,
    stoppedEarly,
  };
}
