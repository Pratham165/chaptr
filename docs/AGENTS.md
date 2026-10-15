# AGENTS.md — instructions for AI coding assistants working on Chaptr

This file governs how any AI coding tool (Antigravity, Cursor, Claude Code, etc.)
should behave in this repo. Read this before generating or modifying code.

## Versioning rules — do not deviate without explicit approval

- **Prisma must stay pinned to the same exact 6.x version across `prisma`,
  `@prisma/client`, and `@prisma/adapter-neon`.** Do not upgrade to Prisma 7 or
  let any of the three drift to a different version. If a task seems to require
  a version bump, stop and ask the user first.
- Do not add new major dependencies (a new DB, a new auth library, a new state
  manager) without asking — the stack is intentionally fixed (see
  ARCHITECTURE.md).

## Files to not touch without asking first

- `prisma/schema.prisma` — migrations affect production data; propose the change
  and wait for confirmation before running `prisma migrate`.
- `.env`, `.env.local` — never write real secret values into any file that isn't
  gitignored. Never print secret values back into chat/logs.
- `src/lib/auth.ts` — auth config changes have security implications; explain the
  change and why before applying it.

## Conventions to follow

- TypeScript strict mode stays on. Do not add `any` to silence an error — fix the
  underlying type issue or ask if the type is genuinely unknown.
- All user input crossing a server boundary (server action, API route) must be
  validated with a Zod schema from `src/lib/validations/` before touching the DB.
- Every query/mutation that touches a `Series`, `ReadingProgress`, or any
  user-owned row must filter or check `userId` against the current session.
  Never write a query that trusts a client-supplied `userId`.
- Follow CODE_STYLE.md for naming, file structure, and component patterns.
- Follow TESTING.md when adding a new feature — auth and ownership logic changes
  require a test, not optional for those two areas.

## Running and testing locally

```bash
npm run dev              # start dev server
npx prisma studio         # inspect DB visually
npx prisma migrate dev    # apply schema changes (ask before running)
npm run test              # Vitest unit tests
npm run test:e2e          # Playwright e2e tests
npm run build              # must pass with zero errors before considering a task done
```

## Definition of done for any feature task

1. Code compiles (`npm run build` passes)
2. Relevant tests added/updated and passing
3. No secrets hardcoded, `.env.example` updated if a new env var was introduced
4. Ownership/authorization checked for any new DB access touching user data
5. Matches DESIGN_SYSTEM.md if the change touches UI

## When uncertain

Ask rather than assume, specifically for: schema changes, auth changes, new
dependencies, anything touching rate limiting or secrets. Silent, confident
mistakes in these areas are the expensive kind.

## Other instructions

Make a new summary.md file and update it after every change. It should properly summarise what you did and its impact on the project.