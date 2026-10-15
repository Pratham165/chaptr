# Chaptr — Testing

## Philosophy

For a solo/portfolio project, testing everything isn't the goal — testing the
things that are *expensive to get wrong* is. Two categories get non-negotiable
coverage: **authorization** (can user A touch user B's data) and **the chapter
update logic** (the actual differentiator of the app). Everything else is tested
where it's cheap and valuable, not exhaustively.

## What to unit test (Vitest)

- **Zod schemas** — valid input passes, invalid input is rejected with the
  expected error (e.g. `createSeriesSchema` rejects empty title, negative
  chapter numbers).
- **Ownership/authorization logic** — any helper that checks "does this
  `userId` match the session," and any server action that fetches/mutates
  user-owned rows, tested with both the owning user and a different user to
  confirm the second one is rejected.
- **Chapter comparison logic** — the function that decides "is this a new
  chapter" given a stored value and a MangaDex response, including edge cases
  (equal chapter number, malformed/missing data from the API, decimal chapter
  numbers like `10.5`).
- **Rate limiter integration points** — that a blocked request is actually
  rejected, not just logged.

## What to e2e test (Playwright)

- **Signup → login → logout** full flow.
- **Add a series → appears in library** flow.
- **Update reading progress → reflected in UI** flow.
- **Cross-user isolation at the UI level**: log in as user A, confirm user B's
  library/series are never rendered or reachable via direct URL manipulation.
- **Dashboard "new chapter" indicator** appears after the background job marks
  an update (can be simulated by directly seeding the test DB rather than
  waiting for a real MangaDex response).

Skip e2e coverage for purely visual/animation behavior (Framer Motion
transitions, Lenis scroll feel) — not worth the flakiness.

## Conventions

- Test files: `*.test.ts` next to the file they test for units
  (`lib/validations/series.test.ts`), `e2e/*.spec.ts` for Playwright specs.
- Use a separate test database (or Prisma's test-transaction pattern) — never
  run tests against the real dev/prod Neon database.
- Mock the MangaDex API in unit tests; e2e tests either mock it at the network
  level or seed the DB directly rather than depending on live external data.
- One assertion focus per test — prefer several small, clearly-named tests
  (`"rejects update when userId does not match session"`) over one large test
  covering multiple behaviors.

## Coverage expectations

- No hard percentage target — coverage tools can be run for visibility but
  chasing a number isn't the goal.
- Non-negotiable: every server action or route handler that reads/writes
  `Series`, `ReadingProgress`, or `User` data has at least one test proving
  ownership is enforced.
- Non-negotiable: the chapter-update comparison logic has tests before it's
  considered done, since it's silent-failure-prone (wrong comparison = users
  just never see updates, with no error to notice).

## Running tests

```bash
npm run test          # Vitest, unit tests
npm run test:watch    # Vitest watch mode
npm run test:e2e       # Playwright, full e2e suite
npm run test:e2e:ui    # Playwright with UI mode for debugging
```

## E2E Test Database Isolation

Playwright tests **never** write into the primary development or production database.

### Environment Configuration
Configure isolated test database connection strings in `.env`:
```bash
DATABASE_URL_TEST="postgresql://.../neondb_test?sslmode=require&channel_binding=require"
DIRECT_URL_TEST="postgresql://.../neondb_test?sslmode=require&channel_binding=require"
```

### Safety Guards
`playwright.config.ts` strictly enforces database isolation:
1. `DATABASE_URL_TEST` must be explicitly defined; otherwise the test run refuses to start with an error.
2. `DATABASE_URL_TEST` must not be identical to `DATABASE_URL`; if identical, the run immediately aborts to protect production/dev data.
3. Both the Playwright test runner process and the Next.js `webServer` launched by Playwright run with `DATABASE_URL` and `DIRECT_URL` overridden by the test URLs.

### Applying Migrations to the Test Branch
To apply existing Prisma migrations to the test database branch without touching the real database or modifying `prisma/schema.prisma`, use the cross-platform npm script:

```bash
npm run db:migrate:test
```

This script:
1. Loads `.env` and verifies both `DATABASE_URL_TEST` and `DIRECT_URL_TEST`.
2. Refuses to run if either URL is missing or identical to the normal `DATABASE_URL` / `DIRECT_URL`.
3. Runs `prisma migrate deploy` with `DATABASE_URL` and `DIRECT_URL` overridden for that child process only.

### Seed Data & Global Teardown
- All seeded test users use unique dynamic emails per run with the `e2e-` prefix and `@example.test` domain (e.g., `e2e-reader-${Date.now()}@example.test`, `e2e-user1-unread-${Date.now()}@example.test`). This ensures rate limits (e.g. 5 login attempts per 15 min per email) never collide across consecutive test runs.
- All seeded series must have titles starting with `"E2E"` (e.g., `"E2E Chainsaw Hero"`).
- Playwright's `globalTeardown` hook (`e2e/global-teardown.ts`) automatically executes after all test runs, deleting all rows matching these markers to guarantee clean state.

### Redis Namespace Isolation
To prevent E2E tests from interfering with development or production rate limiters, search caches, or cron locks:
- `playwright.config.ts` sets `REDIS_KEY_PREFIX = "e2e:"` in both the test runner process and the Next.js `webServer`.
- All Upstash Ratelimit prefixes (`@chaptr/*`), MangaDex caches (`mangadex:*`), and cron locks (`lock:chapter-check`) automatically prepend this prefix.
- E2E tests run against isolated Redis keys and do not pollute production limits.

CI (if/when set up) should block merges on `npm run test` and `npm run build`
failing; `test:e2e` can run on a slower schedule (e.g. pre-deploy) if full e2e
runs become slow.

