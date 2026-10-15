import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { DashboardView } from "./dashboard-view";
import { type TrackedSeriesItem } from "@/types/library";

export const metadata = {
  title: "Dashboard — Chaptr",
  description: "Track series with newly released chapters.",
};

export default async function DashboardPage() {
  const session = await auth();

  if (!session?.user?.id) {
    redirect("/login");
  }

  // Strictly filter by authenticated session userId where hasUpdate = true
  const unreadUpdates = await db.readingProgress.findMany({
    where: {
      userId: session.user.id,
      hasUpdate: true,
    },
    include: {
      series: true,
    },
    orderBy: {
      updatedAt: "desc",
    },
  });

  return (
    <DashboardView
      initialUpdates={unreadUpdates as unknown as TrackedSeriesItem[]}
    />
  );
}
