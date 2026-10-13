"use client";

import { useState, useTransition } from "react";
import Image from "next/image";
import { type ReadingStatus } from "@/lib/validations/library";
import { updateReadingProgress, removeSeriesFromLibrary } from "./actions";
import { type TrackedSeriesItem } from "@/types/library";

interface ReadingProgressCardProps {
  item: TrackedSeriesItem;
  onUpdate: (updated: TrackedSeriesItem) => void;
  onRemove: (id: string) => void;
}

const statusConfig: Record<
  ReadingStatus,
  { label: string; color: string; dot: string; bg: string }
> = {
  READING: {
    label: "Reading",
    color: "text-[#4A9B7F]",
    dot: "bg-[#4A9B7F]",
    bg: "border-[#4A9B7F]/30 bg-[#4A9B7F]/10",
  },
  ON_HOLD: {
    label: "On Hold",
    color: "text-[#C9A94B]",
    dot: "bg-[#C9A94B]",
    bg: "border-[#C9A94B]/30 bg-[#C9A94B]/10",
  },
  COMPLETED: {
    label: "Completed",
    color: "text-[#5B6FA8]",
    dot: "bg-[#5B6FA8]",
    bg: "border-[#5B6FA8]/30 bg-[#5B6FA8]/10",
  },
  DROPPED: {
    label: "Dropped",
    color: "text-[#8C867A]",
    dot: "bg-[#8C867A]",
    bg: "border-[#8C867A]/30 bg-[#8C867A]/10",
  },
};

export function ReadingProgressCard({
  item,
  onUpdate,
  onRemove,
}: ReadingProgressCardProps) {
  const [isPending, startTransition] = useTransition();
  const [chapter, setChapter] = useState<number>(item.lastReadChapter);
  const [status, setStatus] = useState<ReadingStatus>(item.status);
  const [isEditing, setIsEditing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const hasChanges =
    chapter !== item.lastReadChapter || status !== item.status;

  const handleSave = () => {
    if (chapter < 0) {
      setError("Chapter cannot be negative");
      return;
    }
    setError(null);

    startTransition(async () => {
      try {
        const result = await updateReadingProgress(item.id, chapter, status);
        if (!result.ok) {
          setError(result.error);
        } else {
          onUpdate(result.data as TrackedSeriesItem);
          setIsEditing(false);
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        setError(msg || "Failed to update progress");
      }
    });
  };

  const handleQuickIncrement = (delta: number) => {
    const newChapter = Math.max(0, Number((chapter + delta).toFixed(1)));
    setChapter(newChapter);
    setError(null);

    startTransition(async () => {
      try {
        const result = await updateReadingProgress(item.id, newChapter, status);
        if (!result.ok) {
          setError(result.error);
          setChapter(item.lastReadChapter);
        } else {
          onUpdate(result.data as TrackedSeriesItem);
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        setError(msg || "Failed to update chapter");
        setChapter(item.lastReadChapter);
      }
    });
  };

  const handleDelete = () => {
    startTransition(async () => {
      try {
        const result = await removeSeriesFromLibrary(item.id);
        if (!result.ok) {
          setError(result.error);
          setConfirmDelete(false);
        } else {
          onRemove(item.id);
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        setError(msg || "Failed to remove series");
        setConfirmDelete(false);
      }
    });
  };

  const currentStatus = statusConfig[item.status] || statusConfig.READING;

  return (
    <div className="group relative flex flex-col bg-ink-900 border border-ink-700 rounded-[4px] overflow-hidden transition-all">
      {/* Cover Image Container */}
      <div className="relative aspect-[3/4] w-full bg-ink-950 overflow-hidden">
        {item.series.coverUrl ? (
          <Image
            src={item.series.coverUrl}
            alt={item.series.title}
            fill
            sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 25vw"
            className="object-cover transition-transform duration-300 group-hover:scale-105"
            unoptimized
          />
        ) : (
          <div className="w-full h-full flex flex-col items-center justify-center p-4 text-center bg-ink-950 border-b border-ink-700">
            <span className="font-serif text-paper-400 text-sm italic">
              No cover art available
            </span>
          </div>
        )}

        {/* Status Tag (Pill with dot per DESIGN_SYSTEM.md) */}
        <div className="absolute top-2.5 left-2.5 z-10">
          <span
            className={`inline-flex items-center gap-1.5 px-2 py-0.5 text-xs font-medium border rounded-[4px] backdrop-blur-sm ${currentStatus.bg} ${currentStatus.color}`}
          >
            <span className={`w-1.5 h-1.5 rounded-full ${currentStatus.dot}`} />
            {currentStatus.label}
          </span>
        </div>

        {/* Update indicator if series has a new release */}
        {item.hasUpdate && (
          <div className="absolute top-2.5 right-2.5 z-10 flex items-center gap-1 bg-accent-red text-paper-50 px-2 py-0.5 text-[11px] font-semibold rounded-[4px] uppercase tracking-wider">
            New Ch.
          </div>
        )}
      </div>

      {/* Content Area */}
      <div className="p-4 flex-1 flex flex-col justify-between space-y-3">
        <div>
          <h3
            className="font-serif text-base font-semibold text-paper-50 line-clamp-2 leading-snug"
            title={item.series.title}
          >
            {item.series.title}
          </h3>
        </div>

        {/* Error message */}
        {error && (
          <div className="text-xs text-accent-red bg-accent-red/10 border border-accent-red/20 px-2 py-1 rounded-[4px]">
            {error}
          </div>
        )}

        {/* Reading Progress Controls */}
        <div className="pt-2 border-t border-ink-700/80 space-y-2">
          {!isEditing ? (
            <div className="flex items-center justify-between text-xs">
              <div className="flex items-center gap-2">
                <span className="text-paper-400">Read:</span>
                <span className="font-mono text-paper-50 font-semibold text-sm">
                  Ch. {item.lastReadChapter}
                </span>
              </div>

              {/* Quick increment / decrement controls */}
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  disabled={isPending || item.lastReadChapter <= 0}
                  onClick={() => handleQuickIncrement(-1)}
                  className="w-7 h-7 flex items-center justify-center rounded-[4px] border border-ink-700 bg-ink-950 text-paper-400 hover:text-paper-50 hover:border-paper-400 disabled:opacity-30 transition-colors"
                  title="Previous chapter"
                >
                  -
                </button>
                <button
                  type="button"
                  disabled={isPending}
                  onClick={() => handleQuickIncrement(1)}
                  className="w-7 h-7 flex items-center justify-center rounded-[4px] border border-ink-700 bg-ink-950 text-paper-400 hover:text-paper-50 hover:border-paper-400 disabled:opacity-30 transition-colors"
                  title="Next chapter"
                >
                  +
                </button>
                <button
                  type="button"
                  onClick={() => setIsEditing(true)}
                  className="ml-1 text-[11px] text-paper-400 hover:text-paper-50 underline decoration-ink-700 underline-offset-2"
                >
                  Edit
                </button>
              </div>
            </div>
          ) : (
            <div className="space-y-2 pt-1 text-xs">
              <div className="flex items-center justify-between gap-2">
                <label className="text-paper-400 text-[11px]">Chapter:</label>
                <input
                  type="number"
                  min="0"
                  step="0.5"
                  value={chapter}
                  onChange={(e) => setChapter(parseFloat(e.target.value) || 0)}
                  className="w-20 px-2 py-1 bg-ink-950 border border-ink-700 text-paper-50 rounded-[4px] text-right font-mono text-xs focus:outline-none focus:border-paper-400"
                />
              </div>

              <div className="flex items-center justify-between gap-2">
                <label className="text-paper-400 text-[11px]">Status:</label>
                <select
                  value={status}
                  onChange={(e) => setStatus(e.target.value as ReadingStatus)}
                  className="px-2 py-1 bg-ink-950 border border-ink-700 text-paper-50 rounded-[4px] text-xs focus:outline-none focus:border-paper-400"
                >
                  <option value="READING">Reading</option>
                  <option value="ON_HOLD">On Hold</option>
                  <option value="COMPLETED">Completed</option>
                  <option value="DROPPED">Dropped</option>
                </select>
              </div>

              <div className="flex items-center justify-end gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => {
                    setChapter(item.lastReadChapter);
                    setStatus(item.status);
                    setIsEditing(false);
                    setError(null);
                  }}
                  className="px-2 py-1 text-paper-400 hover:text-paper-50"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={isPending || !hasChanges}
                  onClick={handleSave}
                  className="px-3 py-1 bg-accent-red hover:bg-accent-red-dim disabled:opacity-40 text-paper-50 rounded-[4px] font-medium"
                >
                  {isPending ? "Saving..." : "Save"}
                </button>
              </div>
            </div>
          )}

          {/* Delete action */}
          <div className="pt-2 flex items-center justify-between text-[11px]">
            {confirmDelete ? (
              <div className="w-full flex items-center justify-between bg-ink-950 p-1.5 rounded-[4px] border border-accent-red/30">
                <span className="text-accent-red text-xs">Remove series?</span>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setConfirmDelete(false)}
                    className="text-paper-400 hover:text-paper-50"
                  >
                    No
                  </button>
                  <button
                    type="button"
                    disabled={isPending}
                    onClick={handleDelete}
                    className="text-accent-red font-semibold hover:underline"
                  >
                    Yes, remove
                  </button>
                </div>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setConfirmDelete(true)}
                className="text-paper-400/70 hover:text-accent-red transition-colors text-[11px]"
              >
                Remove from library
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
