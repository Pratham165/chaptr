import { type ReadingStatus } from "@/lib/validations/library";

export interface TrackedSeriesItem {
  id: string;
  userId: string;
  seriesId: string;
  status: ReadingStatus;
  lastReadChapter: number;
  hasUpdate: boolean;
  createdAt: Date;
  updatedAt: Date;
  series: {
    id: string;
    mangadexId: string;
    title: string;
    coverUrl: string | null;
    latestChapter: number | null;
    lastCheckedAt: Date | null;
  };
}
