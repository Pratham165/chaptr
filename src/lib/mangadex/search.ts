import { redis, REDIS_KEY_PREFIX } from "@/lib/redis";
import { requestMangaDex } from "./client";
import {
  mangadexSearchResponseSchema,
  normalizeMangaDexTitle,
  extractCoverUrl,
} from "./parsers";
import {
  SEARCH_CACHE_TTL_SECONDS,
  MangaDexRateLimitError,
  type MangaDexSearchResult,
  type SearchMangaDexResult,
  type MangaDexRequestOptions,
} from "./types";

/**
 * Searches MangaDex by title with expanded cover art, using shared Upstash rate limiting
 * and Redis caching (5 min TTL).
 */
export async function searchMangaDex(
  query: string,
  options: MangaDexRequestOptions = {}
): Promise<SearchMangaDexResult> {
  const trimmed = query.trim();
  if (!trimmed) {
    return {
      results: [],
      error: null,
    };
  }

  const cacheKey = `${REDIS_KEY_PREFIX}mangadex:search:${trimmed.toLowerCase()}`;

  // 1. Check Redis cache first to avoid consuming rate limit tokens
  try {
    const cached = await redis.get<MangaDexSearchResult[]>(cacheKey);
    if (cached && Array.isArray(cached)) {
      return {
        results: cached,
        error: null,
      };
    }
  } catch (cacheErr) {
    console.warn("MangaDex search cache read failed, falling back to network:", cacheErr);
  }

  // 2. Build URL
  const url = new URL("https://api.mangadex.org/manga");
  url.searchParams.set("title", trimmed);
  url.searchParams.append("includes[]", "cover_art");
  url.searchParams.set("limit", "15");
  url.searchParams.set("order[relevance]", "desc");
  url.searchParams.append("contentRating[]", "safe");
  url.searchParams.append("contentRating[]", "suggestive");

  // 3. Perform network request through rate limiter
  let response: Response;
  try {
    response = await requestMangaDex(url, options);
  } catch (err: unknown) {
    if (err instanceof MangaDexRateLimitError) {
      return {
        results: [],
        error: err.message,
      };
    }
    console.error("MangaDex search network error:", err);
    return {
      results: [],
      error: "Something went wrong. Please try again.",
    };
  }

  if (!response.ok) {
    return {
      results: [],
      error: `MangaDex error: ${response.status} ${response.statusText}`,
    };
  }

  // 4. Parse and normalize results
  let rawJson: unknown;
  try {
    rawJson = await response.json();
  } catch (parseErr) {
    console.error("Failed to parse MangaDex search response JSON:", parseErr);
    return {
      results: [],
      error: "Failed to parse MangaDex response",
    };
  }

  const parsed = mangadexSearchResponseSchema.safeParse(rawJson);
  if (!parsed.success) {
    console.error("Invalid MangaDex search response structure:", parsed.error);
    return {
      results: [],
      error: "Failed to parse MangaDex response",
    };
  }

  const rawList = parsed.data.data ?? [];

  const results: MangaDexSearchResult[] = rawList.map((item) => {
    const mangadexId = item.id;
    const title = normalizeMangaDexTitle(item.attributes?.title) || "Untitled Series";
    const coverUrl = extractCoverUrl(item.id, item.relationships);
    return {
      mangadexId,
      title,
      coverUrl,
    };
  });

  // 5. Cache successful result in Redis with 5-minute TTL
  try {
    await redis.set(cacheKey, results, { ex: SEARCH_CACHE_TTL_SECONDS });
  } catch (cacheSetErr) {
    console.warn("MangaDex search cache write failed:", cacheSetErr);
  }

  return {
    results,
    error: null,
  };
}
