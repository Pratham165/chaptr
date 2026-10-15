import { Redis } from "@upstash/redis";
import { Ratelimit } from "@upstash/ratelimit";

const redisUrl = process.env.UPSTASH_REDIS_REST_URL;
if (!redisUrl) {
  throw new Error("UPSTASH_REDIS_REST_URL is not set");
}

const redisToken = process.env.UPSTASH_REDIS_REST_TOKEN;
if (!redisToken) {
  throw new Error("UPSTASH_REDIS_REST_TOKEN is not set");
}

export const redis = new Redis({
  url: redisUrl,
  token: redisToken,
});

export const REDIS_KEY_PREFIX = process.env.REDIS_KEY_PREFIX || "";

// User action rate limiter: 10 requests per 10 seconds
export const userActionRatelimit = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(10, "10 s"),
  analytics: true,
  prefix: `${REDIS_KEY_PREFIX}@chaptr/ratelimit`,
});

// Shared rate limiter for MangaDex API: limited to 4 requests per second globally across the whole app.
// Kept at slidingWindow(4, "1 s") to stay safely under MangaDex's ~5 req/s guaranteed minimum rate limit and prevent IP bans.
export const mangadexRatelimit = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(4, "1 s"),
  analytics: true,
  prefix: `${REDIS_KEY_PREFIX}@chaptr/mangadex-ratelimit`,
});

// Separate auth rate limiters: 5 attempts per 15 min per email, 20 attempts per 15 min per IP
export const authLoginEmailRatelimit = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(5, "15 m"),
  analytics: true,
  prefix: `${REDIS_KEY_PREFIX}@chaptr/auth-login-email-ratelimit`,
});

export const authLoginIpRatelimit = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(20, "15 m"),
  analytics: true,
  prefix: `${REDIS_KEY_PREFIX}@chaptr/auth-login-ip-ratelimit`,
});

export const authRegisterEmailRatelimit = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(5, "15 m"),
  analytics: true,
  prefix: `${REDIS_KEY_PREFIX}@chaptr/auth-register-email-ratelimit`,
});

export const authRegisterIpRatelimit = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(20, "15 m"),
  analytics: true,
  prefix: `${REDIS_KEY_PREFIX}@chaptr/auth-register-ip-ratelimit`,
});

/**
 * Safely extracts client IP from Request, Headers, or object with get().
 * Priority order:
 * 1. x-vercel-forwarded-for
 * 2. x-real-ip
 * 3. x-forwarded-for (ONLY if process.env.TRUST_XFF === "true")
 * Never trusts cf-connecting-ip or unverified x-forwarded-for.
 * Returns null if no valid IP could be determined (never uses a shared fallback address).
 */
export function getClientIp(
  reqOrHeaders?: Request | Headers | { get: (name: string) => string | null } | null
): string | null {
  if (!reqOrHeaders) return null;
  const headers =
    "headers" in reqOrHeaders && reqOrHeaders.headers
      ? (reqOrHeaders.headers as Headers)
      : (reqOrHeaders as Headers);

  const vercelForwardedFor = headers.get("x-vercel-forwarded-for");
  if (vercelForwardedFor) {
    const firstIp = vercelForwardedFor.split(",")[0]?.trim();
    if (firstIp) return firstIp;
  }

  const realIp = headers.get("x-real-ip");
  if (realIp) {
    const trimmed = realIp.trim();
    if (trimmed) return trimmed;
  }

  if (process.env.TRUST_XFF === "true") {
    const forwardedFor = headers.get("x-forwarded-for");
    if (forwardedFor) {
      const firstIp = forwardedFor.split(",")[0]?.trim();
      if (firstIp) return firstIp;
    }
  }

  return null;
}

let hasWarnedMissingIp = false;

export function warnMissingIpOnce(): void {
  if (!hasWarnedMissingIp) {
    hasWarnedMissingIp = true;
    console.warn("Client IP could not be determined; skipping IP rate limit");
  }
}

export function resetMissingIpWarn(): void {
  hasWarnedMissingIp = false;
}

export default redis;
