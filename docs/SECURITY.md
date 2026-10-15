# Chaptr — Security

## Threat model (specific to this app)

Chaptr stores per-user reading data (which series, what chapter, reading status)
tied to an account. It's not high-value data like payment info, but it's still
personal — the realistic threats are:

1. **Cross-user data access** — one user reading/modifying another user's library
   or progress (broken object-level authorization / IDOR).
2. **Account takeover** — weak password handling, session/token theft via XSS.
3. **Credential stuffing / brute force** — automated login attempts.
4. **Secrets leakage** — API keys (Neon, Upstash, NextAuth secret, OAuth secrets)
   ending up in the client bundle or git history.
5. **Abuse of the background job / external API** — a bug or attack causing
   excessive calls to MangaDex, getting the app's IP rate-limited or banned.
6. **Injection** — SQL injection via raw queries, XSS via unescaped user input
   (e.g. custom notes on a series, if that feature is ever added).

## Practices to follow

### Authentication & Sessions
- NextAuth.js (Auth.js v5) handles sessions and OAuth — never hand-roll login, token generation,
  or password reset flows.
- Passwords (for credentials-based signup) hashed with bcrypt at `BCRYPT_ROUNDS = 12`
  only — never MD5/SHA1, never stored plaintext. Non-existent user login attempts run a
  constant-time dummy bcrypt compare to prevent account enumeration.
- Session strategy is stateless **JWT** (`strategy: "jwt"`):
  - Tokens are signed and stored exclusively in `httpOnly`, `sameSite: "lax"`, secure cookies (never `localStorage`).
  - Session lifetime is explicitly bounded: `maxAge = 7 days` (604,800 seconds) and `updateAge = 1 day` (86,400 seconds).
  - **No server-side revocation**: Because JWT sessions are stateless, individual sessions cannot be revoked server-side prior to expiration.
  - The `Session` table is unused with the JWT strategy (it is part of the standard Prisma adapter schema). Credentials login works with JWT sessions.
- E2E tests authenticate through the real UI login form (`/login`), verifying the real Credentials flow and session cookie setting.

### Authorization (the most important one for this app)
- Every DB query touching `Series`, `ReadingProgress`, or `User` data must
  filter by the authenticated session's `userId` — not a client-supplied ID.
- Pattern: `db.readingProgress.findMany({ where: { userId: session.user.id } })`
  — never `where: { userId: req.body.userId }`.
- Before merging any PR/feature touching user data, explicitly check: "can user
  A see or modify user B's data through this endpoint?"

### Secrets
- All secrets live in `.env` / `.env.local`, never hardcoded.
- `.env*` confirmed in `.gitignore` before the first commit — verify with
  `git check-ignore -v .env`.
- `.env.example` lists variable names only, never real values, and is the only
  env file that should ever be committed.
- Upstash token and Resend key (if reintroduced) are used server-side only —
  never referenced in a `"use client"` component or exposed via a public API
  response.

### Rate limiting & Failure Policy
- Login and registration endpoints are rate-limited via Upstash Ratelimit to thwart credential stuffing and spam:
  - Registration: 5 attempts per 15 min per email; 20 attempts per 15 min per IP.
  - Login: 5 attempts per 15 min per email; 20 attempts per 15 min per IP.
  - Client IP extraction prioritizes `x-vercel-forwarded-for`, then `x-real-ip`. `x-forwarded-for` is ignored unless `TRUST_XFF=true` is explicitly configured. If no IP is detected, the IP limiter is safely skipped (never grouped into a shared fallback address).
- **Fail-Closed Policy for Auth Redis Outages**:
  - If Upstash Redis is unreachable or throws during login or registration rate limiting, the authentication system **fails closed**: it rejects the attempt with a user-friendly `"Service temporarily unavailable. Please try again later."` error.
  - *Rationale*: Failing open during a Redis outage would leave login and registration unprotected against brute-force and credential stuffing attacks exactly when monitoring or rate-limiting infrastructure is degraded. Failing closed guarantees defense-in-depth while communicating a transient service issue to legitimate users.
- Background job's calls to MangaDex are rate-limited and cached (via Redis) to
  avoid abuse of the external API and avoid getting IP-banned.

### Cron endpoint threat model (`/api/cron/check-chapters`)
- **Threat**: Unauthenticated attackers invoking the endpoint to trigger MangaDex API calls, exhaust rate limits, or cause Denial of Service.
  - *Defense*: Authorization via `Authorization: Bearer <CRON_SECRET>`.
  - *Fail-Closed*: If `CRON_SECRET` is missing, undefined, or shorter than 32 characters, the endpoint immediately returns HTTP 500 and NEVER runs the check. It never compares against the string `"undefined"`.
  - *Timing Attacks*: Token validation uses `crypto.timingSafeEqual` on equal-length buffers to eliminate side-channel timing discrepancies. Mismatched or invalid tokens return a bare 401 with zero error detail.
  - *Session Cookie Isolation*: User authentication cookies (`auth()`) are completely ignored on this route; session cookies can never authorize the cron job.
  - *Concurrent Run Prevention*: Distributed Redis lock (`SET NX` with `px` TTL) prevents overlapping execution if multiple schedulers trigger simultaneously.

### Input validation
- Every server action / API route validates input with Zod before it touches
  the DB or an external API call. No raw `req.body` usage without a schema.

### Injection / XSS
- All DB access through Prisma (parameterized) — no raw SQL string
  interpolation with user input.
- React/Next auto-escape rendered content by default; `dangerouslySetInnerHTML`
  is not used anywhere in this codebase. If a future feature needs to render
  user-generated rich text, it goes through a sanitizer first — flag this as a
  design decision to revisit if it comes up.

### Security Headers & Content Security Policy (CSP)
- Global security headers are configured in `next.config.mjs` for all routes:
  - `X-Content-Type-Options: nosniff`
  - `X-Frame-Options: DENY`
  - `Referrer-Policy: strict-origin-when-cross-origin`
  - `Permissions-Policy: camera=(), microphone=(), geolocation=()`
- HSTS preload, `includeSubDomains`, and strict CSP are intentionally deferred.
- A Report-Only CSP (`Content-Security-Policy-Report-Only`) is planned as a follow-up to measure and baseline external asset requirements (e.g. MangaDex cover CDN, OAuth providers) before enforcement.

### Dependency hygiene
- Run `npm audit` periodically, especially after adding a new package via an AI
  coding assistant — vibe-coded projects accumulate dependencies fast.

## What NOT to do

- Do not trust any ID (`userId`, `seriesId`) coming from the client without
  verifying it against the authenticated session or the owning relation.
- Do not log secrets, tokens, or full request bodies containing credentials.
- Do not add a new OAuth provider, storage bucket, or third-party integration
  without adding its secret to `.env.example` and confirming it's excluded from
  git.
- Do not disable TypeScript strict mode or Zod validation "temporarily to get
  something working" — this is exactly how vibe-coded security holes happen.
