# Chaptr — Product Requirements Document

## Problem

People reading ongoing manga/manhwa/manhua across multiple series lose track of:
1. What chapter they last read, per series
2. Whether a series they follow has released a new chapter

Today this is solved with mental notes, browser bookmarks, or checking each source
site manually — all of which break down past 5-10 series being followed at once.

## Target user

Someone actively reading 5+ ongoing series across one or more sources (MangaDex,
official apps, etc.) who wants a single place to track progress and get surfaced
when something new drops, without manually checking each source.

## Core user stories

- As a user, I can create an account and log in, so my library is mine and persists.
- As a user, I can add a series to my library (search by title), so I can track it.
- As a user, I can record my current chapter/volume progress per series.
- As a user, I can mark a series as Reading / On Hold / Completed / Dropped.
- As a user, I can see on my dashboard which of my series have unread new chapters.
- As a user, I can remove a series from my library.
- As a user, I cannot see or modify another user's library or progress.

## MVP scope

- Email/password + OAuth (Google) auth
- Add/remove series (backed by MangaDex API search)
- Per-user reading progress (chapter number, status)
- Background job polling MangaDex for new chapters on tracked series
- Dashboard: library list + "new chapter" indicator
- Basic responsive UI, no email notifications yet

## Explicitly out of scope for MVP

- Email/push notifications (Resend) — deferred to v2
- Recommendation engine
- Browser extension
- Multi-source scraping beyond MangaDex's public API
- Social features (following other users, sharing lists)

## Success criteria

- A user can go from signup → tracked series → visible "new chapter" flag without
  manual refreshing, end to end, with no cross-user data leakage.
- Background job runs on a schedule without manual triggering and without hitting
  MangaDex rate limits.
- Core flows (auth, add series, update progress) covered by tests before being
  considered "done."

## Future scope (v2+)

- Email digest via Resend
- Reading stats / analytics dashboard
- Recommendations based on genre/tag overlap
- Real-time updates via WebSockets/SSE instead of polling on load
