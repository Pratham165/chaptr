import { describe, it, expect, afterEach, vi, beforeEach } from "vitest";
import {
  normalizeMangaDexTitle,
  extractCoverUrl,
  isMangadexUploadHost,
  getMangaDexUserAgent,
  MangaDexRateLimitError,
  MangaDexUnavailableError,
  searchMangaDex,
  getMangaDexSeries,
  NOT_FOUND_CACHE_TTL_SECONDS,
} from "./index";
import { redis, mangadexRatelimit } from "@/lib/redis";

vi.mock("@/lib/redis", () => ({
  REDIS_KEY_PREFIX: "",
  redis: {
    get: vi.fn(),
    set: vi.fn(),
  },
  mangadexRatelimit: {
    limit: vi.fn().mockResolvedValue({ success: true }),
  },
}));

describe("MangaDex Helper Functions", () => {
  const originalEnv = process.env.MANGADEX_CONTACT;
  const originalNodeEnv = process.env.NODE_ENV;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    process.env.MANGADEX_CONTACT = originalEnv;
    process.env.NODE_ENV = originalNodeEnv;
    vi.restoreAllMocks();
  });

  describe("normalizeMangaDexTitle", () => {
    it("prefers 'en' when present", () => {
      const titleObj = {
        ja: "チェンソーマン",
        "ja-ro": "Chainsaw Man",
        en: "Chainsaw Man",
      };
      expect(normalizeMangaDexTitle(titleObj)).toBe("Chainsaw Man");
    });

    it("falls back to the first available key when 'en' is missing", () => {
      const titleObj = {
        ja: "チェンソーマン",
        ko: "체인소맨",
      };
      expect(normalizeMangaDexTitle(titleObj)).toBe("チェンソーマン");

      const titleObjRomanized = {
        "ja-ro": "Sousou no Frieren",
        ja: "葬送のフリーレン",
      };
      expect(normalizeMangaDexTitle(titleObjRomanized)).toBe("Sousou no Frieren");
    });

    it("returns empty string when no title fields at all exist", () => {
      expect(normalizeMangaDexTitle({})).toBe("");
      expect(normalizeMangaDexTitle(null)).toBe("");
      expect(normalizeMangaDexTitle(undefined)).toBe("");
      expect(normalizeMangaDexTitle({ en: "   " })).toBe("");
    });
  });

  describe("isMangadexUploadHost", () => {
    it("returns true for uploads.mangadex.org host", () => {
      expect(
        isMangadexUploadHost(
          "https://uploads.mangadex.org/covers/f9c33ab4/cover.jpg"
        )
      ).toBe(true);
    });

    it("returns false for non-uploads.mangadex.org hosts", () => {
      expect(isMangadexUploadHost("https://evil.com/cover.jpg")).toBe(false);
      expect(isMangadexUploadHost("https://api.mangadex.org/cover.jpg")).toBe(false);
      expect(isMangadexUploadHost("not-a-url")).toBe(false);
      expect(isMangadexUploadHost(null)).toBe(false);
      expect(isMangadexUploadHost(undefined)).toBe(false);
    });
  });

  describe("extractCoverUrl", () => {
    it("constructs full cover URL when cover_art relationship is present", () => {
      const mangaId = "f9c33ab4-6a98-4444-9344-935f8c8577ae";
      const relationships = [
        { type: "author" },
        {
          type: "cover_art",
          attributes: {
            fileName: "cover-file-123.jpg",
          },
        },
      ];

      const url = extractCoverUrl(mangaId, relationships);
      expect(url).toBe(
        "https://uploads.mangadex.org/covers/f9c33ab4-6a98-4444-9344-935f8c8577ae/cover-file-123.jpg"
      );
    });

    it("returns null when no cover_art relationship exists or fileName is missing", () => {
      expect(extractCoverUrl("manga-1", [{ type: "author" }])).toBeNull();
      expect(
        extractCoverUrl("manga-1", [{ type: "cover_art", attributes: {} }])
      ).toBeNull();
      expect(extractCoverUrl("manga-1", null)).toBeNull();
      expect(extractCoverUrl("", [{ type: "cover_art" }])).toBeNull();
    });
  });

  describe("getMangaDexUserAgent", () => {
    it("incorporates MANGADEX_CONTACT env var into User-Agent header", () => {
      process.env.MANGADEX_CONTACT = "https://github.com/myuser/chaptr";
      expect(getMangaDexUserAgent()).toBe(
        "Chaptr/1.0 (+https://github.com/myuser/chaptr)"
      );
    });

    it("throws in production when MANGADEX_CONTACT is unset", () => {
      delete process.env.MANGADEX_CONTACT;
      process.env.NODE_ENV = "production";
      expect(() => getMangaDexUserAgent()).toThrow(
        "MANGADEX_CONTACT environment variable is required in production"
      );
    });

    it("warns in development when MANGADEX_CONTACT is unset and returns Chaptr/1.0 without github fallback", () => {
      delete process.env.MANGADEX_CONTACT;
      process.env.NODE_ENV = "development";
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      const ua = getMangaDexUserAgent();
      expect(ua).toBe("Chaptr/1.0");
      expect(ua).not.toContain("github.com");
      expect(warnSpy).toHaveBeenCalledWith(
        "MANGADEX_CONTACT environment variable is unset"
      );
    });
  });

  describe("MangaDexRateLimitError", () => {
    it("sets message and optional retryAfterMs", () => {
      const err = new MangaDexRateLimitError("Rate limited, try again shortly", 1500);
      expect(err.message).toBe("Rate limited, try again shortly");
      expect(err.retryAfterMs).toBe(1500);
      expect(err.name).toBe("MangaDexRateLimitError");
    });
  });

  describe("searchMangaDex content rating, Zod validation, and error sanitization", () => {
    it("includes contentRating[]=safe and contentRating[]=suggestive in request URL", async () => {
      const fetchSpy = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          data: [
            {
              id: "manga-uuid-1",
              attributes: { title: { en: "Test Manga" } },
              relationships: [],
            },
          ],
        }),
      });
      vi.stubGlobal("fetch", fetchSpy);

      const result = await searchMangaDex("Test Manga");
      expect(result.error).toBeNull();
      expect(result.results.length).toBe(1);

      const calledUrl = fetchSpy.mock.calls[0][0] as string;
      const parsedUrl = new URL(calledUrl);
      const contentRatings = parsedUrl.searchParams.getAll("contentRating[]");
      expect(contentRatings).toContain("safe");
      expect(contentRatings).toContain("suggestive");
    });

    it("handles response.json() parse failure with a friendly error", async () => {
      const fetchSpy = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => {
          throw new SyntaxError("Unexpected token < in JSON");
        },
      });
      vi.stubGlobal("fetch", fetchSpy);
      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      const result = await searchMangaDex("Malformed Series");
      expect(result).toEqual({
        results: [],
        error: "Failed to parse MangaDex response",
      });
      expect(errorSpy).toHaveBeenCalled();
    });

    it("sanitizes generic network errors to 'Something went wrong. Please try again.'", async () => {
      const fetchSpy = vi.fn().mockRejectedValue(new Error("ETIMEDOUT connect 1.2.3.4:443"));
      vi.stubGlobal("fetch", fetchSpy);
      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      const result = await searchMangaDex("Timeout Series");
      expect(result).toEqual({
        results: [],
        error: "Something went wrong. Please try again.",
      });
      expect(errorSpy).toHaveBeenCalled();
    });

    it("passes through MangaDexRateLimitError on search", async () => {
      vi.mocked(mangadexRatelimit.limit).mockResolvedValueOnce({
        success: false,
        limit: 4,
        remaining: 0,
        reset: Date.now() + 1000,
        pending: Promise.resolve(),
      });

      const result = await searchMangaDex("Rate Limited Series");
      expect(result).toEqual({
        results: [],
        error: "Rate limited, try again shortly",
      });
    });
  });

  describe("getMangaDexSeries 404 caching, content rating, and parse hardening", () => {
    const mangaId = "7a44f9c3-6a98-4444-9344-935f8c8577ae";

    it("fetches attributes.contentRating and validates with lenient Zod schema", async () => {
      vi.mocked(redis.get).mockResolvedValue(null);
      const fetchSpy = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          data: {
            id: mangaId,
            attributes: {
              title: { en: "Frieren" },
              contentRating: "safe",
              extraUnusedField: 12345,
            },
            relationships: [],
          },
        }),
      });
      vi.stubGlobal("fetch", fetchSpy);

      const series = await getMangaDexSeries(mangaId);
      expect(series).not.toBeNull();
      expect(series?.contentRating).toBe("safe");
      expect(series?.title).toBe("Frieren");
    });

    it("caches 404 responses in Redis for 10 minutes (TTL 600) under distinct key", async () => {
      vi.mocked(redis.get).mockResolvedValue(null);
      const fetchSpy = vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
        statusText: "Not Found",
      });
      vi.stubGlobal("fetch", fetchSpy);

      const series = await getMangaDexSeries(mangaId);
      expect(series).toBeNull();

      const notFoundKey = `mangadex:manga:404:${mangaId}`;
      expect(redis.set).toHaveBeenCalledWith(
        notFoundKey,
        true,
        { ex: NOT_FOUND_CACHE_TTL_SECONDS }
      );
      expect(NOT_FOUND_CACHE_TTL_SECONDS).toBe(600);
    });

    it("returns null directly from 404 cache without calling MangaDex network", async () => {
      const notFoundKey = `mangadex:manga:404:${mangaId}`;
      vi.mocked(redis.get).mockImplementation(async (key: string) => {
        if (key === notFoundKey) return true;
        return null;
      });
      const fetchSpy = vi.fn();
      vi.stubGlobal("fetch", fetchSpy);

      const series = await getMangaDexSeries(mangaId);
      expect(series).toBeNull();
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it("throws MangaDexUnavailableError on JSON parse failure and does not cache failure", async () => {
      vi.mocked(redis.get).mockResolvedValue(null);
      const fetchSpy = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => {
          throw new SyntaxError("Unexpected token < in JSON");
        },
      });
      vi.stubGlobal("fetch", fetchSpy);
      vi.spyOn(console, "error").mockImplementation(() => {});

      await expect(getMangaDexSeries(mangaId)).rejects.toThrow(
        MangaDexUnavailableError
      );
      expect(redis.set).not.toHaveBeenCalled();
    });

    it("throws MangaDexUnavailableError on 5xx server errors and does not cache 404", async () => {
      vi.mocked(redis.get).mockResolvedValue(null);
      const fetchSpy = vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        statusText: "Internal Server Error",
      });
      vi.stubGlobal("fetch", fetchSpy);
      vi.spyOn(console, "warn").mockImplementation(() => {});

      await expect(getMangaDexSeries(mangaId)).rejects.toThrow(
        MangaDexUnavailableError
      );
      expect(redis.set).not.toHaveBeenCalled();
    });

    it("throws MangaDexUnavailableError on network errors / timeouts and does not cache 404", async () => {
      vi.mocked(redis.get).mockResolvedValue(null);
      const fetchSpy = vi.fn().mockRejectedValue(new Error("ETIMEDOUT"));
      vi.stubGlobal("fetch", fetchSpy);
      vi.spyOn(console, "warn").mockImplementation(() => {});

      await expect(getMangaDexSeries(mangaId)).rejects.toThrow(
        MangaDexUnavailableError
      );
      expect(redis.set).not.toHaveBeenCalled();
    });
  });
});
