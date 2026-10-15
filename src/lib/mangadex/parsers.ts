import { z } from "zod";

// Lenient Zod schemas for MangaDex API responses
export const mangadexRelationshipSchema = z
  .object({
    type: z.string(),
    attributes: z
      .object({
        fileName: z.string().optional(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough();

export const mangadexSearchResponseSchema = z
  .object({
    data: z
      .array(
        z
          .object({
            id: z.string(),
            attributes: z
              .object({
                title: z.record(z.string(), z.string()).optional(),
                contentRating: z.string().optional(),
              })
              .passthrough()
              .optional(),
            relationships: z.array(mangadexRelationshipSchema).optional(),
          })
          .passthrough()
      )
      .optional()
      .default([]),
  })
  .passthrough();

export const mangadexMangaResponseSchema = z
  .object({
    data: z
      .object({
        id: z.string(),
        attributes: z
          .object({
            title: z.record(z.string(), z.string()).optional(),
            contentRating: z.string().optional(),
          })
          .passthrough()
          .optional(),
        relationships: z.array(mangadexRelationshipSchema).optional(),
      })
      .passthrough()
      .optional()
      .nullable(),
  })
  .passthrough();

/**
 * Validates that any stored or extracted cover URL is hosted on uploads.mangadex.org.
 */
export function isMangadexUploadHost(url: string | null | undefined): boolean {
  if (!url) return false;
  try {
    const parsed = new URL(url);
    return parsed.hostname === "uploads.mangadex.org";
  } catch {
    return false;
  }
}

/**
 * Normalizes localized title object from MangaDex API:
 * Prefers 'en', falls back to the first available language key, or returns empty string if none.
 */
export function normalizeMangaDexTitle(titleObj?: Record<string, string> | null): string {
  if (!titleObj || typeof titleObj !== "object") {
    return "";
  }

  if (typeof titleObj.en === "string" && titleObj.en.trim().length > 0) {
    return titleObj.en.trim();
  }

  const keys = Object.keys(titleObj);
  for (const key of keys) {
    const val = titleObj[key];
    if (typeof val === "string" && val.trim().length > 0) {
      return val.trim();
    }
  }

  return "";
}

/**
 * Extracts and constructs the full cover URL from the MangaDex relationships array.
 * URL pattern: https://uploads.mangadex.org/covers/{manga_id}/{cover_filename}
 */
export function extractCoverUrl(
  mangaId: string,
  relationships?: Array<{ type: string; attributes?: { fileName?: string } }> | null
): string | null {
  if (!relationships || !Array.isArray(relationships) || !mangaId) {
    return null;
  }

  const coverRel = relationships.find(
    (rel) => rel.type === "cover_art" && rel.attributes && rel.attributes.fileName
  );

  if (!coverRel?.attributes?.fileName) {
    return null;
  }

  const url = `https://uploads.mangadex.org/covers/${mangaId}/${coverRel.attributes.fileName}`;
  return isMangadexUploadHost(url) ? url : null;
}
