import React, { useState, useMemo, useRef } from "react"
import { ChevronDown, ChevronRight, Library, Music, Play, PlusCircle, Search, Trash2, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { ScrollArea } from "@/components/ui/scroll-area"
import { LibraryStructure } from "@/types/music2vec"
import { useVirtualizer } from '@tanstack/react-virtual'

const VirtualizedSongList = ({
  songs,
  groupId,
  onSetActiveVideo,
  onRemoveSongs
}: {
  songs: [string, string][]
  groupId: string
  onSetActiveVideo: (ytId: string) => void
  onRemoveSongs: (group: string, ytIds: string[]) => void
}) => {
  const parentRef = useRef<HTMLDivElement>(null)
  
  const virtualizer = useVirtualizer({
    count: songs.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 52, // 52px height approx
    overscan: 5,
  })

  return (
    <div
      ref={parentRef}
      className="h-64 overflow-y-auto"
    >
      <div
        className="relative w-full p-2"
        style={{
          height: `${virtualizer.getTotalSize()}px`,
        }}
      >
        {virtualizer.getVirtualItems().map((virtualRow) => {
          const [ytID, title] = songs[virtualRow.index]
          return (
            <div
              key={virtualRow.key}
              data-index={virtualRow.index}
              ref={virtualizer.measureElement}
              className="absolute top-0 left-2 right-2 flex items-center justify-between p-2.5 hover:bg-slate-50 dark:hover:bg-slate-900/50 rounded-md group"
              style={{
                transform: `translateY(${virtualRow.start}px)`,
              }}
            >
              <div className="flex items-center gap-3 min-w-0 flex-1">
                <div className="shrink-0 w-8 h-8 rounded bg-slate-100 dark:bg-slate-800 flex items-center justify-center">
                  <Music className="w-4 h-4 text-muted-foreground" />
                </div>
                <span className="text-sm font-medium truncate" title={title}>{title}</span>
              </div>
              <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                <button
                  className="shrink-0 text-muted-foreground hover:text-primary p-1.5 rounded-md hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                  onClick={(e) => {
                    e.stopPropagation()
                    onSetActiveVideo(ytID)
                  }}
                  title="Play song"
                >
                  <Play className="w-4 h-4" />
                </button>
                <button
                  className="shrink-0 text-muted-foreground hover:text-destructive p-1.5 rounded-md hover:bg-destructive/10 transition-colors"
                  onClick={(e) => {
                    e.stopPropagation()
                    onRemoveSongs(groupId, [ytID])
                  }}
                  title="Remove song"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

type LibraryTabProps = {
  allGroups: string[]
  library: LibraryStructure
  expandedGroups: Record<string, boolean>
  onToggleGroupExpanded: (group: string) => void
  onSetActiveVideo: (ytId: string) => void
  onRemoveSongs: (group: string, ytIds: string[]) => void
  onGoToUpload: () => void
  onCreateGroup: (name: string) => void
}

export function LibraryTab({
  allGroups,
  library,
  expandedGroups,
  onToggleGroupExpanded,
  onSetActiveVideo,
  onRemoveSongs,
  onGoToUpload,
  onCreateGroup,
}: LibraryTabProps) {
  const [searchQuery, setSearchQuery] = useState("")

  const filteredLibrary = useMemo(() => {
    if (!searchQuery.trim()) return library

    const query = searchQuery.toLowerCase()
    const filtered: LibraryStructure = {}

    for (const [group, songs] of Object.entries(library)) {
      const matchedSongs = Object.entries(songs).filter(
        ([, title]) => title.toLowerCase().includes(query) || group.toLowerCase().includes(query)
      )

      if (matchedSongs.length > 0) {
        filtered[group] = Object.fromEntries(matchedSongs)
      }
    }
    return filtered
  }, [library, searchQuery])

  const filteredGroups = Object.keys(filteredLibrary)

  const handlePlayAll = () => {
    const allIds = Object.values(filteredLibrary).flatMap((songs) => Object.keys(songs))
    if (allIds.length === 0) return
    
    // For play all, the first video is the main ID, and the rest are added as a playlist
    const firstId = allIds[0]
    const restIds = allIds.slice(1)
    
    if (restIds.length > 0) {
      onSetActiveVideo(`${firstId}?playlist=${restIds.join(',')}`)
    } else {
      onSetActiveVideo(firstId)
    }
  }

  return (
    <div className="space-y-6 animate-in fade-in-50 duration-300">
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">Library</h2>
          <p className="text-muted-foreground">Browse, search, and manage your music groups.</p>
        </div>
        
        {allGroups.length > 0 && (
          <div className="flex items-center gap-2">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                placeholder="Search library..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9 w-[150px] sm:w-[200px] lg:w-[280px]"
              />
            </div>
            <Button size="sm" variant="outline" onClick={() => {
              const name = window.prompt("Enter new group name:")
              if (name) onCreateGroup(name)
            }} className="shrink-0 gap-1.5 px-2.5">
              <PlusCircle className="w-4 h-4" />
              <span className="hidden sm:inline">New Group</span>
            </Button>
            <Button size="sm" onClick={handlePlayAll} disabled={filteredGroups.length === 0} className="shrink-0 px-2.5">
              <Play className="w-4 h-4 sm:mr-1.5" />
              <span className="hidden sm:inline">Play All</span>
            </Button>
          </div>
        )}
      </div>

      {allGroups.length === 0 ? (
        <Card className="border-dashed shadow-sm">
          <CardContent className="flex flex-col items-center justify-center py-16 text-muted-foreground">
            <Library className="w-12 h-12 mb-4 opacity-20" />
            <p className="text-sm font-medium">Your library is empty</p>
            <p className="text-xs mt-1">Upload songs to start organizing groups.</p>
            <Button variant="outline" className="mt-6 gap-2" onClick={() => {
              const name = window.prompt("Enter new group name:")
              if (name) onCreateGroup(name)
            }}>
              <PlusCircle className="w-4 h-4" /> Create Group
            </Button>
            <Button variant="default" className="mt-3" onClick={onGoToUpload}>
              Go to Upload
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 xl:grid-cols-2">
          {filteredGroups.map((group) => {
            const isExpanded = expandedGroups[group] ?? true
            const songs = filteredLibrary[group]
            const songCount = Object.keys(songs).length

            return (
              <Card key={group} className="overflow-hidden shadow-sm hover:shadow-md transition-shadow">
                <div className="w-full flex items-center justify-between p-2 pr-4 bg-slate-50/50 dark:bg-slate-900/50 hover:bg-slate-100 dark:hover:bg-slate-800/80 transition-colors group/header">
                  <button
                    className="flex-1 flex items-center gap-3 p-2 min-w-0 text-left"
                    onClick={() => onToggleGroupExpanded(group)}
                  >
                    {isExpanded ? (
                      <ChevronDown className="w-4 h-4 shrink-0 text-muted-foreground" />
                    ) : (
                      <ChevronRight className="w-4 h-4 shrink-0 text-muted-foreground" />
                    )}
                    <span className="font-semibold">{group}</span>
                    <span className="text-xs bg-primary/10 text-primary px-2 py-0.5 rounded-full font-medium">{songCount} songs</span>
                  </button>
                  <button
                    onClick={() => {
                      if (window.confirm(`Are you sure you want to delete the entire group "${group}" and all its songs?`)) {
                        onRemoveSongs(group, Object.keys(songs))
                      }
                    }}
                    className="shrink-0 text-muted-foreground hover:text-destructive p-2 rounded-md hover:bg-destructive/10 transition-colors opacity-0 group-hover/header:opacity-100 focus:opacity-100"
                    title="Delete Group"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
                {isExpanded && (
                  <div className="border-t bg-background">
                    <VirtualizedSongList
                      songs={Object.entries(songs)}
                      groupId={group}
                      onSetActiveVideo={onSetActiveVideo}
                      onRemoveSongs={onRemoveSongs}
                    />
                  </div>
                )}
              </Card>
            )
          })}
        </div>
      )}
    </div>
  )
}
