import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { LibraryView } from "./library-view";
import { type TrackedSeriesItem } from "@/types/library";

export const metadata = {
  title: "Library — Chaptr",
  description: "Track your reading progress, bookmarks, and chapter updates.",
};

export default async function LibraryPage() {
  const session = await auth();

  if (!session?.user?.id) {
    redirect("/login");
  }

  // Fetch the current user's tracked series, strictly filtering by authenticated session userId
  const trackedSeries = await db.readingProgress.findMany({
    where: {
      userId: session.user.id,
    },
    include: {
      series: true,
    },
    orderBy: {
      updatedAt: "desc",
    },
  });

  return <LibraryView initialSeries={trackedSeries as unknown as TrackedSeriesItem[]} />;
}
