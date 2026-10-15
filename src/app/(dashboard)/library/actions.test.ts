import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  updateReadingProgress,
  removeSeriesFromLibrary,
  addSeriesToLibrary,
  searchMangaAction,
} from "./actions";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { getMangaDexSeries, searchMangaDex } from "@/lib/mangadex";
import { userActionRatelimit } from "@/lib/redis";
import type { Session } from "next-auth";
import type { ReadingProgress, Series } from "@prisma/client";

// Mock next/cache
vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

// Mock auth module
vi.mock("@/lib/auth", () => ({
  auth: vi.fn(),
}));

// Mock db module
vi.mock("@/lib/db", () => ({
  db: {
    series: {
      upsert: vi.fn(),
    },
    readingProgress: {
      findFirst: vi.fn(),
      create: vi.fn(),
      updateMany: vi.fn(),
      deleteMany: vi.fn(),
    },
  },
}));

// Mock mangadex module
vi.mock("@/lib/mangadex", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/mangadex")>();
  return {
    ...actual,
    getMangaDexSeries: vi.fn(),
    searchMangaDex: vi.fn(),
    isMangadexUploadHost: vi.fn((url: string | null | undefined) => {
      if (!url) return false;
      try {
        return new URL(url).hostname === "uploads.mangadex.org";
      } catch {
        return false;
      }
    }),
  };
});

// Mock redis module
vi.mock("@/lib/redis", () => ({
  REDIS_KEY_PREFIX: "",
  userActionRatelimit: {
    limit: vi.fn(),
  },
}));

describe("Library Server Actions", () => {
  const mockOwnerId = "user-owner-123";
  const mockAttackerId = "user-attacker-999";
  const mockProgressId = "progress-row-abc";
  const validUuid = "a7774250-d070-4945-84e7-f8ccaa041a46";
  const mockAuth = vi.mocked(auth as unknown as () => Promise<Session | null>);

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("updateReadingProgress ownership and error handling", () => {
    it("returns generic 'not found' error when called by a non-owner", async () => {
      // Session is attacker
      mockAuth.mockResolvedValueOnce({
        user: { id: mockAttackerId },
        expires: new Date().toISOString(),
      } as unknown as Session);

      // findFirst filters by { id, userId } so it finds nothing for attacker
      vi.mocked(db.readingProgress.findFirst).mockResolvedValueOnce(null);

      const result = await updateReadingProgress(mockProgressId, 15, "READING");
      expect(result).toEqual({
        ok: false,
        error: "Reading progress record not found",
      });
      expect(db.readingProgress.findFirst).toHaveBeenCalledWith({
        where: { id: mockProgressId, userId: mockAttackerId },
        include: { series: true },
      });
      expect(db.readingProgress.updateMany).not.toHaveBeenCalled();
    });

    it("returns generic 'not found' error when row does not exist", async () => {
      mockAuth.mockResolvedValueOnce({
        user: { id: mockOwnerId },
        expires: new Date().toISOString(),
      } as unknown as Session);

      vi.mocked(db.readingProgress.findFirst).mockResolvedValueOnce(null);

      const result = await updateReadingProgress("non-existent-id", 5, "READING");
      expect(result).toEqual({
        ok: false,
        error: "Reading progress record not found",
      });
    });

    it("allows update when called by the legitimate row owner", async () => {
      mockAuth.mockResolvedValueOnce({
        user: { id: mockOwnerId },
        expires: new Date().toISOString(),
      } as unknown as Session);

      vi.mocked(db.readingProgress.findFirst).mockResolvedValueOnce({
        id: mockProgressId,
        userId: mockOwnerId,
        seriesId: "series-1",
        lastReadChapter: 10,
        status: "READING",
        hasUpdate: false,
        series: {
          id: "series-1",
          latestChapter: 20,
        } as Series,
      } as unknown as ReadingProgress & { series: Series });

      vi.mocked(db.readingProgress.updateMany).mockResolvedValueOnce({ count: 1 });

      const result = await updateReadingProgress(mockProgressId, 15, "READING");
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.lastReadChapter).toBe(15);
        expect(result.data.hasUpdate).toBe(true);
      }
      expect(db.readingProgress.updateMany).toHaveBeenCalledWith({
        where: { id: mockProgressId, userId: mockOwnerId },
        data: {
          lastReadChapter: 15,
          status: "READING",
          hasUpdate: true,
        },
      });
    });

    it("sanitizes unexpected errors and returns generic message", async () => {
      mockAuth.mockResolvedValueOnce({
        user: { id: mockOwnerId },
        expires: new Date().toISOString(),
      } as unknown as Session);

      vi.mocked(db.readingProgress.findFirst).mockRejectedValueOnce(
        new Error("Database connection dropped")
      );
      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      const result = await updateReadingProgress(mockProgressId, 5, "READING");
      expect(result).toEqual({
        ok: false,
        error: "Something went wrong. Please try again.",
      });
      expect(errorSpy).toHaveBeenCalled();
    });

    it("returns error response if unauthenticated", async () => {
      mockAuth.mockResolvedValueOnce(null);

      const result = await updateReadingProgress(mockProgressId, 5, "READING");
      expect(result).toEqual({
        ok: false,
        error: "You must be logged in to update reading progress",
      });
    });
  });

  describe("updateReadingProgress hasUpdate recomputation logic", () => {
    const setupOwnerAndProgress = (latestChapter: number | null) => {
      mockAuth.mockResolvedValueOnce({
        user: { id: mockOwnerId },
        expires: new Date().toISOString(),
      } as unknown as Session);

      vi.mocked(db.readingProgress.findFirst).mockResolvedValueOnce({
        id: mockProgressId,
        userId: mockOwnerId,
        seriesId: "series-1",
        lastReadChapter: 0,
        status: "READING",
        series: {
          id: "series-1",
          latestChapter,
        } as Series,
      } as unknown as ReadingProgress & { series: Series });

      vi.mocked(db.readingProgress.updateMany).mockResolvedValueOnce({ count: 1 });
    };

    it("(a) reading up to latestChapter clears the hasUpdate flag", async () => {
      setupOwnerAndProgress(10);
      const result = await updateReadingProgress(mockProgressId, 10, "READING");
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.hasUpdate).toBe(false);
      }
      expect(db.readingProgress.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ hasUpdate: false, lastReadChapter: 10 }),
        })
      );
    });

    it("(b) reading below latestChapter keeps hasUpdate true", async () => {
      setupOwnerAndProgress(10);
      const result = await updateReadingProgress(mockProgressId, 9, "READING");
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.hasUpdate).toBe(true);
      }
      expect(db.readingProgress.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ hasUpdate: true, lastReadChapter: 9 }),
        })
      );
    });

    it("(c) latestChapter null gives false for hasUpdate", async () => {
      setupOwnerAndProgress(null);
      const result = await updateReadingProgress(mockProgressId, 5, "READING");
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.hasUpdate).toBe(false);
      }
      expect(db.readingProgress.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ hasUpdate: false, lastReadChapter: 5 }),
        })
      );
    });

    it("(d) correctly handles decimal chapters (10.5 vs 10)", async () => {
      // 10.5 latestChapter vs 10 lastReadChapter -> hasUpdate: true
      setupOwnerAndProgress(10.5);
      const result1 = await updateReadingProgress(mockProgressId, 10, "READING");
      expect(result1.ok).toBe(true);
      if (result1.ok) {
        expect(result1.data.hasUpdate).toBe(true);
      }

      // 10.5 latestChapter vs 10.5 lastReadChapter -> hasUpdate: false
      setupOwnerAndProgress(10.5);
      const result2 = await updateReadingProgress(mockProgressId, 10.5, "READING");
      expect(result2.ok).toBe(true);
      if (result2.ok) {
        expect(result2.data.hasUpdate).toBe(false);
      }

      // 10 latestChapter vs 10.5 lastReadChapter -> hasUpdate: false
      setupOwnerAndProgress(10);
      const result3 = await updateReadingProgress(mockProgressId, 10.5, "READING");
      expect(result3.ok).toBe(true);
      if (result3.ok) {
        expect(result3.data.hasUpdate).toBe(false);
      }
    });

    it("(e) ON_HOLD status allows hasUpdate = true when unread chapters exist", async () => {
      setupOwnerAndProgress(15);
      const result = await updateReadingProgress(mockProgressId, 10, "ON_HOLD");
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.hasUpdate).toBe(true);
      }
      expect(db.readingProgress.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ hasUpdate: true, status: "ON_HOLD" }),
        })
      );
    });

    it("(f) COMPLETED and DROPPED never flag hasUpdate even if behind latestChapter", async () => {
      // COMPLETED
      setupOwnerAndProgress(20);
      const resCompleted = await updateReadingProgress(mockProgressId, 10, "COMPLETED");
      expect(resCompleted.ok).toBe(true);
      if (resCompleted.ok) {
        expect(resCompleted.data.hasUpdate).toBe(false);
      }
      expect(db.readingProgress.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ hasUpdate: false, status: "COMPLETED" }),
        })
      );

      // DROPPED
      setupOwnerAndProgress(20);
      const resDropped = await updateReadingProgress(mockProgressId, 10, "DROPPED");
      expect(resDropped.ok).toBe(true);
      if (resDropped.ok) {
        expect(resDropped.data.hasUpdate).toBe(false);
      }
      expect(db.readingProgress.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ hasUpdate: false, status: "DROPPED" }),
        })
      );
    });
  });

  describe("removeSeriesFromLibrary ownership checks", () => {
    it("returns generic 'not found' error when called by a non-owner", async () => {
      mockAuth.mockResolvedValueOnce({
        user: { id: mockAttackerId },
        expires: new Date().toISOString(),
      } as unknown as Session);

      // deleteMany matches 0 rows because userId !== mockAttackerId
      vi.mocked(db.readingProgress.deleteMany).mockResolvedValueOnce({ count: 0 });

      const result = await removeSeriesFromLibrary(mockProgressId);
      expect(result).toEqual({
        ok: false,
        error: "Reading progress record not found",
      });
      expect(db.readingProgress.deleteMany).toHaveBeenCalledWith({
        where: { id: mockProgressId, userId: mockAttackerId },
      });
    });

    it("returns generic 'not found' error when row does not exist", async () => {
      mockAuth.mockResolvedValueOnce({
        user: { id: mockOwnerId },
        expires: new Date().toISOString(),
      } as unknown as Session);

      vi.mocked(db.readingProgress.deleteMany).mockResolvedValueOnce({ count: 0 });

      const result = await removeSeriesFromLibrary("non-existent");
      expect(result).toEqual({
        ok: false,
        error: "Reading progress record not found",
      });
    });

    it("allows deletion when called by the legitimate row owner", async () => {
      mockAuth.mockResolvedValueOnce({
        user: { id: mockOwnerId },
        expires: new Date().toISOString(),
      } as unknown as Session);

      vi.mocked(db.readingProgress.deleteMany).mockResolvedValueOnce({ count: 1 });

      const result = await removeSeriesFromLibrary(mockProgressId);
      expect(result).toEqual({
        ok: true,
        data: { success: true },
      });
      expect(db.readingProgress.deleteMany).toHaveBeenCalledWith({
        where: { id: mockProgressId, userId: mockOwnerId },
      });
    });

    it("sanitizes unexpected errors and returns generic message", async () => {
      mockAuth.mockResolvedValueOnce({
        user: { id: mockOwnerId },
        expires: new Date().toISOString(),
      } as unknown as Session);

      vi.mocked(db.readingProgress.deleteMany).mockRejectedValueOnce(
        new Error("Database write lock error")
      );
      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      const result = await removeSeriesFromLibrary(mockProgressId);
      expect(result).toEqual({
        ok: false,
        error: "Something went wrong. Please try again.",
      });
      expect(errorSpy).toHaveBeenCalled();
    });

    it("returns error response if unauthenticated", async () => {
      mockAuth.mockResolvedValueOnce(null);

      const result = await removeSeriesFromLibrary(mockProgressId);
      expect(result).toEqual({
        ok: false,
        error: "You must be logged in to remove a series from your library",
      });
    });
  });

  describe("addSeriesToLibrary data integrity and duplicate prevention", () => {
    it("rejects non-UUID mangadexId input", async () => {
      mockAuth.mockResolvedValueOnce({
        user: { id: mockOwnerId },
        expires: new Date().toISOString(),
      } as unknown as Session);

      const result = await addSeriesToLibrary("invalid-uuid");
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toContain("Invalid MangaDex ID");
      }
      expect(getMangaDexSeries).not.toHaveBeenCalled();
    });

    it("fetches metadata server-side and never overwrites existing series title/coverUrl on upsert", async () => {
      mockAuth.mockResolvedValueOnce({
        user: { id: mockOwnerId },
        expires: new Date().toISOString(),
      } as unknown as Session);

      vi.mocked(getMangaDexSeries).mockResolvedValueOnce({
        mangadexId: validUuid,
        title: "Official MangaDex Title",
        coverUrl: `https://uploads.mangadex.org/covers/${validUuid}/cover.jpg`,
        contentRating: "safe",
      });

      vi.mocked(db.series.upsert).mockResolvedValueOnce({
        id: "series-uuid-1",
        mangadexId: validUuid,
        title: "Original Title",
        coverUrl: "https://uploads.mangadex.org/covers/original.jpg",
      } as Series);

      vi.mocked(db.readingProgress.create).mockResolvedValueOnce({
        id: "progress-1",
        userId: mockOwnerId,
        seriesId: "series-uuid-1",
        status: "READING",
        lastReadChapter: 0,
        hasUpdate: false,
        series: { id: "series-uuid-1" } as Series,
      } as unknown as ReadingProgress & { series: Series });

      const result = await addSeriesToLibrary(validUuid);
      expect(result.ok).toBe(true);
      expect(getMangaDexSeries).toHaveBeenCalledWith(validUuid);

      // Verify upsert update branch is EMPTY ({}), preventing data poisoning
      expect(db.series.upsert).toHaveBeenCalledWith({
        where: { mangadexId: validUuid },
        update: {},
        create: {
          mangadexId: validUuid,
          title: "Official MangaDex Title",
          coverUrl: `https://uploads.mangadex.org/covers/${validUuid}/cover.jpg`,
        },
      });
    });

    it("creates progress row with hasUpdate: true when stored latestChapter is already higher than 0", async () => {
      mockAuth.mockResolvedValueOnce({
        user: { id: mockOwnerId },
        expires: new Date().toISOString(),
      } as unknown as Session);

      vi.mocked(getMangaDexSeries).mockResolvedValueOnce({
        mangadexId: validUuid,
        title: "Popular Existing Series",
        coverUrl: `https://uploads.mangadex.org/covers/${validUuid}/cover.jpg`,
        contentRating: "safe",
      });

      // Series in DB already has latestChapter = 25
      vi.mocked(db.series.upsert).mockResolvedValueOnce({
        id: "series-uuid-pop",
        mangadexId: validUuid,
        title: "Popular Existing Series",
        coverUrl: `https://uploads.mangadex.org/covers/${validUuid}/cover.jpg`,
        latestChapter: 25,
      } as Series);

      vi.mocked(db.readingProgress.create).mockResolvedValueOnce({
        id: "progress-pop",
        userId: mockOwnerId,
        seriesId: "series-uuid-pop",
        status: "READING",
        lastReadChapter: 0,
        hasUpdate: true,
        series: { id: "series-uuid-pop", latestChapter: 25 } as Series,
      } as unknown as ReadingProgress & { series: Series });

      const result = await addSeriesToLibrary(validUuid);
      expect(result.ok).toBe(true);

      // Verify db.readingProgress.create was called with hasUpdate: true
      expect(db.readingProgress.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            lastReadChapter: 0,
            status: "READING",
            hasUpdate: true,
          }),
        })
      );
    });

    it("enforces per-user rate limit with identifier add:${userId}", async () => {
      mockAuth.mockResolvedValueOnce({
        user: { id: mockOwnerId },
        expires: new Date().toISOString(),
      } as unknown as Session);

      vi.mocked(userActionRatelimit.limit).mockResolvedValueOnce({
        success: false,
        limit: 10,
        remaining: 0,
        reset: Date.now() + 10000,
        pending: Promise.resolve(),
      });

      const result = await addSeriesToLibrary(validUuid);
      expect(result).toEqual({
        ok: false,
        error: "Too many requests. Please slow down.",
      });
      expect(userActionRatelimit.limit).toHaveBeenCalledWith(`add:${mockOwnerId}`);
      expect(getMangaDexSeries).not.toHaveBeenCalled();
    });

    it("rejects series outside safe and suggestive ratings (e.g. erotica, pornographic)", async () => {
      // 1. Erotica
      mockAuth.mockResolvedValueOnce({
        user: { id: mockOwnerId },
        expires: new Date().toISOString(),
      } as unknown as Session);
      vi.mocked(getMangaDexSeries).mockResolvedValueOnce({
        mangadexId: validUuid,
        title: "Adult Manga",
        coverUrl: null,
        contentRating: "erotica",
      });

      const eroticaResult = await addSeriesToLibrary(validUuid);
      expect(eroticaResult).toEqual({
        ok: false,
        error: "This series isn't available",
      });

      // 2. Pornographic
      mockAuth.mockResolvedValueOnce({
        user: { id: mockOwnerId },
        expires: new Date().toISOString(),
      } as unknown as Session);
      vi.mocked(getMangaDexSeries).mockResolvedValueOnce({
        mangadexId: validUuid,
        title: "Explicit Manga",
        coverUrl: null,
        contentRating: "pornographic",
      });

      const pornoResult = await addSeriesToLibrary(validUuid);
      expect(pornoResult).toEqual({
        ok: false,
        error: "This series isn't available",
      });

      // 3. Suggestive (allowed)
      mockAuth.mockResolvedValueOnce({
        user: { id: mockOwnerId },
        expires: new Date().toISOString(),
      } as unknown as Session);
      vi.mocked(getMangaDexSeries).mockResolvedValueOnce({
        mangadexId: validUuid,
        title: "Suggestive Manga",
        coverUrl: null,
        contentRating: "suggestive",
      });
      vi.mocked(db.series.upsert).mockResolvedValueOnce({ id: "series-sug" } as Series);
      vi.mocked(db.readingProgress.create).mockResolvedValueOnce({
        id: "rp-sug",
      } as unknown as ReadingProgress & { series: Series });

      const sugResult = await addSeriesToLibrary(validUuid);
      expect(sugResult.ok).toBe(true);
    });

    it("ensures stored coverUrl is on uploads.mangadex.org", async () => {
      mockAuth.mockResolvedValueOnce({
        user: { id: mockOwnerId },
        expires: new Date().toISOString(),
      } as unknown as Session);

      vi.mocked(getMangaDexSeries).mockResolvedValueOnce({
        mangadexId: validUuid,
        title: "Untrusted Cover Host Series",
        coverUrl: "https://malicious.com/fake.jpg",
        contentRating: "safe",
      });

      vi.mocked(db.series.upsert).mockResolvedValueOnce({
        id: "series-uuid-1",
        mangadexId: validUuid,
      } as Series);

      vi.mocked(db.readingProgress.create).mockResolvedValueOnce({
        id: "progress-1",
      } as unknown as ReadingProgress & { series: Series });

      await addSeriesToLibrary(validUuid);

      expect(db.series.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: expect.objectContaining({
            coverUrl: null, // Rejected non-uploads.mangadex.org host
          }),
        })
      );
    });

    it("catches Prisma P2002 error and returns 'already tracking' error", async () => {
      mockAuth.mockResolvedValueOnce({
        user: { id: mockOwnerId },
        expires: new Date().toISOString(),
      } as unknown as Session);

      vi.mocked(getMangaDexSeries).mockResolvedValueOnce({
        mangadexId: validUuid,
        title: "Chainsaw Man",
        coverUrl: `https://uploads.mangadex.org/covers/${validUuid}/cover.jpg`,
        contentRating: "safe",
      });

      vi.mocked(db.series.upsert).mockResolvedValueOnce({
        id: "series-uuid-1",
        mangadexId: validUuid,
      } as Series);

      // Simulate Prisma P2002 unique constraint violation on create
      const p2002Error = new Error("Unique constraint failed");
      (p2002Error as unknown as { code: string }).code = "P2002";
      vi.mocked(db.readingProgress.create).mockRejectedValueOnce(p2002Error);

      const result = await addSeriesToLibrary(validUuid);
      expect(result).toEqual({
        ok: false,
        error: "You are already tracking this series in your library",
      });
    });

    it("sanitizes unexpected errors and returns generic message", async () => {
      mockAuth.mockResolvedValueOnce({
        user: { id: mockOwnerId },
        expires: new Date().toISOString(),
      } as unknown as Session);

      vi.mocked(getMangaDexSeries).mockRejectedValueOnce(
        new Error("Fatal internal DB connection failed")
      );
      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      const result = await addSeriesToLibrary(validUuid);
      expect(result).toEqual({
        ok: false,
        error: "Something went wrong. Please try again.",
      });
      expect(errorSpy).toHaveBeenCalled();
    });
  });

  describe("searchMangaAction protection and rate limiting", () => {
    it("validates query length (rejects < 1 or > 100 characters)", async () => {
      mockAuth.mockResolvedValueOnce({
        user: { id: mockOwnerId },
        expires: new Date().toISOString(),
      } as unknown as Session);

      const shortResult = await searchMangaAction("");
      expect(shortResult.ok).toBe(false);
      if (!shortResult.ok) {
        expect(shortResult.error).toContain("at least 1 character");
      }

      mockAuth.mockResolvedValueOnce({
        user: { id: mockOwnerId },
        expires: new Date().toISOString(),
      } as unknown as Session);

      const longResult = await searchMangaAction("a".repeat(101));
      expect(longResult.ok).toBe(false);
      if (!longResult.ok) {
        expect(longResult.error).toContain("at most 100 characters");
      }
    });

    it("enforces per-user rate limit (10 searches / 10s)", async () => {
      mockAuth.mockResolvedValueOnce({
        user: { id: mockOwnerId },
        expires: new Date().toISOString(),
      } as unknown as Session);

      vi.mocked(userActionRatelimit.limit).mockResolvedValueOnce({
        success: false,
        limit: 10,
        remaining: 0,
        reset: Date.now() + 5000,
        pending: Promise.resolve(),
      });

      const result = await searchMangaAction("Chainsaw Man");
      expect(result).toEqual({
        ok: false,
        error: "Too many search requests. Please slow down.",
      });
      expect(userActionRatelimit.limit).toHaveBeenCalledWith(mockOwnerId);
      expect(searchMangaDex).not.toHaveBeenCalled();
    });

    it("returns successful typed search results", async () => {
      mockAuth.mockResolvedValueOnce({
        user: { id: mockOwnerId },
        expires: new Date().toISOString(),
      } as unknown as Session);

      vi.mocked(userActionRatelimit.limit).mockResolvedValueOnce({
        success: true,
        limit: 10,
        remaining: 9,
        reset: Date.now() + 10000,
        pending: Promise.resolve(),
      });

      vi.mocked(searchMangaDex).mockResolvedValueOnce({
        results: [
          {
            mangadexId: validUuid,
            title: "Chainsaw Man",
            coverUrl: "https://uploads.mangadex.org/covers/cm.jpg",
          },
        ],
        error: null,
      });

      const result = await searchMangaAction("Chainsaw Man");
      expect(result).toEqual({
        ok: true,
        data: [
          {
            mangadexId: validUuid,
            title: "Chainsaw Man",
            coverUrl: "https://uploads.mangadex.org/covers/cm.jpg",
          },
        ],
      });
    });

    it("sanitizes unexpected errors and returns generic message", async () => {
      mockAuth.mockResolvedValueOnce({
        user: { id: mockOwnerId },
        expires: new Date().toISOString(),
      } as unknown as Session);

      vi.mocked(userActionRatelimit.limit).mockResolvedValueOnce({
        success: true,
        limit: 10,
        remaining: 9,
        reset: Date.now() + 10000,
        pending: Promise.resolve(),
      });

      vi.mocked(searchMangaDex).mockRejectedValueOnce(
        new Error("Unexpected search failure")
      );
      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      const result = await searchMangaAction("Chainsaw Man");
      expect(result).toEqual({
        ok: false,
        error: "Something went wrong. Please try again.",
      });
      expect(errorSpy).toHaveBeenCalled();
    });
  });
});
