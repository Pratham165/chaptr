/**
 * Safely parses a raw chapter string from MangaDex into a finite number.
 * Discards null, undefined, whitespace-only, non-numeric strings, NaN, or non-finite numbers.
 */
export function parseChapterNumber(raw: string | null | undefined): number | null {
  if (raw === null || raw === undefined) {
    return null;
  }

  const trimmed = String(raw).trim();
  if (trimmed === "") {
    return null;
  }

  const parsed = Number(trimmed);
  if (isNaN(parsed) || !Number.isFinite(parsed)) {
    return null;
  }

  return parsed;
}

/**
 * Extracts the maximum numeric chapter number from a collection of MangaDex chapter entities.
 *
 * Requirements:
 * - Chapter numbers are strings and may be null, non-numeric, or decimal ("10.5").
 * - Discards null/NaN/non-finite values.
 * - Does not trust API sort order: explicitly evaluates the numeric MAX across the page.
 * - Returns null if no valid chapters are present.
 */
export function extractMaxChapterNumber(
  chapters?: Array<{ attributes?: { chapter?: string | null } | null } | null | undefined> | null
): number | null {
  if (!chapters || !Array.isArray(chapters) || chapters.length === 0) {
    return null;
  }

  let maxChapter: number | null = null;

  for (const item of chapters) {
    const rawChapter = item?.attributes?.chapter;
    const num = parseChapterNumber(rawChapter);
    if (num !== null) {
      if (maxChapter === null || num > maxChapter) {
        maxChapter = num;
      }
    }
  }

  return maxChapter;
}
