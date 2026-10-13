export type ReadingStatus = "READING" | "COMPLETED" | "ON_HOLD" | "DROPPED" | "PLAN_TO_READ";

export type ContentType = "MANGA" | "MANHWA" | "MANHUA" | "COMIC";

export interface Series {
  id: string;
  title: string;
  type: ContentType;
  coverImage?: string;
  latestChapter?: number;
  currentChapter?: number;
  status: ReadingStatus;
  updatedAt: Date;
}
