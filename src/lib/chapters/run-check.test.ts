import { describe, it, expect, vi, beforeEach } from "vitest";
import { runChapterCheck } from "./run-check";
import { db } from "@/lib/db";
import { redis } from "@/lib/redis";
import { fetchLatestChapter } from "./fetch-latest";
import { MangaDexRateLimitError } from "@/lib/mangadex";
import type { Series } from "@prisma/client";

// Mock db
vi.mock("@/lib/db", () => ({
  db: {
    series: {
      findMany: vi.fn(),
      update: vi.fn(),
    },
    readingProgress: {
      updateMany: vi.fn(),
    },
    $transaction: vi.fn((operations) => Promise.all(operations)),
  },
}));

// Mock redis
vi.mock("@/lib/redis", () => ({
  REDIS_KEY_PREFIX: "",
  redis: {
    set: vi.fn(),
    del: vi.fn(),
    eval: vi.fn(),
    get: vi.fn(),
  },
}));

// Mock fetchLatestChapter
vi.mock("./fetch-latest", () => ({
  fetchLatestChapter: vi.fn(),
}));

describe("Chapter Check Runner (runChapterCheck)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: acquire lock successfully
    vi.mocked(redis.set).mockResolvedValue("OK");
    vi.mocked(redis.del).mockResolvedValue(1);
    vi.mocked(redis.eval).mockResolvedValue(1);
  });

  describe("Redis Distributed Lock & Error Differentiation", () => {
    it("skips the run immediately when lock is already held", async () => {
      vi.mocked(redis.set).mockResolvedValue(null); // Lock held by another runner

      const result = await runChapterCheck();

      expect(result).toEqual({
        checked: 0,
        updated: 0,
        failed: 0,
        skippedLocked: true,
        stoppedEarly: false,
      });

      expect(db.series.findMany).not.toHaveBeenCalled();
      expect(redis.del).not.toHaveBeenCalled();
      expect(redis.eval).not.toHaveBeenCalled();
    });

    it("propagates Redis error and does NOT return skippedLocked when redis.set throws", async () => {
      vi.mocked(redis.set).mockRejectedValue(new Error("Redis connection dropped"));
      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      await expect(runChapterCheck()).rejects.toThrow("Redis connection dropped");

      expect(errorSpy).toHaveBeenCalled();
      expect(db.series.findMany).not.toHaveBeenCalled();
    });

    it("acquires lock with unique token and releases safely with token matching in finally block", async () => {
      vi.mocked(db.series.findMany).mockResolvedValue([]);

      const result = await runChapterCheck();

      expect(result.skippedLocked).toBe(false);

      // Verify set was called with NX, PX, and a random UUID token
      expect(redis.set).toHaveBeenCalledWith(
        "lock:chapter-check",
        expect.stringMatching(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i),
        expect.objectContaining({ nx: true })
      );

      // Verify eval was called to release with matching token
      expect(redis.eval).toHaveBeenCalledWith(
        expect.stringContaining("redis.call"),
        ["lock:chapter-check"],
        [expect.any(String)]
      );
    });
  });

  describe("Query selection and stalest-first ordering", () => {
    it("selects only tracked series ordered by lastCheckedAt ascending with NULLs first", async () => {
      vi.mocked(db.series.findMany).mockResolvedValue([]);

      await runChapterCheck({ batchSize: 25 });

      expect(db.series.findMany).toHaveBeenCalledWith({
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
        take: 25,
      });
    });
  });

  describe("Monotonic latestChapter and Flag Consistency (Self-Healing)", () => {
    it("updates latestChapter and flags eligible unread reading progresses when MangaDex returns higher chapter", async () => {
      vi.mocked(db.series.findMany).mockResolvedValue([
        {
          id: "series-1",
          mangadexId: "md-1",
          title: "Series 1",
          coverUrl: null,
          latestChapter: 10,
          lastCheckedAt: new Date(Date.now() - 100000),
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ]);

      vi.mocked(fetchLatestChapter).mockResolvedValue(15);
      vi.mocked(db.series.update).mockResolvedValue({ id: "series-1" } as unknown as Series);
      vi.mocked(db.readingProgress.updateMany).mockResolvedValue({ count: 2 });

      const summary = await runChapterCheck();

      expect(summary.checked).toBe(1);
      expect(summary.updated).toBe(1);
      expect(summary.failed).toBe(0);

      // Verify db.$transaction atomic update
      expect(db.$transaction).toHaveBeenCalled();
      expect(db.series.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "series-1" },
          data: expect.objectContaining({ latestChapter: 15 }),
        })
      );

      // Verify only status in (READING, ON_HOLD) and lastReadChapter < newLatest are updated
      expect(db.readingProgress.updateMany).toHaveBeenCalledWith({
        where: {
          seriesId: "series-1",
          status: { in: ["READING", "ON_HOLD"] },
          lastReadChapter: { lt: 15 },
          hasUpdate: false,
        },
        data: {
          hasUpdate: true,
        },
      });
    });

    it("self-heals unflagged rows when latestChapter is unchanged: still flags behind-and-unflagged rows", async () => {
      vi.mocked(db.series.findMany).mockResolvedValue([
        {
          id: "series-unchanged",
          mangadexId: "md-unchanged",
          title: "Unchanged Series",
          coverUrl: null,
          latestChapter: 25,
          lastCheckedAt: new Date(Date.now() - 100000),
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ]);

      // MangaDex returns the exact same latest chapter
      vi.mocked(fetchLatestChapter).mockResolvedValue(25);
      vi.mocked(db.series.update).mockResolvedValue({ id: "series-unchanged" } as unknown as Series);
      vi.mocked(db.readingProgress.updateMany).mockResolvedValue({ count: 1 });

      const summary = await runChapterCheck();

      expect(summary.checked).toBe(1);
      expect(summary.updated).toBe(0); // Series record didn't bump

      // Series only gets lastCheckedAt updated
      expect(db.series.update).toHaveBeenCalledWith({
        where: { id: "series-unchanged" },
        data: {
          lastCheckedAt: expect.any(Date),
        },
      });

      // Self-heal: Reading progress is STILL updated to flag missed/unflagged rows!
      expect(db.readingProgress.updateMany).toHaveBeenCalledWith({
        where: {
          seriesId: "series-unchanged",
          status: { in: ["READING", "ON_HOLD"] },
          lastReadChapter: { lt: 25 },
          hasUpdate: false,
        },
        data: {
          hasUpdate: true,
        },
      });
    });

    it("NEVER decreases latestChapter when MangaDex returns a lower number, but still self-heals based on stored chapter", async () => {
      vi.mocked(db.series.findMany).mockResolvedValue([
        {
          id: "series-1",
          mangadexId: "md-1",
          title: "Series 1",
          coverUrl: null,
          latestChapter: 25,
          lastCheckedAt: new Date(Date.now() - 100000),
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ]);

      // MangaDex returns a lower chapter (e.g. deleted/re-indexed chapters)
      vi.mocked(fetchLatestChapter).mockResolvedValue(20);
      vi.mocked(db.series.update).mockResolvedValue({ id: "series-1" } as unknown as Series);
      vi.mocked(db.readingProgress.updateMany).mockResolvedValue({ count: 0 });

      const summary = await runChapterCheck();

      expect(summary.checked).toBe(1);
      expect(summary.updated).toBe(0); // Not updated because chapter didn't advance

      // latestChapter was NOT touched, only lastCheckedAt
      expect(db.series.update).toHaveBeenCalledWith({
        where: { id: "series-1" },
        data: {
          lastCheckedAt: expect.any(Date),
        },
      });

      // Still self-heals based on the known higher stored latestChapter (25)
      expect(db.readingProgress.updateMany).toHaveBeenCalledWith({
        where: {
          seriesId: "series-1",
          status: { in: ["READING", "ON_HOLD"] },
          lastReadChapter: { lt: 25 },
          hasUpdate: false,
        },
        data: {
          hasUpdate: true,
        },
      });
    });

    it("populates latestChapter when stored value is null", async () => {
      vi.mocked(db.series.findMany).mockResolvedValue([
        {
          id: "series-new",
          mangadexId: "md-new",
          title: "New Series",
          coverUrl: null,
          latestChapter: null, // Initial null
          lastCheckedAt: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ]);

      vi.mocked(fetchLatestChapter).mockResolvedValue(5);
      vi.mocked(db.series.update).mockResolvedValue({ id: "series-new" } as unknown as Series);
      vi.mocked(db.readingProgress.updateMany).mockResolvedValue({ count: 1 });

      const summary = await runChapterCheck();

      expect(summary.updated).toBe(1);
      expect(db.series.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "series-new" },
          data: expect.objectContaining({ latestChapter: 5 }),
        })
      );
    });
  });

  describe("Failure isolation and Rate-Limit Handling", () => {
    it("one failing series does not abort others and still receives updated lastCheckedAt", async () => {
      vi.mocked(db.series.findMany).mockResolvedValue([
        {
          id: "series-fail",
          mangadexId: "md-fail",
          title: "Failing Series",
          coverUrl: null,
          latestChapter: 10,
          lastCheckedAt: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        {
          id: "series-success",
          mangadexId: "md-success",
          title: "Succeeding Series",
          coverUrl: null,
          latestChapter: 10,
          lastCheckedAt: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ]);

      // First series throws unexpected genuine error; second succeeds
      vi.mocked(fetchLatestChapter)
        .mockRejectedValueOnce(new Error("MangaDex 500 server error"))
        .mockResolvedValueOnce(12);

      vi.mocked(db.series.update).mockResolvedValue({ id: "series-success" } as unknown as Series);
      vi.mocked(db.readingProgress.updateMany).mockResolvedValue({ count: 1 });

      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      const summary = await runChapterCheck();

      expect(summary.checked).toBe(2);
      expect(summary.failed).toBe(1);
      expect(summary.updated).toBe(1);

      // Verify failure log contains series id, mangadexId, and error message only
      expect(errorSpy).toHaveBeenCalledWith(
        "Series check failed: id=series-fail, mangadexId=md-fail, error=MangaDex 500 server error"
      );

      // Verify that failing series STILL had lastCheckedAt set so it does not starve the queue
      expect(db.series.update).toHaveBeenCalledWith({
        where: { id: "series-fail" },
        data: {
          lastCheckedAt: expect.any(Date),
        },
      });
    });

    it("on MangaDexRateLimitError, does NOT update lastCheckedAt and counts as stoppedEarly (NOT failed)", async () => {
      vi.mocked(db.series.findMany).mockResolvedValue([
        {
          id: "series-rl",
          mangadexId: "md-rl",
          title: "Rate Limited Series",
          coverUrl: null,
          latestChapter: 5,
          lastCheckedAt: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        {
          id: "series-unreached",
          mangadexId: "md-unreached",
          title: "Unreached Series",
          coverUrl: null,
          latestChapter: 5,
          lastCheckedAt: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ]);

      // Throws MangaDexRateLimitError
      vi.mocked(fetchLatestChapter).mockRejectedValueOnce(
        new MangaDexRateLimitError("Rate limit exceeded")
      );

      const summary = await runChapterCheck();

      expect(summary.checked).toBe(1);
      expect(summary.failed).toBe(0); // Counted as stoppedEarly, NOT failed
      expect(summary.stoppedEarly).toBe(true);

      // Series was NOT updated with lastCheckedAt because it was not genuinely checked
      expect(db.series.update).not.toHaveBeenCalled();

      // Second series was never reached
      expect(fetchLatestChapter).toHaveBeenCalledTimes(1);
    });
  });

  describe("Deadline enforcement and time budget", () => {
    it("skips series when less than 1500ms remain before deadline and sets stoppedEarly: true", async () => {
      vi.mocked(db.series.findMany).mockResolvedValue([
        {
          id: "series-1",
          mangadexId: "md-1",
          title: "Series 1",
          coverUrl: null,
          latestChapter: 5,
          lastCheckedAt: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        {
          id: "series-2",
          mangadexId: "md-2",
          title: "Series 2",
          coverUrl: null,
          latestChapter: 5,
          lastCheckedAt: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ]);

      // First fetch succeeds but takes time, leaving < 1500ms before deadline
      vi.mocked(fetchLatestChapter).mockImplementationOnce(async () => {
        vi.spyOn(Date, "now").mockReturnValue(Date.now() + 6000); // Leaves < 1000ms of 7000ms budget
        return 6;
      });

      const summary = await runChapterCheck({ timeBudgetMs: 7000 });

      expect(summary.checked).toBe(1);
      expect(summary.stoppedEarly).toBe(true);
      expect(fetchLatestChapter).toHaveBeenCalledTimes(1);
    });

    it("passes remaining time and deadline down to fetchLatestChapter", async () => {
      vi.mocked(db.series.findMany).mockResolvedValue([
        {
          id: "series-1",
          mangadexId: "md-1",
          title: "Series 1",
          coverUrl: null,
          latestChapter: 5,
          lastCheckedAt: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ]);

      vi.mocked(fetchLatestChapter).mockResolvedValue(6);

      await runChapterCheck({ timeBudgetMs: 7000 });

      expect(fetchLatestChapter).toHaveBeenCalledWith(
        "md-1",
        expect.objectContaining({
          timeoutMs: expect.any(Number),
          deadline: expect.any(Number),
        })
      );
    });

    it("clamps timeBudgetMs to MAX_TIME_BUDGET_MS (8000)", async () => {
      vi.mocked(db.series.findMany).mockResolvedValue([]);

      await runChapterCheck({ timeBudgetMs: 15000 });

      // Lock TTL should be clamped budget (8000) + LOCK_BUFFER_MS (2000) = 10000
      expect(redis.set).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(String),
        expect.objectContaining({ px: 10000 })
      );
    });
  });
});
