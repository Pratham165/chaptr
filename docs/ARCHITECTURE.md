# Chaptr — Architecture

## System overview (text diagram)

```
┌─────────────┐      ┌──────────────────┐      ┌─────────────┐
│   Browser   │◄────►│  Next.js App     │◄────►│   Neon      │
│  (Next.js   │      │  (App Router,    │      │  (Postgres, │
│   client)   │      │   API routes,    │      │   via Prisma│
└─────────────┘      │   server actions)│      │   + adapter)│
                      └────────┬─────────┘      └─────────────┘
                               │
                 ┌─────────────┼─────────────┐
                 ▼             ▼             ▼
          ┌───────────┐ ┌───────────┐ ┌──────────────┐
          │  NextAuth │ │  Upstash  │ │  Background  │
          │  (session/│ │  Redis    │ │  job (cron)  │
          │  OAuth)   │ │  (cache + │ │  polls       │
          │           │ │  rate     │ │  MangaDex    │
          │           │ │  limit)   │ │  API         │
          └───────────┘ └───────────┘ └──────┬───────┘
                                              ▼
                                      ┌───────────────┐
                                      │  MangaDex API │
                                      │  (external)   │
                                      └───────────────┘
```

## Why these choices

**Next.js App Router** — colocates UI, server actions, and API routes; server
actions remove the need for a separate REST layer for most CRUD (adding a series,
updating progress).

**Prisma + Neon (driver adapter)** — Neon's serverless Postgres pairs with
Prisma's Neon adapter to avoid TCP connection overhead on Vercel's serverless
functions. Pinned to Prisma 6.x specifically because Prisma 7 changed the
datasource/adapter API in a way that broke compatibility with this setup at the
time this project was built — see AGENTS.md for the versioning rule.

**NextAuth.js (Auth.js v5)** — handles authentication (Google OAuth + credentials)
without hand-rolled security flaws. Uses stateless JWT sessions (`strategy: "jwt"`,
`maxAge: 7 days`, `updateAge: 1 day`) stored in secure, `httpOnly` cookies. Because
the Credentials provider in Auth.js requires JWT sessions, the database `Session` table
is unused, and immediate server-side revocation is not supported. E2E tests authenticate
using the real UI login form (`/login`), verifying the full credentials flow.

**Upstash Redis** — two jobs: (1) rate-limiting login/signup and the background
job's calls to MangaDex, (2) caching MangaDex API responses so repeated lookups
(e.g. multiple users tracking the same series) don't each hit the external API.
REST-based, so it works from serverless functions without connection pooling
concerns.

**Background job (chapter polling)** — the core differentiator of the app. On a
schedule, it iterates tracked series, checks MangaDex for the latest chapter,
and writes an `updatedAt`/`latestChapter` value the dashboard reads. Kept
separate from user-facing request paths so a slow/failed external API call never
blocks a page load.

**MangaDex API over scraping** — public, documented, free. Scraping other sites
is fragile (breaks on any HTML change) and legally greyer; not worth the risk or
maintenance cost for a portfolio project.

## Data flow: chapter update check
 
1. **Trigger & Scheduling**: GitHub Actions triggers `POST /api/cron/check-chapters` every 30 minutes, with a Vercel cron daily schedule (`0 0 * * *`) acting as backstop. Both supply `Authorization: Bearer <CRON_SECRET>`.
2. **Fail-Closed Gatekeeper**: The endpoint enforces constant-time bearer token validation using `crypto.timingSafeEqual` and fails closed (HTTP 500) if `CRON_SECRET` is unset or shorter than 32 characters. User sessions cannot authorize this route.
3. **Distributed Locking**: `runChapterCheck` attempts `SET NX lock:chapter-check locked` in Redis with TTL equal to `timeBudgetMs + 2000ms`. If held, it skips execution immediately (`skippedLocked: true`) to prevent overlapping runner execution.
4. **Stalest-First Batching**: Queries only tracked series (`where: { trackedBy: { some: {} } }`) ordered by `lastCheckedAt` ascending with NULLs first (`{ sort: "asc", nulls: "first" }`), limited to `batchSize` (default 30).
5. **Time-Budget Execution**: Evaluates elapsed execution time before each series. If elapsed time reaches `timeBudgetMs` (default 8000ms), stops immediately (`stoppedEarly: true`) to guarantee serverless lambda completion safely inside Vercel's 10s function duration limit.
6. **MangaDex Chapter Fetch**: Outbound feed calls use `requestMangaDex` under global `mangadexRatelimit` (4 req/s) with `includeFuturePublishAt=0` (explicitly excluding future chapters).
   - *Limitation (English only)*: Fetches only English chapters (`translatedLanguage[]=en`) for MVP. Multi-language feed selection is deferred.
   - *Numeric Max Parsing*: Chapter strings are parsed into numbers, discarding null/NaN/non-finite values and taking the numeric MAX of the page (never trusting sort order).
7. **Monotonicity & Starvation Prevention**:
   - `latestChapter` is strictly monotonic: if MangaDex returns a lower number, `latestChapter` is never decreased.
   - `lastCheckedAt` is updated on EVERY attempt (even on network or parsing failure) so a broken series never starves the queue.
8. **Unread Semantics (`computeHasUpdate`)**:
   - Evaluated atomically via `computeHasUpdate(latestChapter, lastReadChapter, status)`:
     `hasUpdate = latestChapter !== null && latestChapter > lastReadChapter && (status === "READING" || status === "ON_HOLD")`
   - `COMPLETED` and `DROPPED` series never flag for updates.
   - When a newer chapter is discovered, a single database transaction updates `Series.latestChapter` and `lastCheckedAt`, then sets `hasUpdate: true` on matching `ReadingProgress` rows.
9. **Dashboard Presentation**:
   - `/dashboard` queries `ReadingProgress` rows scoped to `session.user.id` where `hasUpdate = true`.
   - Navigation header renders a red dot + count indicator badge.
   - Users can click "Mark caught up" to synchronize `lastReadChapter` to `latestChapter`, instantly clearing the unread flag.

## Folder structure

```
src/
  app/
    (auth)/login, register        — public auth pages
    (dashboard)/dashboard, library — authenticated app shell
    api/auth/[...nextauth]         — NextAuth route handler
  lib/
    db.ts            — Prisma client singleton (Neon adapter)
    auth.ts          — NextAuth config (providers, callbacks, adapter)
    redis.ts         — Upstash client + rate limiter instances
    validations/     — Zod schemas, one file per resource (series, progress, user)
  components/
    ui/              — shadcn primitives
    providers/       — LenisProvider, motion wrappers
  types/             — shared TS types not generated by Prisma
```

Each `lib/` file is a single responsibility singleton — no business logic lives
in `lib/`, only client setup. Business logic lives in server actions or route
handlers that import from `lib/`.
