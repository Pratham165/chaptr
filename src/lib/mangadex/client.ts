import { mangadexRatelimit } from "@/lib/redis";
import { MangaDexRateLimitError, type MangaDexRequestOptions } from "./types";

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

/**
 * Centralized outbound fetch handler for MangaDex requests.
 * Enforces mangadexRatelimit globally (4 req/s).
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

    // 1. Enforce global shared rate limit (4 req/s)
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
