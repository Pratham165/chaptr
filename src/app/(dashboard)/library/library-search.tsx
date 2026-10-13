"use client";

import { useState, useEffect, useRef } from "react";
import Image from "next/image";
import { type MangaDexSearchResult } from "@/lib/mangadex";
import { searchMangaAction, addSeriesToLibrary } from "./actions";
import { type TrackedSeriesItem } from "@/types/library";

interface LibrarySearchProps {
  trackedMangadexIds: Set<string>;
  onSeriesAdded: (series: TrackedSeriesItem) => void;
}

export function LibrarySearch({
  trackedMangadexIds,
  onSeriesAdded,
}: LibrarySearchProps) {
  const [query, setQuery] = useState("");
  const [isSearching, setIsSearching] = useState(false);
  const [results, setResults] = useState<MangaDexSearchResult[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [addingId, setAddingId] = useState<string | null>(null);
  const [addSuccessId, setAddSuccessId] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Close search popover on outside click
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setIsOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const handleSearch = async (searchQuery: string) => {
    const trimmed = searchQuery.trim();
    if (!trimmed) {
      setResults([]);
      setError(null);
      return;
    }

    setIsSearching(true);
    setError(null);

    try {
      const response = await searchMangaAction(trimmed);
      if (!response.ok) {
        setError(response.error);
        setResults([]);
      } else {
        setResults(response.data);
        setError(null);
      }
      setIsOpen(true);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg || "An error occurred while searching MangaDex.");
      setResults([]);
      setIsOpen(true);
    } finally {
      setIsSearching(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      handleSearch(query);
    }
  };

  const handleAdd = async (item: MangaDexSearchResult) => {
    setAddingId(item.mangadexId);
    setError(null);

    try {
      const result = await addSeriesToLibrary(item.mangadexId);
      if (!result.ok) {
        setError(result.error);
      } else {
        onSeriesAdded(result.data as TrackedSeriesItem);
        setAddSuccessId(item.mangadexId);
        setTimeout(() => setAddSuccessId(null), 3000);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg || "Failed to add series to library");
    } finally {
      setAddingId(null);
    }
  };

  return (
    <div ref={containerRef} className="relative w-full max-w-2xl">
      {/* Search Input Bar */}
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <input
            type="text"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              if (error) setError(null);
            }}
            onKeyDown={handleKeyDown}
            onFocus={() => {
              if (results.length > 0 || error) setIsOpen(true);
            }}
            placeholder="Search manga by title on MangaDex..."
            className="w-full bg-ink-900 border border-ink-700 text-paper-50 placeholder:text-paper-400 px-4 py-2.5 rounded-[4px] text-sm focus:outline-none focus:border-paper-400 transition-colors"
          />
          {query && (
            <button
              type="button"
              onClick={() => {
                setQuery("");
                setResults([]);
                setError(null);
                setIsOpen(false);
              }}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-paper-400 hover:text-paper-50"
            >
              Clear
            </button>
          )}
        </div>

        <button
          type="button"
          disabled={isSearching || !query.trim()}
          onClick={() => handleSearch(query)}
          className="px-5 py-2.5 bg-accent-red hover:bg-accent-red-dim disabled:opacity-40 text-paper-50 text-sm font-medium rounded-[4px] transition-colors whitespace-nowrap"
        >
          {isSearching ? "Searching..." : "Search"}
        </button>
      </div>

      {/* Explicit Rate Limit Banner or General Error Banner */}
      {error && (
        <div className="mt-2 p-3 bg-ink-900 border border-accent-red/40 rounded-[4px] flex items-center justify-between text-xs">
          <div className="flex items-center gap-2 text-accent-red font-medium">
            <span className="w-1.5 h-1.5 rounded-full bg-accent-red" />
            <span>{error}</span>
          </div>
          {error.toLowerCase().includes("rate limit") && (
            <span className="text-[11px] text-paper-400">
              MangaDex limits requests to ~5/sec
            </span>
          )}
        </div>
      )}

      {/* Search Results Dropdown Popover */}
      {isOpen && results.length > 0 && (
        <div className="absolute top-full left-0 right-0 mt-2 z-50 bg-ink-900 border border-ink-700 rounded-[4px] shadow-2xl max-h-96 overflow-y-auto divide-y divide-ink-700">
          <div className="p-2 text-xs text-paper-400 bg-ink-950/60 sticky top-0 backdrop-blur-sm flex justify-between items-center">
            <span>Results from MangaDex ({results.length})</span>
            <button
              type="button"
              onClick={() => setIsOpen(false)}
              className="text-paper-400 hover:text-paper-50 text-xs"
            >
              Close
            </button>
          </div>

          {results.map((item) => {
            const isTracked = trackedMangadexIds.has(item.mangadexId);
            const isAdding = addingId === item.mangadexId;
            const isJustAdded = addSuccessId === item.mangadexId;

            return (
              <div
                key={item.mangadexId}
                className="p-3 flex items-center justify-between gap-4 hover:bg-ink-950/40 transition-colors"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <div className="relative w-10 h-14 bg-ink-950 border border-ink-700 rounded-[2px] flex-shrink-0 overflow-hidden">
                    {item.coverUrl ? (
                      <Image
                        src={item.coverUrl}
                        alt={item.title}
                        fill
                        sizes="40px"
                        className="object-cover"
                        unoptimized
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-[9px] text-paper-400 italic text-center p-0.5">
                        No cover
                      </div>
                    )}
                  </div>
                  <div className="min-w-0">
                    <p className="font-serif text-sm font-medium text-paper-50 truncate">
                      {item.title}
                    </p>
                    <p className="text-[11px] text-paper-400 font-mono">
                      ID: {item.mangadexId.slice(0, 8)}...
                    </p>
                  </div>
                </div>

                <div className="flex-shrink-0">
                  {isTracked || isJustAdded ? (
                    <span className="inline-flex items-center gap-1 text-xs text-[#4A9B7F] font-medium px-2.5 py-1 bg-[#4A9B7F]/10 border border-[#4A9B7F]/30 rounded-[4px]">
                      <span className="w-1.5 h-1.5 rounded-full bg-[#4A9B7F]" />
                      In Library
                    </span>
                  ) : (
                    <button
                      type="button"
                      disabled={isAdding}
                      onClick={() => handleAdd(item)}
                      className="px-3 py-1.5 bg-accent-red hover:bg-accent-red-dim disabled:opacity-40 text-paper-50 text-xs font-medium rounded-[4px] transition-colors"
                    >
                      {isAdding ? "Adding..." : "Add to Library"}
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
