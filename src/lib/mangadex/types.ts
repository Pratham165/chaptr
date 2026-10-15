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

export class MangaDexUnavailableError extends Error {
  constructor(
    message = "MangaDex is unavailable right now. Please try again shortly."
  ) {
    super(message);
    this.name = "MangaDexUnavailableError";
  }
}

export interface MangaDexRequestOptions {
  waitForRateLimit?: boolean;
  maxRetries?: number;
  timeoutMs?: number;
  deadline?: number;
}
