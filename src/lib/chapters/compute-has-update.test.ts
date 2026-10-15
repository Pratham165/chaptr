import { describe, it, expect } from "vitest";
import { computeHasUpdate } from "./compute-has-update";
import { type ReadingStatus } from "@prisma/client";

describe("computeHasUpdate Matrix", () => {
  const statuses: ReadingStatus[] = ["READING", "ON_HOLD", "COMPLETED", "DROPPED"];

  describe("when latestChapter is null", () => {
    it("returns false across all statuses regardless of lastReadChapter", () => {
      for (const status of statuses) {
        expect(computeHasUpdate(null, 0, status)).toBe(false);
        expect(computeHasUpdate(null, 10, status)).toBe(false);
      }
    });
  });

  describe("when latestChapter is equal to lastReadChapter", () => {
    it("returns false across all statuses (caught up)", () => {
      for (const status of statuses) {
        expect(computeHasUpdate(15, 15, status)).toBe(false);
        expect(computeHasUpdate(0, 0, status)).toBe(false);
        expect(computeHasUpdate(10.5, 10.5, status)).toBe(false);
      }
    });
  });

  describe("when latestChapter is less than lastReadChapter", () => {
    it("returns false across all statuses (reading ahead / re-read)", () => {
      for (const status of statuses) {
        expect(computeHasUpdate(5, 10, status)).toBe(false);
        expect(computeHasUpdate(10, 10.5, status)).toBe(false);
      }
    });
  });

  describe("when latestChapter is strictly greater than lastReadChapter", () => {
    it("returns true ONLY for READING and ON_HOLD statuses", () => {
      expect(computeHasUpdate(20, 10, "READING")).toBe(true);
      expect(computeHasUpdate(20, 10, "ON_HOLD")).toBe(true);
    });

    it("returns false for COMPLETED and DROPPED statuses (never flag)", () => {
      expect(computeHasUpdate(20, 10, "COMPLETED")).toBe(false);
      expect(computeHasUpdate(20, 10, "DROPPED")).toBe(false);
    });
  });

  describe("decimal chapter numbers", () => {
    it("correctly handles fractional chapter increments for READING", () => {
      // 10.5 latest > 10 lastRead -> unread
      expect(computeHasUpdate(10.5, 10, "READING")).toBe(true);

      // 10.5 latest == 10.5 lastRead -> caught up
      expect(computeHasUpdate(10.5, 10.5, "READING")).toBe(false);

      // 10 latest < 10.5 lastRead -> false
      expect(computeHasUpdate(10, 10.5, "READING")).toBe(false);
    });

    it("correctly handles fractional chapter increments for ON_HOLD", () => {
      expect(computeHasUpdate(10.5, 10, "ON_HOLD")).toBe(true);
      expect(computeHasUpdate(10.5, 10.5, "ON_HOLD")).toBe(false);
      expect(computeHasUpdate(10, 10.5, "ON_HOLD")).toBe(false);
    });

    it("never flags decimals for COMPLETED or DROPPED", () => {
      expect(computeHasUpdate(10.5, 10, "COMPLETED")).toBe(false);
      expect(computeHasUpdate(10.5, 10, "DROPPED")).toBe(false);
    });
  });
});
