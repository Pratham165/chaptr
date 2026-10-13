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

// User action rate limiter: 10 requests per 10 seconds
export const userActionRatelimit = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(10, "10 s"),
  analytics: true,
  prefix: "@chaptr/ratelimit",
});

// Shared rate limiter for MangaDex API: limited to 4 requests per second globally across the whole app.
// Kept at slidingWindow(4, "1 s") to stay safely under MangaDex's ~5 req/s guaranteed minimum rate limit and prevent IP bans.
export const mangadexRatelimit = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(4, "1 s"),
  analytics: true,
  prefix: "@chaptr/mangadex-ratelimit",
});

export default redis;
