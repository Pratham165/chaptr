import { z } from "zod";
import { redis, mangadexRatelimit, REDIS_KEY_PREFIX } from "@/lib/redis";

export function getMangaDexUserAgent(): string {
  const contact = process.env.MANGADEX_CONTACT;
  if (!contact) {
    if (process.env.NODE_ENV === "production") {
      throw new Error("MANGADEX_CONTACT environment variable is required in production");
    }
    console.warn("MANGADEX_CONTACT environment variable is unset");
    return "Chaptr/1.0";
  }
  return `Chaptr/1.0 (+${contact})`;
}

export const SEARCH_CACHE_TTL_SECONDS = 300; // 5 minutes
export const NOT_FOUND_CACHE_TTL_SECONDS = 600; // 10 minutes

export interface MangaDexSearchResult {
  mangadexId: string;
  title: string;
  coverUrl: string | null;
  contentRating?: string | null;
}

export interface SearchMangaDexResult {
  results: MangaDexSearchResult[];
  error: string | null;
}

export class MangaDexRateLimitError extends Error {
  public retryAfterMs?: number;

  constructor(message = "Rate limited, try again shortly", retryAfterMs?: number) {
    super(message);
    this.name = "MangaDexRateLimitError";
    this.retryAfterMs = retryAfterMs;
  }
}

// Lenient Zod schemas for MangaDex API responses
const mangadexRelationshipSchema = z
  .object({
    type: z.string(),
    attributes: z
      .object({
        fileName: z.string().optional(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough();

const mangadexSearchResponseSchema = z
  .object({
    data: z
      .array(
        z
          .object({
            id: z.string(),
            attributes: z
              .object({
                title: z.record(z.string(), z.string()).optional(),
                contentRating: z.string().optional(),
              })
              .passthrough()
              .optional(),
            relationships: z.array(mangadexRelationshipSchema).optional(),
          })
          .passthrough()
      )
      .optional()
      .default([]),
  })
  .passthrough();

const mangadexMangaResponseSchema = z
  .object({
    data: z
      .object({
        id: z.string(),
        attributes: z
          .object({
            title: z.record(z.string(), z.string()).optional(),
            contentRating: z.string().optional(),
          })
          .passthrough()
          .optional(),
        relationships: z.array(mangadexRelationshipSchema).optional(),
      })
      .passthrough()
      .optional()
      .nullable(),
  })
  .passthrough();

/**
 * Validates that any stored or extracted cover URL is hosted on uploads.mangadex.org.
 */
export function isMangadexUploadHost(url: string | null | undefined): boolean {
  if (!url) return false;
  try {
    const parsed = new URL(url);
    return parsed.hostname === "uploads.mangadex.org";
  } catch {
    return false;
  }
}

/**
 * Normalizes localized title object from MangaDex API:
 * Prefers 'en', falls back to the first available language key, or returns empty string if none.
 */
export function normalizeMangaDexTitle(titleObj?: Record<string, string> | null): string {
  if (!titleObj || typeof titleObj !== "object") {
    return "";
  }

  if (typeof titleObj.en === "string" && titleObj.en.trim().length > 0) {
    return titleObj.en.trim();
  }

  const keys = Object.keys(titleObj);
  for (const key of keys) {
    const val = titleObj[key];
    if (typeof val === "string" && val.trim().length > 0) {
      return val.trim();
    }
  }

  return "";
}

/**
 * Extracts and constructs the full cover URL from the MangaDex relationships array.
 * URL pattern: https://uploads.mangadex.org/covers/{manga_id}/{cover_filename}
 */
export function extractCoverUrl(
  mangaId: string,
  relationships?: Array<{ type: string; attributes?: { fileName?: string } }> | null
): string | null {
  if (!relationships || !Array.isArray(relationships) || !mangaId) {
    return null;
  }

  const coverRel = relationships.find(
    (rel) => rel.type === "cover_art" && rel.attributes && rel.attributes.fileName
  );

  if (!coverRel?.attributes?.fileName) {
    return null;
  }

  const url = `https://uploads.mangadex.org/covers/${mangaId}/${coverRel.attributes.fileName}`;
  return isMangadexUploadHost(url) ? url : null;
}

export interface MangaDexRequestOptions {
  waitForRateLimit?: boolean;
  maxRetries?: number;
  timeoutMs?: number;
  deadline?: number;
}

/**
 * Centralized outbound fetch handler for MangaDex requests.
 * Enforces mangadexRatelimit globally (~5 req/s).
 *
 * If waitForRateLimit is true (e.g. background sync jobs), it waits and retries.
 * If waitForRateLimit is false (live UI requests), it throws MangaDexRateLimitError immediately.
 */
export async function requestMangaDex(
  url: string | URL,
  options: MangaDexRequestOptions = {}
): Promise<Response> {
  const { waitForRateLimit = false, maxRetries = 3, timeoutMs, deadline } = options;
  let attempts = 0;

  while (attempts <= maxRetries) {
    attempts++;

    // 1. Enforce global shared rate limit (~5 req/s)
    let rateLimitResult;
    try {
      rateLimitResult = await mangadexRatelimit.limit("mangadex-global");
    } catch (rlErr) {
      console.warn("MangaDex rate limit check failed:", rlErr);
    }

    if (rateLimitResult && !rateLimitResult.success) {
      const resetMs = (rateLimitResult.reset ?? Date.now() + 1000) - Date.now();
      const waitMs = Math.max(200, resetMs);
      if (waitForRateLimit && attempts <= maxRetries) {
        if (deadline && Date.now() + waitMs >= deadline) {
          throw new MangaDexRateLimitError("Rate limit wait would exceed deadline", waitMs);
        }
        await new Promise((resolve) => setTimeout(resolve, waitMs));
        continue;
      }
      throw new MangaDexRateLimitError("Rate limited, try again shortly", waitMs);
    }

    // 2. Perform network request with deadline-aware timeout
    let effectiveTimeout = timeoutMs ?? 8000;
    if (deadline) {
      const remainingBeforeDeadline = deadline - Date.now();
      effectiveTimeout = Math.min(effectiveTimeout, Math.max(100, remainingBeforeDeadline));
    }

    let response: Response;
    try {
      response = await fetch(url.toString(), {
        method: "GET",
        headers: {
          "User-Agent": getMangaDexUserAgent(),
        },
        signal: AbortSignal.timeout(effectiveTimeout),
      });
    } catch (networkErr: unknown) {
      const errorMsg =
        networkErr instanceof Error ? networkErr.message : String(networkErr);
      throw new Error(errorMsg || "Failed to connect to MangaDex");
    }

    // 3. HTTP 429 explicit handling
    if (response.status === 429) {
      const retryAfterHeader = response.headers.get("Retry-After");
      const retryAfterSeconds = retryAfterHeader ? parseInt(retryAfterHeader, 10) : 2;
      const waitMs = isNaN(retryAfterSeconds) ? 2000 : retryAfterSeconds * 1000;
      if (waitForRateLimit && attempts <= maxRetries) {
        if (deadline && Date.now() + waitMs >= deadline) {
          throw new MangaDexRateLimitError("Rate limit wait would exceed deadline", waitMs);
        }
        await new Promise((resolve) => setTimeout(resolve, waitMs));
        continue;
      }
      throw new MangaDexRateLimitError("Rate limited, try again shortly", waitMs);
    }

    return response;
  }

  throw new MangaDexRateLimitError("Rate limited, try again shortly");
}

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
    return null;
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
    throw new Error(`MangaDex error: ${response.status} ${response.statusText}`);
  }

  // 4. Parse response
  let rawJson: unknown;
  try {
    rawJson = await response.json();
  } catch (parseErr) {
    console.error("Failed to parse MangaDex series response JSON:", parseErr);
    throw new Error("Failed to parse MangaDex response");
  }

  const parsed = mangadexMangaResponseSchema.safeParse(rawJson);
  if (!parsed.success) {
    console.error("Invalid MangaDex series response structure:", parsed.error);
    throw new Error("Failed to parse MangaDex response");
  }

  if (!parsed.data.data) {
    return null;
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
