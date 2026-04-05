import React, { useRef } from "react"
import { DiscAlbum, Play, Search, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { SearchResult } from "@/types/music2vec"
import { cn } from "@/lib/utils"
import { useVirtualizer } from '@tanstack/react-virtual'

const VirtualizedResults = ({
  results,
  activeVideoId,
  onSetActiveVideo
}: {
  results: SearchResult[]
  activeVideoId: string | null
  onSetActiveVideo: (id: string | null) => void
}) => {
  const parentRef = useRef<HTMLDivElement>(null)

  const virtualizer = useVirtualizer({
    count: results.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 80, // Approx height of each result row
    overscan: 5,
  })

  return (
    <div ref={parentRef} className="absolute inset-0 overflow-y-auto">
      <div
        className="relative w-full p-3"
        style={{ height: `${virtualizer.getTotalSize()}px` }}
      >
        {virtualizer.getVirtualItems().map((virtualRow) => {
          const res = results[virtualRow.index]
          const isActive = activeVideoId === res.yt_id || activeVideoId?.startsWith(res.yt_id + "?") || activeVideoId?.includes(res.yt_id)

          return (
            <div
              key={`${res.group}-${res.yt_id}-${virtualRow.index}`}
              data-index={virtualRow.index}
              ref={virtualizer.measureElement}
              className={cn(
                "absolute top-0 left-3 right-3 p-3 rounded-lg text-sm cursor-pointer transition-all border group/result overflow-hidden",
                isActive
                  ? "bg-white dark:bg-slate-800 border-primary/40 shadow-sm ring-1 ring-primary/20 z-10"
                  : "bg-white dark:bg-slate-900 border-slate-100 dark:border-slate-800 hover:border-slate-200 dark:hover:border-slate-700 hover:shadow-sm"
              )}
              style={{ transform: `translateY(${virtualRow.start}px)` }}
              onClick={() => onSetActiveVideo(res.yt_id)}
            >
              {isActive && <div className="absolute left-0 top-0 bottom-0 w-1 bg-primary" />}

              <div className="flex gap-3">
                <div className="flex-1 min-w-0">
                  <p
                    className={cn(
                      "font-semibold line-clamp-1",
                      isActive
                        ? "text-primary text-foreground"
                        : "text-slate-800 dark:text-slate-200 group-hover/result:text-primary transition-colors"
                    )}
                  >
                    {res.display_name}
                  </p>
                  <div className="flex items-center gap-2 mt-1">
                    <span className="text-[11px] font-medium text-slate-500 bg-slate-100 dark:bg-slate-800/60 px-1.5 py-0.5 rounded">
                      {res.group}
                    </span>
                  </div>
                </div>
                <div className="shrink-0 flex flex-col items-end justify-center">
                  <div
                    className={cn(
                      "text-xs font-mono font-bold px-2 py-1 rounded-md",
                      isActive ? "bg-primary/10 text-primary" : "bg-slate-100 dark:bg-slate-800 text-muted-foreground"
                    )}
                  >
                    {(res.similarity * 100).toFixed(1)}%
                  </div>
                </div>
              </div>

              <div className="w-full bg-slate-100 dark:bg-slate-800 rounded-full h-1 mt-3">
                <div
                  className={cn("h-1 rounded-full", isActive ? "bg-primary" : "bg-slate-300 dark:bg-slate-600")}
                  style={{ width: `${Math.max(0, res.similarity * 100)}%` }}
                />
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

type ResultsPanelProps = {
  results: SearchResult[]
  activeVideoId: string | null
  onSetActiveVideo: (id: string | null) => void
  isSearching: boolean
  className?: string
}

export function ResultsPanel({
  results,
  activeVideoId,
  onSetActiveVideo,
  isSearching,
  className,
}: ResultsPanelProps) {
  return (
    <div className={cn("bg-white dark:bg-slate-900 border rounded-xl md:rounded-none md:border-0 md:border-l flex flex-col", className)}>
      <div className="shrink-0 border-b p-4 pb-5 bg-slate-50/50 dark:bg-black/20 rounded-t-xl md:rounded-none">
        <h3 className="text-sm font-semibold flex items-center gap-2 mb-3">
          <Play className="w-4 h-4 text-primary" />
          Now Playing
        </h3>

        {activeVideoId ? (
          <div className="aspect-video w-full rounded-lg overflow-hidden bg-black shadow-md ring-1 ring-black/5 relative group">
            <iframe
              width="100%"
              height="100%"
              src={`https://www.youtube.com/embed/${activeVideoId}${activeVideoId.includes('?') ? '&' : '?'}autoplay=1`}
              title="Player"
              frameBorder="0"
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
              allowFullScreen
              className="absolute inset-0"
            ></iframe>
            <Button
              variant="destructive"
              size="icon"
              className="absolute top-2 right-2 w-8 h-8 opacity-0 group-hover:opacity-100 transition-opacity rounded-full z-10 shadow-lg"
              onClick={() => onSetActiveVideo(null)}
            >
              <X className="w-4 h-4" />
            </Button>
          </div>
        ) : (
          <div className="aspect-video w-full rounded-lg border-2 border-dashed border-slate-200 dark:border-slate-800 flex items-center justify-center bg-slate-100/30 dark:bg-slate-800/10">
            <div className="text-center text-muted-foreground opacity-60">
              <DiscAlbum className="w-8 h-8 mx-auto mb-2 opacity-50" />
              <p className="text-xs font-medium">Select a track to play</p>
            </div>
          </div>
        )}
      </div>

      <div className="flex-1 flex flex-col min-h-0">
        <div className="shrink-0 p-4 border-b flex items-center justify-between bg-white dark:bg-slate-900 z-10">
          <h3 className="text-sm font-semibold flex items-center gap-2">
            <Search className="w-4 h-4 text-primary" />
            Search Results
          </h3>
          {results.length > 0 && (
            <span className="text-xs font-medium bg-slate-100 dark:bg-slate-800 px-2 py-0.5 rounded-full text-muted-foreground">
              {results.length} found
            </span>
          )}
        </div>

        <div className="flex-1 relative bg-slate-50/30 dark:bg-background min-h-[240px] md:min-h-0">
          <div className="absolute inset-0">
            {isSearching ? (
              <div className="p-3 space-y-2">
                {Array.from({ length: 5 }).map((_, i) => (
                  <div key={`skeleton-${i}`} className="p-3 rounded-lg border bg-white dark:bg-slate-900 border-slate-100 dark:border-slate-800 animate-pulse">
                    <div className="h-4 bg-slate-200 dark:bg-slate-700 rounded w-3/4" />
                    <div className="h-3 mt-2 bg-slate-100 dark:bg-slate-800 rounded w-1/2" />
                    <div className="h-1 mt-3 bg-slate-100 dark:bg-slate-800 rounded w-full" />
                  </div>
                ))}
              </div>
            ) : results.length > 0 ? (
              <VirtualizedResults results={results} activeVideoId={activeVideoId} onSetActiveVideo={onSetActiveVideo} />
            ) : (
              <div className="flex flex-col items-center justify-center p-8 text-center text-muted-foreground opacity-60 h-full">
                <DiscAlbum className="w-10 h-10 mb-3 opacity-30" />
                <p className="text-sm font-medium">No results yet</p>
                <p className="text-xs mt-1">Build a query and run search to discover similar tracks.</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
