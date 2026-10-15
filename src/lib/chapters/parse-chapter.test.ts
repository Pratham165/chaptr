import { describe, it, expect } from "vitest";
import { parseChapterNumber, extractMaxChapterNumber } from "./parse-chapter";

describe("Chapter Parsing Logic", () => {
  describe("parseChapterNumber", () => {
    it("parses integer strings correctly", () => {
      expect(parseChapterNumber("1")).toBe(1);
      expect(parseChapterNumber("100")).toBe(100);
      expect(parseChapterNumber("0")).toBe(0);
    });

    it("parses decimal chapter strings correctly ('10.5')", () => {
      expect(parseChapterNumber("10.5")).toBe(10.5);
      expect(parseChapterNumber("0.1")).toBe(0.1);
      expect(parseChapterNumber("99.75")).toBe(99.75);
    });

    it("handles whitespace padding gracefully", () => {
      expect(parseChapterNumber("  12  ")).toBe(12);
      expect(parseChapterNumber("\n25.5\t")).toBe(25.5);
    });

    it("returns null for null, undefined, or empty strings", () => {
      expect(parseChapterNumber(null)).toBeNull();
      expect(parseChapterNumber(undefined)).toBeNull();
      expect(parseChapterNumber("")).toBeNull();
      expect(parseChapterNumber("   ")).toBeNull();
    });

    it("returns null for non-numeric garbage or special chapters", () => {
      expect(parseChapterNumber("oneshot")).toBeNull();
      expect(parseChapterNumber("extra")).toBeNull();
      expect(parseChapterNumber("special-1")).toBeNull();
      expect(parseChapterNumber("NaN")).toBeNull();
      expect(parseChapterNumber("undefined")).toBeNull();
      expect(parseChapterNumber("Infinity")).toBeNull();
      expect(parseChapterNumber("-Infinity")).toBeNull();
    });
  });

  describe("extractMaxChapterNumber", () => {
    it("returns null for empty feed or missing data", () => {
      expect(extractMaxChapterNumber([])).toBeNull();
      expect(extractMaxChapterNumber(null)).toBeNull();
      expect(extractMaxChapterNumber(undefined)).toBeNull();
    });

    it("returns the numeric MAX across unsorted input", () => {
      const feed = [
        { attributes: { chapter: "5" } },
        { attributes: { chapter: "25" } },
        { attributes: { chapter: "12.5" } },
        { attributes: { chapter: "2" } },
      ];
      // Do not trust sort order: returns 25 even though it was not first
      expect(extractMaxChapterNumber(feed)).toBe(25);
    });

    it("correctly identifies decimals as highest value", () => {
      const feed = [
        { attributes: { chapter: "10" } },
        { attributes: { chapter: "10.5" } },
        { attributes: { chapter: "9.9" } },
      ];
      expect(extractMaxChapterNumber(feed)).toBe(10.5);
    });

    it("discards null, NaN, and garbage entries and returns max of valid numbers", () => {
      const feed = [
        { attributes: { chapter: null } },
        { attributes: { chapter: "garbage" } },
        { attributes: { chapter: "7" } },
        { attributes: { chapter: "" } },
        { attributes: { chapter: "14.2" } },
        { attributes: { chapter: "special" } },
      ];
      expect(extractMaxChapterNumber(feed)).toBe(14.2);
    });

    it("returns null if all entries in feed are null or non-numeric", () => {
      const feed = [
        { attributes: { chapter: null } },
        { attributes: { chapter: "prologue" } },
        { attributes: { chapter: "extra" } },
      ];
      expect(extractMaxChapterNumber(feed)).toBeNull();
    });
  });
});
