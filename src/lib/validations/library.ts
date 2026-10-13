import { z } from "zod";

export const readingStatusEnum = z.enum([
  "READING",
  "ON_HOLD",
  "COMPLETED",
  "DROPPED",
  ]);

export type ReadingStatus = z.infer<typeof readingStatusEnum>;

export const addSeriesSchema = z.object({
  mangadexId: z.string().trim().uuid("Invalid MangaDex ID format"),
});

export type AddSeriesInput = z.infer<typeof addSeriesSchema>;

export const updateReadingProgressSchema = z.object({
  readingProgressId: z.string().trim().min(1, "Reading progress ID is required"),
  lastReadChapter: z
    .number()
    .finite("Chapter number must be a finite number")
    .min(0, "Chapter number cannot be negative")
    .max(99999, "Chapter number cannot exceed 99999"),
  status: readingStatusEnum,
});

export type UpdateReadingProgressInput = z.infer<typeof updateReadingProgressSchema>;

export const removeSeriesSchema = z.object({
  readingProgressId: z.string().trim().min(1, "Reading progress ID is required"),
});

export type RemoveSeriesInput = z.infer<typeof removeSeriesSchema>;

export const searchQuerySchema = z
  .string()
  .trim()
  .min(2, "Search query must be at least 2 characters")
  .max(100, "Search query must be at most 100 characters");

export type SearchQueryInput = z.infer<typeof searchQuerySchema>;
