"use client";

import { useState, useTransition } from "react";
import Image from "next/image";
import Link from "next/link";
import { motion, useReducedMotion, type Variants } from "framer-motion";
import { updateReadingProgress } from "@/app/(dashboard)/library/actions";
import { type TrackedSeriesItem } from "@/types/library";

interface DashboardViewProps {
  initialUpdates: TrackedSeriesItem[];
}

export function DashboardView({ initialUpdates }: DashboardViewProps) {
  const [updates, setUpdates] = useState<TrackedSeriesItem[]>(initialUpdates);
  const [isPending, startTransition] = useTransition();
  const [processingId, setProcessingId] = useState<string | null>(null);
  const [errorMap, setErrorMap] = useState<Record<string, string>>({});
  const shouldReduceMotion = useReducedMotion();

  const handleMarkCaughtUp = (item: TrackedSeriesItem) => {
    if (item.series.latestChapter === null) {
      return;
    }

    setProcessingId(item.id);
    startTransition(async () => {
      try {
        const result = await updateReadingProgress(
          item.id,
          item.series.latestChapter!,
          item.status
        );

        if (!result.ok) {
          setErrorMap((prev) => ({ ...prev, [item.id]: result.error }));
        } else {
          // Remove from unread updates list
          setUpdates((prev) => prev.filter((u) => u.id !== item.id));
          setErrorMap((prev) => {
            const copy = { ...prev };
            delete copy[item.id];
            return copy;
          });
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        setErrorMap((prev) => ({
          ...prev,
          [item.id]: msg || "Failed to mark caught up",
        }));
      } finally {
        setProcessingId(null);
      }
    });
  };

  const containerVariants: Variants = {
    hidden: { opacity: 0 },
    show: {
      opacity: 1,
      transition: {
        staggerChildren: shouldReduceMotion ? 0 : 0.04,
      },
    },
  };

  const itemVariants: Variants = {
    hidden: { opacity: 0, y: shouldReduceMotion ? 0 : 8 },
    show: {
      opacity: 1,
      y: 0,
      transition: {
        duration: 0.25,
        ease: "easeOut",
      },
    },
  };

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 pb-6 border-b border-ink-700">
        <div className="space-y-1">
          <h1 className="font-serif text-3xl sm:text-4xl font-bold tracking-tight text-paper-50">
            Dashboard
          </h1>
          <p className="text-paper-400 text-sm">
            {updates.length} series with new chapters
          </p>
        </div>

        <Link
          href="/library"
          className="text-xs font-medium text-paper-400 hover:text-paper-50 transition-colors uppercase tracking-wider underline decoration-ink-700 underline-offset-4"
        >
          Go to Library &rarr;
        </Link>
      </div>

      {/* Unread Updates Grid */}
      {updates.length > 0 ? (
        <motion.div
          variants={containerVariants}
          initial="hidden"
          animate="show"
          className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6"
        >
          {updates.map((item) => {
            const isItemPending = isPending && processingId === item.id;
            const itemError = errorMap[item.id];

            return (
              <motion.div
                key={item.id}
                variants={itemVariants}
                className="group flex flex-col sm:flex-row bg-ink-900 border border-ink-700 rounded-[4px] overflow-hidden"
              >
                {/* Cover thumbnail */}
                <div className="relative w-full sm:w-36 h-48 sm:h-auto bg-ink-950 flex-shrink-0 overflow-hidden">
                  {item.series.coverUrl ? (
                    <Image
                      src={item.series.coverUrl}
                      alt={item.series.title}
                      fill
                      sizes="(max-width: 640px) 100vw, 150px"
                      className="object-cover transition-transform duration-300 group-hover:scale-105"
                      unoptimized
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center p-2 text-center">
                      <span className="font-serif text-paper-400 text-xs italic">
                        No cover
                      </span>
                    </div>
                  )}

                  {/* Red dot new chapter badge */}
                  <div className="absolute top-2 left-2 z-10 flex items-center gap-1 bg-accent-red text-paper-50 px-2 py-0.5 text-[10px] font-semibold rounded-[4px] uppercase tracking-wider">
                    New Ch.
                  </div>
                </div>

                {/* Content */}
                <div className="p-4 flex-1 flex flex-col justify-between space-y-4">
                  <div className="space-y-2">
                    <h3
                      className="font-serif text-base font-semibold text-paper-50 line-clamp-2 leading-snug"
                      title={item.series.title}
                    >
                      {item.series.title}
                    </h3>

                    {/* Last read vs latest chapter */}
                    <div className="space-y-1 text-xs">
                      <div className="flex items-center justify-between text-paper-400">
                        <span>Last read:</span>
                        <span className="font-mono text-paper-50 font-medium">
                          Ch. {item.lastReadChapter}
                        </span>
                      </div>
                      <div className="flex items-center justify-between text-accent-red font-medium">
                        <span>Latest available:</span>
                        <span className="font-mono font-semibold">
                          Ch. {item.series.latestChapter}
                        </span>
                      </div>
                    </div>
                  </div>

                  {itemError && (
                    <div className="text-xs text-accent-red bg-accent-red/10 border border-accent-red/20 px-2 py-1 rounded-[4px]">
                      {itemError}
                    </div>
                  )}

                  {/* Actions */}
                  <div className="pt-2 border-t border-ink-700/80 flex items-center justify-between gap-2">
                    <Link
                      href="/library"
                      className="text-xs text-paper-400 hover:text-paper-50 underline decoration-ink-700 underline-offset-2 transition-colors"
                    >
                      View in library
                    </Link>

                    {item.series.latestChapter !== null && (
                      <button
                        type="button"
                        disabled={isItemPending}
                        onClick={() => handleMarkCaughtUp(item)}
                        className="px-3 py-1.5 bg-accent-red hover:bg-accent-red-dim disabled:opacity-40 text-paper-50 text-xs font-medium rounded-[4px] transition-colors"
                      >
                        {isItemPending ? "Updating..." : "Mark caught up"}
                      </button>
                    )}
                  </div>
                </div>
              </motion.div>
            );
          })}
        </motion.div>
      ) : (
        <div className="relative rounded-[4px] border border-ink-700 bg-ink-900/40 p-12 overflow-hidden text-center">
          {/* Halftone dot pattern per DESIGN_SYSTEM.md */}
          <div className="absolute inset-0 halftone-pattern pointer-events-none" />

          <div className="relative z-10 max-w-md mx-auto space-y-3">
            <h3 className="font-serif text-xl font-medium text-paper-50">
              All caught up
            </h3>
            <p className="text-sm text-paper-400">
              No new chapters available. All your tracked series are currently
              up to date.
            </p>
            <div className="pt-2">
              <Link
                href="/library"
                className="inline-block px-4 py-2 border border-ink-700 bg-ink-950 hover:bg-ink-900 text-paper-50 text-xs font-medium rounded-[4px] transition-colors"
              >
                Return to library
              </Link>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
