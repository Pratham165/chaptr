import { z } from "zod";
import { requestMangaDex } from "@/lib/mangadex";
import { extractMaxChapterNumber } from "./parse-chapter";

// Lenient Zod schema for MangaDex chapter feed response
const mangadexFeedChapterSchema = z
  .object({
    id: z.string().optional(),
    type: z.string().optional(),
    attributes: z
      .object({
        chapter: z.string().nullable().optional(),
        publishAt: z.string().nullable().optional(),
        externalUrl: z.string().nullable().optional(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough();

const mangadexFeedResponseSchema = z
  .object({
    data: z.array(mangadexFeedChapterSchema).optional().default([]),
  })
  .passthrough();

export interface FetchLatestChapterOptions {
  includeFuturePublishAt?: "0" | "1";
  includeExternalUrl?: "0" | "1";
  timeoutMs?: number;
  deadline?: number;
}

/**
 * Fetches the latest published English chapter for a manga from MangaDex.
 *
 * Endpoint: GET /manga/{id}/feed
 * Query Parameters:
 * - translatedLanguage[]=en (English only for now)
 * - order[chapter]=desc
 * - limit=10
 * - contentRating[]=safe
 * - contentRating[]=suggestive
 * - includeFuturePublishAt=0 (explicitly excludes future-dated chapters where publishAt > NOW())
 * - includeExternalUrl: In MangaDex API v5, setting includeExternalUrl=1 restricts results
 *   strictly to external-link chapters (dropping native MangaDex-hosted chapters), while
 *   includeExternalUrl=0 restricts strictly to native chapters (dropping external links).
 *   When omitted/unset, MangaDex returns BOTH native and external-link chapters.
 *   Default leaves it unset to include external-link chapters without dropping native chapters.
 *
 * Error / Return contract:
 * - Any non-2xx HTTP response (including 404, 500, etc.) THROWS an Error so the runner marks
 *   the attempt as failed instead of falsely treating it as an empty/successful check.
 * - Returns null ONLY when response is 2xx and the chapter list is genuinely empty or all
 *   chapter numbers are unparseable (null/NaN/garbage).
 */
export async function fetchLatestChapter(
  mangadexId: string,
  options: FetchLatestChapterOptions = {}
): Promise<number | null> {
  if (!mangadexId || typeof mangadexId !== "string") {
    return null;
  }

  const url = new URL(`https://api.mangadex.org/manga/${mangadexId}/feed`);
  url.searchParams.append("translatedLanguage[]", "en");
  url.searchParams.set("order[chapter]", "desc");
  url.searchParams.set("limit", "10");
  url.searchParams.append("contentRating[]", "safe");
  url.searchParams.append("contentRating[]", "suggestive");

  // Explicitly set includeFuturePublishAt to exclude future-dated releases (publishAt <= NOW())
  url.searchParams.set(
    "includeFuturePublishAt",
    options.includeFuturePublishAt ?? "0"
  );

  // If explicitly specified by caller, set includeExternalUrl
  if (options.includeExternalUrl !== undefined) {
    url.searchParams.set("includeExternalUrl", options.includeExternalUrl);
  }

  // Uses centralized outbound fetch with waitForRateLimit: true and deadline-aware timeout
  const response = await requestMangaDex(url, {
    waitForRateLimit: true,
    maxRetries: 3,
    timeoutMs: options.timeoutMs,
    deadline: options.deadline,
  });

  // Any non-2xx response throws an error so runner marks it as failed
  if (!response.ok) {
    throw new Error(
      `MangaDex feed error: ${response.status} ${response.statusText}`
    );
  }

  let rawJson: unknown;
  try {
    rawJson = await response.json();
  } catch {
    throw new Error("Failed to parse MangaDex feed JSON response");
  }

  const parsed = mangadexFeedResponseSchema.safeParse(rawJson);
  if (!parsed.success) {
    throw new Error("Invalid MangaDex feed response structure");
  }

  const chapters = parsed.data.data ?? [];
  return extractMaxChapterNumber(chapters);
}
