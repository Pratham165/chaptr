import { describe, it, expect, vi, beforeEach } from "vitest";
import { fetchLatestChapter } from "./fetch-latest";
import { requestMangaDex, MangaDexRateLimitError } from "@/lib/mangadex";

// Mock requestMangaDex
vi.mock("@/lib/mangadex", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/mangadex")>();
  return {
    ...actual,
    requestMangaDex: vi.fn(),
  };
});

describe("fetchLatestChapter", () => {
  const mockMangaId = "a7774250-d070-4945-84e7-f8ccaa041a46";

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("Non-2xx HTTP responses (MUST throw Error, not return null)", () => {
    it("throws an error when MangaDex returns 404 Not Found", async () => {
      vi.mocked(requestMangaDex).mockResolvedValueOnce(
        new Response(JSON.stringify({ errors: [{ status: 404, title: "Not Found" }] }), {
          status: 404,
          statusText: "Not Found",
          headers: { "Content-Type": "application/json" },
        })
      );

      await expect(fetchLatestChapter(mockMangaId)).rejects.toThrow(
        "MangaDex feed error: 404 Not Found"
      );
    });

    it("throws an error when MangaDex returns 500 Internal Server Error", async () => {
      vi.mocked(requestMangaDex).mockResolvedValueOnce(
        new Response("Internal Server Error", {
          status: 500,
          statusText: "Internal Server Error",
        })
      );

      await expect(fetchLatestChapter(mockMangaId)).rejects.toThrow(
        "MangaDex feed error: 500 Internal Server Error"
      );
    });

    it("throws an error when MangaDex returns 503 Service Unavailable", async () => {
      vi.mocked(requestMangaDex).mockResolvedValueOnce(
        new Response("Service Unavailable", {
          status: 503,
          statusText: "Service Unavailable",
        })
      );

      await expect(fetchLatestChapter(mockMangaId)).rejects.toThrow(
        "MangaDex feed error: 503 Service Unavailable"
      );
    });
  });

  describe("Null return contract (ONLY for genuinely empty or all-unparseable chapter lists)", () => {
    it("returns null when MangaDex returns 200 with an empty chapter list", async () => {
      vi.mocked(requestMangaDex).mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            result: "ok",
            response: "collection",
            data: [],
            limit: 10,
            offset: 0,
            total: 0,
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        )
      );

      const result = await fetchLatestChapter(mockMangaId);
      expect(result).toBeNull();
    });

    it("returns null when all chapters have null chapter attribute", async () => {
      vi.mocked(requestMangaDex).mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: [
              { id: "ch-1", attributes: { chapter: null } },
              { id: "ch-2", attributes: { chapter: null } },
            ],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        )
      );

      const result = await fetchLatestChapter(mockMangaId);
      expect(result).toBeNull();
    });

    it("returns null when all chapters are non-numeric strings (e.g. oneshot, prologue, extra)", async () => {
      vi.mocked(requestMangaDex).mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: [
              { id: "ch-1", attributes: { chapter: "oneshot" } },
              { id: "ch-2", attributes: { chapter: "prologue" } },
              { id: "ch-3", attributes: { chapter: "extra" } },
              { id: "ch-4", attributes: { chapter: "NaN" } },
            ],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        )
      );

      const result = await fetchLatestChapter(mockMangaId);
      expect(result).toBeNull();
    });
  });

  describe("Valid parsed chapter results", () => {
    it("returns the highest chapter number when valid numeric chapters exist", async () => {
      vi.mocked(requestMangaDex).mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: [
              { id: "ch-1", attributes: { chapter: "42" } },
              { id: "ch-2", attributes: { chapter: "41.5" } },
              { id: "ch-3", attributes: { chapter: "41" } },
            ],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        )
      );

      const result = await fetchLatestChapter(mockMangaId);
      expect(result).toBe(42);
    });

    it("correctly extracts max even if chapters are out of order or include null/unparseable entries", async () => {
      vi.mocked(requestMangaDex).mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: [
              { id: "ch-1", attributes: { chapter: "10" } },
              { id: "ch-2", attributes: { chapter: "99.5" } },
              { id: "ch-3", attributes: { chapter: "oneshot" } },
              { id: "ch-4", attributes: { chapter: null } },
              { id: "ch-5", attributes: { chapter: "50" } },
            ],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        )
      );

      const result = await fetchLatestChapter(mockMangaId);
      expect(result).toBe(99.5);
    });
  });

  describe("Rate-limit and Network error propagation", () => {
    it("propagates MangaDexRateLimitError when requestMangaDex throws it", async () => {
      vi.mocked(requestMangaDex).mockRejectedValueOnce(
        new MangaDexRateLimitError("Rate limit exceeded")
      );

      await expect(fetchLatestChapter(mockMangaId)).rejects.toThrow(MangaDexRateLimitError);
    });

    it("throws when response body is not valid JSON", async () => {
      vi.mocked(requestMangaDex).mockResolvedValueOnce(
        new Response("<!DOCTYPE html><html><body>Error</body></html>", {
          status: 200,
          headers: { "Content-Type": "text/html" },
        })
      );

      await expect(fetchLatestChapter(mockMangaId)).rejects.toThrow(
        "Failed to parse MangaDex feed JSON response"
      );
    });
  });

  describe("Options and Query Parameters", () => {
    it("passes timeoutMs and deadline options to requestMangaDex", async () => {
      vi.mocked(requestMangaDex).mockResolvedValueOnce(
        new Response(JSON.stringify({ data: [] }), { status: 200 })
      );

      const deadline = Date.now() + 5000;
      await fetchLatestChapter(mockMangaId, {
        timeoutMs: 3000,
        deadline,
      });

      expect(requestMangaDex).toHaveBeenCalledWith(
        expect.any(URL),
        expect.objectContaining({
          timeoutMs: 3000,
          deadline,
          waitForRateLimit: true,
          maxRetries: 3,
        })
      );
    });

    it("constructs URL with includeFuturePublishAt=0 by default and omits includeExternalUrl", async () => {
      vi.mocked(requestMangaDex).mockResolvedValueOnce(
        new Response(JSON.stringify({ data: [] }), { status: 200 })
      );

      await fetchLatestChapter(mockMangaId);

      const calledUrl = vi.mocked(requestMangaDex).mock.calls[0][0] as URL;
      expect(calledUrl.searchParams.get("includeFuturePublishAt")).toBe("0");
      expect(calledUrl.searchParams.get("includeExternalUrl")).toBeNull();
      expect(calledUrl.searchParams.get("limit")).toBe("10");
      expect(calledUrl.searchParams.get("order[chapter]")).toBe("desc");
      expect(calledUrl.searchParams.getAll("translatedLanguage[]")).toEqual(["en"]);
    });

    it("returns null immediately without calling requestMangaDex if mangadexId is invalid", async () => {
      const result = await fetchLatestChapter("");
      expect(result).toBeNull();
      expect(requestMangaDex).not.toHaveBeenCalled();
    });
  });
});
