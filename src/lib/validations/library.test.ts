import { describe, it, expect } from "vitest";
import {
  addSeriesSchema,
  updateReadingProgressSchema,
  removeSeriesSchema,
  searchQuerySchema,
} from "./library";

describe("Library Zod Schemas", () => {
  describe("addSeriesSchema", () => {
    it("accepts valid UUID mangadexId", () => {
      const input = {
        mangadexId: "f9c33ab4-6a98-4444-9344-935f8c8577ae",
      };
      const result = addSeriesSchema.safeParse(input);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.mangadexId).toBe("f9c33ab4-6a98-4444-9344-935f8c8577ae");
      }
    });

    it("accepts valid UUID with leading/trailing whitespace (trimmed)", () => {
      const input = {
        mangadexId: "  f9c33ab4-6a98-4444-9344-935f8c8577ae  ",
      };
      const result = addSeriesSchema.safeParse(input);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.mangadexId).toBe("f9c33ab4-6a98-4444-9344-935f8c8577ae");
      }
    });

    it("rejects non-UUID strings", () => {
      const invalidIds = ["manga-123", "", "not-a-uuid", "12345"];
      for (const id of invalidIds) {
        const result = addSeriesSchema.safeParse({ mangadexId: id });
        expect(result.success).toBe(false);
      }
    });

    it("does not accept or require title and coverUrl", () => {
      const inputWithExtra = {
        mangadexId: "f9c33ab4-6a98-4444-9344-935f8c8577ae",
        title: "Malicious Overwrite",
        coverUrl: "https://evil.com/fake.jpg",
      };
      const result = addSeriesSchema.safeParse(inputWithExtra);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toEqual({
          mangadexId: "f9c33ab4-6a98-4444-9344-935f8c8577ae",
        });
        expect((result.data as Record<string, unknown>).title).toBeUndefined();
        expect((result.data as Record<string, unknown>).coverUrl).toBeUndefined();
      }
    });
  });

  describe("searchQuerySchema", () => {
    it("accepts valid search queries and trims whitespace", () => {
      const result = searchQuerySchema.safeParse("  Chainsaw Man  ");
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toBe("Chainsaw Man");
      }
    });

    it("accepts queries between 1 and 100 characters, including single-character queries like '月' and 'X'", () => {
      const resKanji = searchQuerySchema.safeParse("月");
      expect(resKanji.success).toBe(true);
      if (resKanji.success) {
        expect(resKanji.data).toBe("月");
      }

      const resAscii = searchQuerySchema.safeParse("X");
      expect(resAscii.success).toBe(true);
      if (resAscii.success) {
        expect(resAscii.data).toBe("X");
      }

      const resTrimmedKanji = searchQuerySchema.safeParse("  月  ");
      expect(resTrimmedKanji.success).toBe(true);
      if (resTrimmedKanji.success) {
        expect(resTrimmedKanji.data).toBe("月");
      }

      const resTrimmedAscii = searchQuerySchema.safeParse("  X  ");
      expect(resTrimmedAscii.success).toBe(true);
      if (resTrimmedAscii.success) {
        expect(resTrimmedAscii.data).toBe("X");
      }

      expect(searchQuerySchema.safeParse("ab").success).toBe(true);
      expect(searchQuerySchema.safeParse("a".repeat(100)).success).toBe(true);
    });

    it("rejects empty or whitespace-only queries after trim", () => {
      expect(searchQuerySchema.safeParse("").success).toBe(false);
      expect(searchQuerySchema.safeParse("   ").success).toBe(false);
    });

    it("rejects queries longer than 100 characters", () => {
      expect(searchQuerySchema.safeParse("a".repeat(101)).success).toBe(false);
    });
  });

  describe("updateReadingProgressSchema", () => {
    it("accepts valid progress update", () => {
      const input = {
        readingProgressId: "rp-123",
        lastReadChapter: 45.5,
        status: "READING",
      };
      const result = updateReadingProgressSchema.safeParse(input);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.lastReadChapter).toBe(45.5);
        expect(result.data.status).toBe("READING");
      }
    });

    it("accepts chapter 0 and all valid statuses", () => {
      const statuses = ["READING", "ON_HOLD", "COMPLETED", "DROPPED"] as const;
      for (const status of statuses) {
        const result = updateReadingProgressSchema.safeParse({
          readingProgressId: "rp-1",
          lastReadChapter: 0,
          status,
        });
        expect(result.success).toBe(true);
      }
    });

    it("rejects negative chapter numbers", () => {
      const input = {
        readingProgressId: "rp-123",
        lastReadChapter: -1,
        status: "READING",
      };
      const result = updateReadingProgressSchema.safeParse(input);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0].message).toContain("cannot be negative");
      }
    });

    it("rejects non-finite chapter numbers (Infinity, -Infinity)", () => {
      const inputPosInf = {
        readingProgressId: "rp-123",
        lastReadChapter: Infinity,
        status: "READING",
      };
      expect(updateReadingProgressSchema.safeParse(inputPosInf).success).toBe(false);

      const inputNegInf = {
        readingProgressId: "rp-123",
        lastReadChapter: -Infinity,
        status: "READING",
      };
      expect(updateReadingProgressSchema.safeParse(inputNegInf).success).toBe(false);
    });

    it("rejects NaN chapter number", () => {
      const inputNaN = {
        readingProgressId: "rp-123",
        lastReadChapter: NaN,
        status: "READING",
      };
      expect(updateReadingProgressSchema.safeParse(inputNaN).success).toBe(false);
    });

    it("rejects chapter numbers exceeding 99999 (e.g. 100000) and accepts 99999", () => {
      const inputOverLimit = {
        readingProgressId: "rp-123",
        lastReadChapter: 100000,
        status: "READING",
      };
      const resultOver = updateReadingProgressSchema.safeParse(inputOverLimit);
      expect(resultOver.success).toBe(false);
      if (!resultOver.success) {
        expect(resultOver.error.issues[0].message).toContain("cannot exceed 99999");
      }

      const inputMaxValid = {
        readingProgressId: "rp-123",
        lastReadChapter: 99999,
        status: "READING",
      };
      expect(updateReadingProgressSchema.safeParse(inputMaxValid).success).toBe(true);
    });

    it("rejects empty readingProgressId", () => {
      const input = {
        readingProgressId: "",
        lastReadChapter: 10,
        status: "READING",
      };
      const result = updateReadingProgressSchema.safeParse(input);
      expect(result.success).toBe(false);
    });

    it("rejects invalid status", () => {
      const input = {
        readingProgressId: "rp-123",
        lastReadChapter: 10,
        status: "PLAN_TO_READ",
      };
      const result = updateReadingProgressSchema.safeParse(input);
      expect(result.success).toBe(false);
    });
  });

  describe("removeSeriesSchema", () => {
    it("accepts valid readingProgressId", () => {
      const input = { readingProgressId: "rp-456" };
      const result = removeSeriesSchema.safeParse(input);
      expect(result.success).toBe(true);
    });

    it("rejects empty readingProgressId", () => {
      const input = { readingProgressId: "   " };
      const result = removeSeriesSchema.safeParse(input);
      expect(result.success).toBe(false);
    });

    it("rejects missing readingProgressId", () => {
      const input = {};
      const result = removeSeriesSchema.safeParse(input);
      expect(result.success).toBe(false);
    });
  });
});
