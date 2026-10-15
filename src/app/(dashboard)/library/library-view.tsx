"use client";

import { useState, useMemo } from "react";
import { motion, useReducedMotion, type Variants } from "framer-motion";
import { type ReadingStatus } from "@/lib/validations/library";
import { ReadingProgressCard } from "./reading-progress-card";
import { LibrarySearch } from "./library-search";
import { type TrackedSeriesItem } from "@/types/library";

interface LibraryViewProps {
  initialSeries: TrackedSeriesItem[];
}

type FilterTab = "ALL" | ReadingStatus;

export function LibraryView({ initialSeries }: LibraryViewProps) {
  const [seriesList, setSeriesList] = useState<TrackedSeriesItem[]>(initialSeries);
  const [activeFilter, setActiveFilter] = useState<FilterTab>("ALL");
  const shouldReduceMotion = useReducedMotion();

  // Set of tracked MangaDex IDs to disable "Add" button for already-tracked series
  const trackedMangadexIds = useMemo(() => {
    return new Set(seriesList.map((item) => item.series.mangadexId));
  }, [seriesList]);

  // Filter series according to active tab, sorting series with hasUpdate first
  const filteredSeries = useMemo(() => {
    const list =
      activeFilter === "ALL"
        ? seriesList
        : seriesList.filter((item) => item.status === activeFilter);
    return [...list].sort((a, b) => {
      if (a.hasUpdate === b.hasUpdate) return 0;
      return a.hasUpdate ? -1 : 1;
    });
  }, [seriesList, activeFilter]);

  const handleUpdate = (updated: TrackedSeriesItem) => {
    setSeriesList((prev) =>
      prev.map((item) => (item.id === updated.id ? updated : item))
    );
  };

  const handleRemove = (id: string) => {
    setSeriesList((prev) => prev.filter((item) => item.id !== id));
  };

  const handleAdd = (newProgress: TrackedSeriesItem) => {
    setSeriesList((prev) => [newProgress, ...prev]);
  };

  // Motion variants conforming strictly to docs/DESIGN_SYSTEM.md:
  // Stagger-fade on mount, 40ms stagger, ease-out, no spring bounce, no scale pop
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

  const filterTabs: Array<{ id: FilterTab; label: string; count: number }> = [
    { id: "ALL", label: "All Series", count: seriesList.length },
    {
      id: "READING",
      label: "Reading",
      count: seriesList.filter((s) => s.status === "READING").length,
    },
    {
      id: "ON_HOLD",
      label: "On Hold",
      count: seriesList.filter((s) => s.status === "ON_HOLD").length,
    },
    {
      id: "COMPLETED",
      label: "Completed",
      count: seriesList.filter((s) => s.status === "COMPLETED").length,
    },
    {
      id: "DROPPED",
      label: "Dropped",
      count: seriesList.filter((s) => s.status === "DROPPED").length,
    },
  ];

  return (
    <div className="space-y-8">
      {/* Top Header & Search Area */}
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-6 pb-6 border-b border-ink-700">
        <div className="space-y-1">
          <h1 className="font-serif text-3xl sm:text-4xl font-bold tracking-tight text-paper-50">
            Library
          </h1>
          <p className="text-paper-400 text-sm">
            Track reading progress, chapter bookmarks, and updates.
          </p>
        </div>

        {/* MangaDex Search Component */}
        <LibrarySearch
          trackedMangadexIds={trackedMangadexIds}
          onSeriesAdded={handleAdd}
        />
      </div>

      {/* Filter Tabs */}
      <div className="flex items-center gap-1 overflow-x-auto pb-2 border-b border-ink-700/60 scrollbar-none">
        {filterTabs.map((tab) => {
          const isActive = activeFilter === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveFilter(tab.id)}
              className={`px-3 py-1.5 text-xs font-medium rounded-[4px] transition-colors whitespace-nowrap flex items-center gap-2 ${
                isActive
                  ? "bg-ink-700 text-paper-50"
                  : "text-paper-400 hover:text-paper-50 hover:bg-ink-900"
              }`}
            >
              <span>{tab.label}</span>
              <span
                className={`text-[10px] px-1.5 py-0.2 rounded-[2px] font-mono ${
                  isActive
                    ? "bg-ink-950 text-paper-50"
                    : "bg-ink-950/60 text-paper-400"
                }`}
              >
                {tab.count}
              </span>
            </button>
          );
        })}
      </div>

      {/* Tracked Series Grid or Halftone Empty State */}
      {filteredSeries.length > 0 ? (
        <motion.div
          key={activeFilter}
          variants={containerVariants}
          initial="hidden"
          animate="show"
          className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6"
        >
          {filteredSeries.map((item) => (
            <motion.div key={item.id} variants={itemVariants}>
              <ReadingProgressCard
                item={item}
                onUpdate={handleUpdate}
                onRemove={handleRemove}
              />
            </motion.div>
          ))}
        </motion.div>
      ) : (
        <div className="relative rounded-[4px] border border-ink-700 bg-ink-900/40 p-12 overflow-hidden text-center">
          {/* Halftone dot pattern per DESIGN_SYSTEM.md */}
          <div className="absolute inset-0 halftone-pattern pointer-events-none" />

          <div className="relative z-10 max-w-md mx-auto space-y-3">
            <h3 className="font-serif text-xl font-medium text-paper-50">
              No titles in this section
            </h3>
            <p className="text-sm text-paper-400">
              {seriesList.length === 0
                ? "Your library is currently empty. Use the search bar above to look up series on MangaDex and track your progress."
                : `No titles marked as "${filterTabs.find((t) => t.id === activeFilter)?.label}".`}
            </p>
          </div>
        </div>
      )}

      {/* MangaDex Compliance Credit */}
      <div className="pt-8 text-center sm:text-right">
        <span className="text-[11px] text-paper-400/80">
          Metadata & covers courtesy of{" "}
          <span className="text-paper-50 underline decoration-ink-700">MangaDex</span>
        </span>
      </div>
    </div>
  );
}
