import { type ReadingStatus } from "@prisma/client";

/**
 * Pure function to determine if a tracked series has unread chapters.
 *
 * Decided Semantics:
 * hasUpdate means "unread chapters exist":
 * - latestChapter is not null
 * - latestChapter > lastReadChapter
 * - status is READING or ON_HOLD
 *
 * COMPLETED and DROPPED never flag, regardless of chapter numbers.
 */
export function computeHasUpdate(
  latestChapter: number | null,
  lastReadChapter: number,
  status: ReadingStatus
): boolean {
  if (latestChapter === null) {
    return false;
  }

  if (status !== "READING" && status !== "ON_HOLD") {
    return false;
  }

  return latestChapter > lastReadChapter;
}
