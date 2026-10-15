# Chaptr — Code Style

## Naming

- **Files**: `kebab-case.ts` / `kebab-case.tsx` (e.g. `reading-progress-card.tsx`)
- **Components**: `PascalCase` for the component, matching the file's primary
  export (e.g. `ReadingProgressCard` in `reading-progress-card.tsx`)
- **Functions/variables**: `camelCase`
- **Types/interfaces**: `PascalCase`, no `I` prefix (`Series`, not `ISeries`)
- **Zod schemas**: suffix with `Schema` (`createSeriesSchema`), inferred types
  suffix with `Input`/`Payload` where relevant (`CreateSeriesInput`)
- **DB models (Prisma)**: `PascalCase` singular (`Series`, `ReadingProgress`,
  `User`) — Prisma convention

## File structure conventions

- One component per file, default export for pages/route components, named
  export for shared/reusable components.
- Server actions live next to the feature that uses them (e.g.
  `src/app/(dashboard)/library/actions.ts`), not centralized in one giant file.
- Zod schemas live in `src/lib/validations/`, one file per resource
  (`series.ts`, `progress.ts`, `user.ts`), imported by both client forms and
  server actions so validation logic isn't duplicated.
- Source files should generally stay under 200 lines to maintain readability and modularity. Test files are exempt from the 200-line guideline.

## TypeScript conventions

- Strict mode on, always. No `any` — use `unknown` and narrow, or fix the type.
- Prefer `type` for object shapes and unions, `interface` only when extending
  is genuinely needed.
- Derive types from Zod schemas with `z.infer<typeof schema>` rather than
  hand-writing a duplicate type.
- No non-null assertions (`!`) on values that can realistically be
  null/undefined at runtime (env vars are the one accepted exception, and even
  then prefer a small `getEnv()` helper that throws a clear error).

## Component patterns

- Server Components by default; add `"use client"` only when the component
  needs interactivity, state, or a browser API (including anything using
  Framer Motion or the Lenis provider).
- Keep data-fetching in Server Components/server actions, not `useEffect` +
  client-side fetch, unless the data is genuinely client-only (e.g. live UI
  state).
- Co-locate a component's types directly above it if they're only used there;
  move to `types/` only if shared across files.
- Tailwind classes: layout → spacing → typography → color → state, roughly in
  that order, for scannability. Don't fight this too hard, but keep it
  consistent within a file.

## Commit messages

Conventional commits, lowercase, imperative mood:

```
feat: add series search to library page
fix: prevent cross-user access on progress update action
chore: pin prisma to 6.19.3 across client/adapter/cli
docs: add architecture and security docs
test: cover ownership check on readingProgress update
```

Types used: `feat`, `fix`, `chore`, `docs`, `test`, `refactor`. Scope prefix
optional (`feat(library): ...`) when it adds clarity.

## Formatting

- Prettier + ESLint (Next.js default config) — no manual formatting debates,
  run the formatter before committing.
- No commented-out dead code left in commits — delete it, git history has it if
  needed later.
