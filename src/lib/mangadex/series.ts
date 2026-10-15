import { redis, REDIS_KEY_PREFIX } from "@/lib/redis";
import { requestMangaDex } from "./client";
import {
  mangadexMangaResponseSchema,
  normalizeMangaDexTitle,
  extractCoverUrl,
  isMangadexUploadHost,
} from "./parsers";
import {
  SEARCH_CACHE_TTL_SECONDS,
  NOT_FOUND_CACHE_TTL_SECONDS,
  MangaDexRateLimitError,
  MangaDexUnavailableError,
  type MangaDexSearchResult,
  type MangaDexRequestOptions,
} from "./types";

/**
 * Fetches single series metadata from MangaDex by ID with expanded cover art.
 * Reuses normalization helpers, verifies host uploads.mangadex.org, and caches in Redis.
 */
export async function getMangaDexSeries(
  mangaId: string,
  options: MangaDexRequestOptions = {}
): Promise<MangaDexSearchResult | null> {
  if (!mangaId) return null;

  const cacheKey = `${REDIS_KEY_PREFIX}mangadex:manga:${mangaId}`;
  const notFoundKey = `${REDIS_KEY_PREFIX}mangadex:manga:404:${mangaId}`;

  // 1. Check Redis cache
  try {
    const isNotFound = await redis.get(notFoundKey);
    if (isNotFound) {
      return null;
    }
    const cached = await redis.get<MangaDexSearchResult>(cacheKey);
    if (cached && typeof cached === "object" && cached.mangadexId) {
      return cached;
    }
  } catch (cacheErr) {
    console.warn("MangaDex series cache read failed, falling back to network:", cacheErr);
  }

  // 2. Build URL: GET /manga/{id}?includes[]=cover_art
  const url = new URL(`https://api.mangadex.org/manga/${mangaId}`);
  url.searchParams.append("includes[]", "cover_art");

  // 3. Outbound request through rate limiter
  let response: Response;
  try {
    response = await requestMangaDex(url, options);
  } catch (err: unknown) {
    if (err instanceof MangaDexRateLimitError) {
      throw err;
    }
    console.warn(`Failed to fetch series ${mangaId} from MangaDex:`, err);
    throw new MangaDexUnavailableError();
  }

  if (response.status === 404) {
    try {
      await redis.set(notFoundKey, true, { ex: NOT_FOUND_CACHE_TTL_SECONDS });
    } catch (cacheSetErr) {
      console.warn("MangaDex 404 cache write failed:", cacheSetErr);
    }
    return null;
  }

  if (!response.ok) {
    console.warn(`MangaDex returned error status ${response.status} for series ${mangaId}`);
    throw new MangaDexUnavailableError();
  }

  // 4. Parse response
  let rawJson: unknown;
  try {
    rawJson = await response.json();
  } catch (parseErr) {
    console.error("Failed to parse MangaDex series response JSON:", parseErr);
    throw new MangaDexUnavailableError();
  }

  const parsed = mangadexMangaResponseSchema.safeParse(rawJson);
  if (!parsed.success || !parsed.data.data) {
    console.error("Invalid MangaDex series response structure:", parsed.error);
    throw new MangaDexUnavailableError();
  }

  const rawCoverUrl = extractCoverUrl(parsed.data.data.id, parsed.data.data.relationships);
  const coverUrl = isMangadexUploadHost(rawCoverUrl) ? rawCoverUrl : null;
  const contentRating = parsed.data.data.attributes?.contentRating ?? null;

  const result: MangaDexSearchResult = {
    mangadexId: parsed.data.data.id,
    title: normalizeMangaDexTitle(parsed.data.data.attributes?.title) || "Untitled Series",
    coverUrl,
    contentRating,
  };

  // 5. Cache in Redis
  try {
    await redis.set(cacheKey, result, { ex: SEARCH_CACHE_TTL_SECONDS });
  } catch (cacheSetErr) {
    console.warn("MangaDex series cache write failed:", cacheSetErr);
  }

  return result;
}
