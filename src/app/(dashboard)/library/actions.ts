"use server";

import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import {
  addSeriesSchema,
  updateReadingProgressSchema,
  removeSeriesSchema,
  searchQuerySchema,
  type ReadingStatus,
} from "@/lib/validations/library";
import {
  searchMangaDex,
  getMangaDexSeries,
  isMangadexUploadHost,
  MangaDexRateLimitError,
  MangaDexUnavailableError,
  type MangaDexSearchResult,
} from "@/lib/mangadex";
import { userActionRatelimit } from "@/lib/redis";
import { AuthorizationError } from "@/lib/errors";
import { computeHasUpdate } from "@/lib/chapters";
import type { ReadingProgress, Series } from "@prisma/client";

export type ActionResult<T = unknown> =
  | { ok: true; data: T }
  | { ok: false; error: string };

function handleActionError(err: unknown): ActionResult<never> {
  if (err instanceof z.ZodError) {
    return {
      ok: false,
      error: err.issues[0]?.message || "Validation failed",
    };
  }
  if (
    err instanceof AuthorizationError ||
    err instanceof MangaDexRateLimitError ||
    err instanceof MangaDexUnavailableError
  ) {
    return { ok: false, error: err.message };
  }
  console.error("Action error:", err);
  return {
    ok: false,
    error: "Something went wrong. Please try again.",
  };
}

/**
 * Adds a series from MangaDex to the authenticated user's library.
 * Accepts only mangadexId (validated as a UUID). Title and coverUrl are fetched server-side from MangaDex.
 * If the Series row already exists, never overwrites title/coverUrl.
 * Catches P2002 to prevent race condition duplicates.
 */
export async function addSeriesToLibrary(
  mangadexId: string
): Promise<ActionResult<ReadingProgress & { series: Series }>> {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return {
        ok: false,
        error: "You must be logged in to add a series to your library",
      };
    }
    const userId = session.user.id;

    // Rate limit per user for adding series: separate bucket from search
    let userLimit;
    try {
      userLimit = await userActionRatelimit.limit(`add:${userId}`);
    } catch (rlErr) {
      console.warn("User add rate limit check failed:", rlErr);
    }

    if (userLimit && !userLimit.success) {
      return {
        ok: false,
        error: "Too many requests. Please slow down.",
      };
    }

    const validated = addSeriesSchema.parse({ mangadexId });

    // 1. Fetch metadata server-side from MangaDex (uses mangadexRatelimit & Redis cache)
    const manga = await getMangaDexSeries(validated.mangadexId);
    if (!manga) {
      return { ok: false, error: "Series not found on MangaDex" };
    }

    // Enforce content rating: reject series outside safe and suggestive
    const ALLOWED_CONTENT_RATINGS = new Set(["safe", "suggestive"]);
    if (!manga.contentRating || !ALLOWED_CONTENT_RATINGS.has(manga.contentRating)) {
      return { ok: false, error: "This series isn't available" };
    }

    // Ensure coverUrl host is uploads.mangadex.org
    const safeCoverUrl = isMangadexUploadHost(manga.coverUrl)
      ? manga.coverUrl
      : null;

    // 2. Upsert Series by mangadexId (never overwrite title/coverUrl on update)
    const series = await db.series.upsert({
      where: { mangadexId: validated.mangadexId },
      update: {}, // Never overwrite title/coverUrl from user input
      create: {
        mangadexId: validated.mangadexId,
        title: manga.title,
        coverUrl: safeCoverUrl,
      },
    });

    // 3. Compute initial hasUpdate based on series.latestChapter
    const hasUpdate = computeHasUpdate(series.latestChapter, 0, "READING");

    // 4. Attempt creation directly and catch P2002 to prevent duplicate race conditions
    try {
      const readingProgress = await db.readingProgress.create({
        data: {
          userId,
          seriesId: series.id,
          status: "READING",
          lastReadChapter: 0,
          hasUpdate,
        },
        include: {
          series: true,
        },
      });

      revalidatePath("/library");
      return { ok: true, data: readingProgress };
    } catch (createErr: unknown) {
      if (
        createErr &&
        typeof createErr === "object" &&
        "code" in createErr &&
        (createErr as { code: string }).code === "P2002"
      ) {
        return {
          ok: false,
          error: "You are already tracking this series in your library",
        };
      }
      throw createErr;
    }
  } catch (err: unknown) {
    return handleActionError(err);
  }
}

/**
 * Updates reading progress (chapter number, status) for a tracked series.
 * Recomputes hasUpdate based on series.latestChapter.
 * Uses a where clause filtering by { id, userId } to enforce ownership.
 */
export async function updateReadingProgress(
  readingProgressId: string,
  lastReadChapter: number,
  status: ReadingStatus
): Promise<ActionResult<ReadingProgress & { series: Series }>> {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return {
        ok: false,
        error: "You must be logged in to update reading progress",
      };
    }
    const userId = session.user.id;

    const validated = updateReadingProgressSchema.parse({
      readingProgressId,
      lastReadChapter,
      status,
    });

    // 1. Fetch reading progress with series filtering by { id, userId }
    const progress = await db.readingProgress.findFirst({
      where: {
        id: validated.readingProgressId,
        userId,
      },
      include: {
        series: true,
      },
    });

    if (!progress) {
      return { ok: false, error: "Reading progress record not found" };
    }

    // 2. Recompute hasUpdate using shared pure computeHasUpdate function
    const hasUpdate = computeHasUpdate(
      progress.series.latestChapter,
      validated.lastReadChapter,
      validated.status
    );

    // 3. Update using updateMany with { id, userId } and check count === 1
    const updateResult = await db.readingProgress.updateMany({
      where: {
        id: validated.readingProgressId,
        userId,
      },
      data: {
        lastReadChapter: validated.lastReadChapter,
        status: validated.status,
        hasUpdate,
      },
    });

    if (updateResult.count !== 1) {
      return { ok: false, error: "Reading progress record not found" };
    }

    const updated: ReadingProgress & { series: Series } = {
      ...progress,
      lastReadChapter: validated.lastReadChapter,
      status: validated.status,
      hasUpdate,
    };

    revalidatePath("/library");
    revalidatePath("/dashboard");
    return { ok: true, data: updated };
  } catch (err: unknown) {
    return handleActionError(err);
  }
}

/**
 * Removes a tracked series from the authenticated user's library.
 * Replaces fetch-then-compare with a single deleteMany using { id, userId } and checks count === 1.
 */
export async function removeSeriesFromLibrary(
  readingProgressId: string
): Promise<ActionResult<{ success: boolean }>> {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return {
        ok: false,
        error: "You must be logged in to remove a series from your library",
      };
    }
    const userId = session.user.id;

    const validated = removeSeriesSchema.parse({ readingProgressId });

    // Single deleteMany using { id, userId } in where clause and check count === 1
    const deleteResult = await db.readingProgress.deleteMany({
      where: {
        id: validated.readingProgressId,
        userId,
      },
    });

    if (deleteResult.count !== 1) {
      return { ok: false, error: "Reading progress record not found" };
    }

    revalidatePath("/library");
    return { ok: true, data: { success: true } };
  } catch (err: unknown) {
    return handleActionError(err);
  }
}

/**
 * Server action to search MangaDex by title.
 * Validates query with Zod, limits per-user (10 searches/10s), and handles MangaDex rate limits.
 */
export async function searchMangaAction(
  query: string
): Promise<ActionResult<MangaDexSearchResult[]>> {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return { ok: false, error: "You must be logged in to search MangaDex" };
    }

    const validatedQuery = searchQuerySchema.parse(query);

    // Rate limit per user: 10 searches per 10s
    let userLimit;
    try {
      userLimit = await userActionRatelimit.limit(session.user.id);
    } catch (rlErr) {
      console.warn("User search rate limit check failed:", rlErr);
    }

    if (userLimit && !userLimit.success) {
      return {
        ok: false,
        error: "Too many search requests. Please slow down.",
      };
    }

    const result = await searchMangaDex(validatedQuery);
    if (result.error) {
      return { ok: false, error: result.error };
    }

    return { ok: true, data: result.results };
  } catch (err: unknown) {
    return handleActionError(err);
  }
}
