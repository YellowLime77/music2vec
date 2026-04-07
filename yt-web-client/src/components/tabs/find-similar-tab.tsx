import React, { useMemo, useState, useRef } from "react"
import { ChevronDown, ChevronRight, Play, Search, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { cn } from "@/lib/utils"
import { LibraryStructure, SongSearchPayload } from "@/types/music2vec"
import { useVirtualizer } from '@tanstack/react-virtual'

const VirtualizedGroupFilterList = ({
  allGroups,
  filteredGroups,
  selectedGroupsForSearch,
  setSelectedGroupsForSearch,
}: {
  allGroups: string[]
  filteredGroups: string[]
  selectedGroupsForSearch: string[]
  setSelectedGroupsForSearch: React.Dispatch<React.SetStateAction<string[]>>
}) => {
  const parentRef = useRef<HTMLDivElement>(null)

  const virtualizer = useVirtualizer({
    count: filteredGroups.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 34,
    overscan: 12,
  })

  return (
    <div ref={parentRef} className="max-h-44 overflow-y-auto">
      <div className="relative w-full" style={{ height: `${virtualizer.getTotalSize()}px` }}>
        {virtualizer.getVirtualItems().map((virtualRow) => {
          const group = filteredGroups[virtualRow.index]
          const checked = selectedGroupsForSearch.length === 0 || selectedGroupsForSearch.includes(group)

          return (
            <div
              key={`${group}-${virtualRow.index}`}
              className="absolute left-0 top-0 w-full px-0.5"
              style={{ transform: `translateY(${virtualRow.start}px)` }}
            >
              <div className="flex items-center space-x-3 pt-1">
                <Checkbox
                  id={`search-group-${group}`}
                  checked={checked}
                  onCheckedChange={(nextChecked) => {
                    if (nextChecked === true) {
                      const newSelection = selectedGroupsForSearch.length === 0
                        ? allGroups.filter((g) => g !== group)
                        : [...selectedGroupsForSearch.filter((g) => g !== '___NONE___'), group]

                      if (newSelection.length === allGroups.length) {
                        setSelectedGroupsForSearch([])
                      } else {
                        setSelectedGroupsForSearch(newSelection)
                      }
                    } else {
                      const newSelection = selectedGroupsForSearch.length === 0
                        ? allGroups.filter((g) => g !== group)
                        : selectedGroupsForSearch.filter((g) => g !== group)

                      setSelectedGroupsForSearch(newSelection.length === 0 ? ['___NONE___'] : newSelection)
                    }
                  }}
                />
                <label htmlFor={`search-group-${group}`} className="text-sm cursor-pointer truncate">{group}</label>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

const VirtualizedSelectedSeedList = ({
  selectedSongChips,
  onRemove,
}: {
  selectedSongChips: { key: string; queryGroup: "group1"; songId: string; title: string; group: string }[]
  onRemove: (queryGroup: "group1", songId: string) => void
}) => {
  const parentRef = useRef<HTMLDivElement>(null)

  const virtualizer = useVirtualizer({
    count: selectedSongChips.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 32,
    overscan: 10,
  })

  return (
    <div ref={parentRef} className="h-30 overflow-y-auto pr-2 custom-scrollbar">
      <div className="relative w-full" style={{ height: `${virtualizer.getTotalSize()}px` }}>
        {virtualizer.getVirtualItems().map((virtualRow) => {
          const chip = selectedSongChips[virtualRow.index]
          return (
            <div
              key={`${chip.queryGroup}-${chip.songId}-${virtualRow.index}`}
              className="absolute left-0 top-0 w-full"
              style={{ transform: `translateY(${virtualRow.start}px)` }}
            >
              <button
                className="w-full inline-flex items-center justify-between gap-2 px-2.5 py-1 rounded-md text-xs border bg-white dark:bg-slate-900 hover:border-primary/40"
                onClick={() => onRemove(chip.queryGroup, chip.songId)}
                title={`Remove ${chip.title}`}
              >
                <span className="font-medium truncate">{chip.title}</span>
                <span className="text-[11px] text-muted-foreground truncate">{chip.group}</span>
                <X className="w-3 h-3 shrink-0" />
              </button>
            </div>
          )
        })}
      </div>
    </div>
  )
}

const VirtualizedSearchSongs = ({
  normalizedLibrary,
  filterValue,
  queryGroup,
  selectedFromGroup,
  toggleSongSelection,
  toggleGroupSelection,
  expandedGroups,
  onToggleGroupExpanded,
  onSetActiveVideo
}: {
  normalizedLibrary: { group: string; songs: [string, string][] }[];
  filterValue: string;
  queryGroup: "group1";
  selectedFromGroup: Record<string, string[]>;
  toggleSongSelection: (queryGroup: "group1", songId: string) => void;
  toggleGroupSelection: (queryGroup: "group1", songIds: string[]) => void;
  expandedGroups: Record<string, boolean>;
  onToggleGroupExpanded: (group: string) => void;
  onSetActiveVideo: (ytId: string) => void;
}) => {
  const flattenedList = useMemo(() => {
    const list: Array<{ type: 'header'; group: string; songIds: string[] } | { type: 'song'; ytID: string; songTitle: string; group: string }> = []
    
    for (const { group, songs } of normalizedLibrary) {
      const matchedSongs = songs.filter(([, songTitle]) => songTitle.toLowerCase().includes(filterValue.trim().toLowerCase()))
      if (matchedSongs.length === 0) continue;
      
      list.push({ type: 'header', group, songIds: matchedSongs.map(([id]) => id) })
      
      const isExpanded = expandedGroups[group] ?? true
      if (isExpanded) {
        for (const [ytID, songTitle] of matchedSongs) {
          list.push({ type: 'song', ytID, songTitle, group })
        }
      }
    }
    return list
  }, [normalizedLibrary, filterValue, expandedGroups])

  const parentRef = useRef<HTMLDivElement>(null)

  const virtualizer = useVirtualizer({
    count: flattenedList.length,
    getScrollElement: () => parentRef.current,
    estimateSize: (i) => {
      // @ts-ignore
      return flattenedList[i].type === 'header' ? 44 : 44
    },
    overscan: 10,
  })

  return (
    <div ref={parentRef} className="h-[280px] overflow-y-auto overflow-x-hidden pr-2">
      <div 
        className="w-full relative" 
        style={{ height: `${virtualizer.getTotalSize()}px` }}
      >
        {virtualizer.getVirtualItems().map((virtualRow) => {
          // @ts-ignore
          const item = flattenedList[virtualRow.index]
          if (item.type === 'header') {
            const isExpanded = expandedGroups[item.group] ?? true
            const groupSongs = item.songIds
            const currentSelected = selectedFromGroup[queryGroup] || []
            const selectedMatchCount = groupSongs.filter(id => currentSelected.includes(id)).length
            const isAllSelected = selectedMatchCount === groupSongs.length && groupSongs.length > 0

            return (
              <div
                key={`${item.group}-header-${virtualRow.index}`}
                data-index={virtualRow.index}
                ref={virtualizer.measureElement}
                className="absolute top-0 left-0 right-0 w-full flex items-center px-3 py-2 text-sm uppercase tracking-wide text-foreground font-semibold bg-slate-100/70 dark:bg-slate-800/40 rounded-md border mt-2 first:mt-0 hover:bg-slate-200/60 dark:hover:bg-slate-700/50 transition-colors group/header"
                style={{ transform: `translateY(${virtualRow.start}px)` }}
              >
                <button 
                  className="flex-1 flex items-center text-left" 
                  onClick={() => onToggleGroupExpanded(item.group)}
                >
                  {isExpanded ? <ChevronDown className="w-4 h-4 mr-2 text-muted-foreground" /> : <ChevronRight className="w-4 h-4 mr-2 text-muted-foreground" />}
                  {item.group}
                </button>
                <div className="flex items-center gap-3">
                  {selectedMatchCount > 0 && (
                    <span className="text-xs font-medium text-primary hidden sm:inline-block">
                      {selectedMatchCount} selected
                    </span>
                  )}
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      toggleGroupSelection(queryGroup, groupSongs);
                    }}
                    className={cn(
                      "flex items-center justify-center shrink-0 text-xs px-2 py-0.5 rounded border transition-colors",
                      isAllSelected 
                        ? "bg-primary border-primary text-primary-foreground" 
                        : "bg-white dark:bg-slate-900 border-slate-300 dark:border-slate-700 text-muted-foreground hover:text-foreground"
                    )}
                  >
                    Select All
                  </button>
                </div>
              </div>
            )
          }

          const isSelected = selectedFromGroup[queryGroup]?.includes(item.ytID)
          return (
            <div
              key={`${item.group}-${item.ytID}-${virtualRow.index}`}
              data-index={virtualRow.index}
              ref={virtualizer.measureElement}
              className={cn(
                "absolute top-0 left-0 right-0 w-full text-left p-2 rounded-md text-sm transition-all border flex items-center gap-3 group",
                isSelected
                  ? "bg-primary/5 border-primary/30 shadow-sm z-10"
                  : "border-transparent hover:bg-slate-50 dark:hover:bg-slate-900 bg-background"
              )}
              style={{ transform: `translateY(${virtualRow.start}px)` }}
            >
              <button
                onClick={() => toggleSongSelection(queryGroup, item.ytID)}
                className="flex-1 flex items-center gap-3 overflow-hidden text-left"
              >
                <div
                  className={cn(
                    "w-4 h-4 rounded border flex items-center justify-center shrink-0",
                    isSelected ? "bg-primary border-primary" : "border-slate-300 dark:border-slate-700"
                  )}
                >
                  {isSelected && <X className="w-3 h-3 text-primary-foreground text-white" />}
                </div>
                <p className={cn("truncate font-medium flex-1 py-0.5", isSelected ? "text-foreground" : "")}>{item.songTitle}</p>
              </button>
              <button
                className="shrink-0 text-muted-foreground hover:text-primary p-1.5 rounded-md hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors opacity-0 group-hover:opacity-100 focus:opacity-100 flex items-center"
                onClick={(e) => {
                  e.stopPropagation()
                  onSetActiveVideo(item.ytID)
                }}
                title="Play song"
              >
                <Play className="w-4 h-4" />
              </button>
            </div>
          )
        })}
      </div>
    </div>
  )
}

type FindSimilarTabProps = {
  library: LibraryStructure
  allGroups: string[]
  selectedFromGroup: Record<string, string[]>
  setSelectedFromGroup: React.Dispatch<React.SetStateAction<Record<string, string[]>>>
  selectedGroupsForSearch: string[]
  setSelectedGroupsForSearch: React.Dispatch<React.SetStateAction<string[]>>
  algo: string
  setAlgo: React.Dispatch<React.SetStateAction<string>>
  randomness: number
  setRandomness: React.Dispatch<React.SetStateAction<number>>
  skew: number
  setSkew: React.Dispatch<React.SetStateAction<number>>
  isReady: boolean
  isSearching: boolean
  onSearch: (payload: SongSearchPayload) => Promise<void>
  expandedGroups: Record<string, boolean>
  onToggleGroupExpanded: (group: string) => void
  onSetActiveVideo: (ytId: string) => void
}

export function FindSimilarTab({
  library,
  allGroups,
  selectedFromGroup,
  setSelectedFromGroup,
  selectedGroupsForSearch,
  setSelectedGroupsForSearch,
  algo,
  setAlgo,
  randomness,
  setRandomness,
  skew,
  setSkew,
  isReady,
  isSearching,
  onSearch,
  expandedGroups,
  onToggleGroupExpanded,
  onSetActiveVideo,
}: FindSimilarTabProps) {
  const [songFilterPrimary, setSongFilterPrimary] = useState("")
  const [groupFilter, setGroupFilter] = useState("")

  const behaviorPresets = [
    { label: "Stable", randomness: 0.0, skew: 1.25 },
    { label: "Balanced", randomness: 0.2, skew: 1.0 },
    { label: "Wild", randomness: 0.7, skew: 0.9 },
    { label: "Serendipity", randomness: 0.9, skew: 0.65 },
  ]

  const isPresetActive = (preset: { randomness: number; skew: number }) => {
    return Math.abs(randomness - preset.randomness) < 0.01 && Math.abs(skew - preset.skew) < 0.01
  }

  const selectedSongCount = (selectedFromGroup.group1?.length || 0)

  const songMetaById = useMemo(() => {
    const map = new Map<string, { title: string; group: string }>()
    for (const [group, songs] of Object.entries(library)) {
      for (const [id, title] of Object.entries(songs)) {
        map.set(id, { title, group })
      }
    }
    return map
  }, [library])

  const normalizedLibrary = useMemo(() => {
    return Object.entries(library)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([group, songs]) => ({
        group,
        songs: Object.entries(songs).sort(([, titleA], [, titleB]) => titleA.localeCompare(titleB)),
      }))
  }, [library])

  const filteredGroupsForSearch = useMemo(() => {
    const q = groupFilter.trim().toLowerCase()
    if (!q) return allGroups
    return allGroups.filter((group) => group.toLowerCase().includes(q))
  }, [allGroups, groupFilter])

  const selectedSongChips = useMemo(() => {
    const chips: { key: string; queryGroup: "group1"; songId: string; title: string; group: string }[] = []
    for (const queryGroup of ["group1"] as const) {
      const selectedIds = selectedFromGroup[queryGroup] || []
      for (const id of selectedIds) {
        const songMeta = songMetaById.get(id)
        if (songMeta) {
          chips.push({ key: `${queryGroup}-${id}`, queryGroup, songId: id, title: songMeta.title, group: songMeta.group })
        }
      }
    }
    return chips
  }, [selectedFromGroup, songMetaById])

  const toggleSongSelection = (queryGroup: "group1", songId: string) => {
    setSelectedFromGroup((prev) => {
      const current = prev[queryGroup] || []
      if (current.includes(songId)) {
        return { ...prev, [queryGroup]: current.filter((id) => id !== songId) }
      }
      return { ...prev, [queryGroup]: [...current, songId] }
    })
  }

  const toggleGroupSelection = (queryGroup: "group1", songIds: string[]) => {
    setSelectedFromGroup((prev) => {
      const current = prev[queryGroup] || []
      const allSelected = songIds.every((id) => current.includes(id))
      
      if (allSelected) {
        return { ...prev, [queryGroup]: current.filter((id) => !songIds.includes(id)) }
      } else {
        return { ...prev, [queryGroup]: Array.from(new Set([...current, ...songIds])) }
      }
    })
  }

  const removeSelectedSong = (queryGroup: "group1", songId: string) => {
    setSelectedFromGroup((prev) => ({
      ...prev,
      [queryGroup]: (prev[queryGroup] || []).filter((id) => id !== songId),
    }))
  }

  const runSearch = async () => {
    const payload: SongSearchPayload = {
      song_ids1: selectedFromGroup.group1 || [],
      song_ids2: [],
      groups: selectedGroupsForSearch.length === 0 ? allGroups : selectedGroupsForSearch.filter(g => g !== '___NONE___'),
      algo,
      randomness,
      skew,
    }

    await onSearch(payload)
  }

  const renderQuerySelector = (queryGroup: "group1", title: string, filterValue: string, setFilter: (v: string) => void) => {
    return (
      <Card className="flex flex-col shadow-sm border-slate-200 dark:border-slate-800">
        <CardHeader className="py-4 border-b bg-slate-50/50 dark:bg-slate-900/30 flex flex-row items-center justify-between gap-3">
          <div>
            <CardTitle className="text-base">{title}</CardTitle>
            <CardDescription className="text-xs">Select one or more tracks to use as a reference.</CardDescription>
          </div>
          {(selectedFromGroup[queryGroup]?.length || 0) > 0 && (
            <Button
              variant="ghost"
              size="sm"
              className="h-8 text-xs text-muted-foreground"
              onClick={() => setSelectedFromGroup((prev) => ({ ...prev, [queryGroup]: [] }))}
            >
              Clear
            </Button>
          )}
        </CardHeader>

        <div className="p-3 border-b bg-background">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              value={filterValue}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Search songs..."
              className="pl-9"
            />
          </div>
        </div>

        <div className="flex-1 bg-background p-2">
          <VirtualizedSearchSongs
            normalizedLibrary={normalizedLibrary}
            filterValue={filterValue}
            queryGroup={queryGroup}
            selectedFromGroup={selectedFromGroup}
            toggleSongSelection={toggleSongSelection}
            toggleGroupSelection={toggleGroupSelection}
            expandedGroups={expandedGroups}
            onToggleGroupExpanded={onToggleGroupExpanded}
            onSetActiveVideo={onSetActiveVideo}
          />
        </div>
      </Card>
    )
  }

  return (
    <div className="space-y-6 animate-in fade-in-50 duration-300">
      <div>
        <h2 className="text-2xl font-bold tracking-tight">Find Similar</h2>
        <p className="text-muted-foreground">Pick seed songs to discover mathematically similar tracks.</p>
      </div>

      <Card className="shadow-sm">
        <CardContent className="p-4 sm:p-5 space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Selected Seeds</span>
            <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-primary/10 text-primary">{selectedSongCount} songs</span>
          </div>
          {selectedSongChips.length > 0 ? (
            <VirtualizedSelectedSeedList selectedSongChips={selectedSongChips} onRemove={removeSelectedSong} />
          ) : (
            <p className="text-sm text-muted-foreground">No seed songs selected yet.</p>
          )}
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 gap-6">
        {renderQuerySelector("group1", "Select Songs", songFilterPrimary, setSongFilterPrimary)}
      </div>

      <Card className="shadow-sm">
        <CardContent className="p-6 space-y-6">
          <div className="grid lg:grid-cols-2 gap-6">
            <div className="space-y-3">
              <div className="flex items-center justify-between gap-3">
                <label className="text-sm font-semibold">Filter Search Groups</label>
                <div className="flex items-center gap-2">
                  <Button variant="ghost" size="sm" className="text-xs" onClick={() => setSelectedGroupsForSearch([])}>
                    Select All
                  </Button>
                  <Button variant="ghost" size="sm" className="text-xs" onClick={() => setSelectedGroupsForSearch(['___NONE___'])}>
                    Clear
                  </Button>
                </div>
              </div>

              <Input
                placeholder="Search groups..."
                value={groupFilter}
                onChange={(e) => setGroupFilter(e.target.value)}
              />

              <div className="border bg-slate-50/50 dark:bg-slate-900/30 rounded-lg p-3 space-y-2 max-h-52 overflow-y-auto">
                <div className="flex items-center space-x-3 pb-2 border-b">
                  <Checkbox
                    id="all-groups"
                    checked={selectedGroupsForSearch.length === 0 || selectedGroupsForSearch.length === allGroups.length}
                    onCheckedChange={(checked) => {
                      if (checked === true) {
                        setSelectedGroupsForSearch([])
                      } else {
                        setSelectedGroupsForSearch(['___NONE___'])
                      }
                    }}
                  />
                  <label htmlFor="all-groups" className="text-sm font-medium cursor-pointer">Search All Groups</label>
                </div>

                <VirtualizedGroupFilterList
                  allGroups={allGroups}
                  filteredGroups={filteredGroupsForSearch}
                  selectedGroupsForSearch={selectedGroupsForSearch}
                  setSelectedGroupsForSearch={setSelectedGroupsForSearch}
                />
                {filteredGroupsForSearch.length === 0 && (
                  <p className="text-xs text-muted-foreground py-3">No groups match this filter.</p>
                )}
              </div>
            </div>

            <div className="space-y-3">
              <label className="text-sm font-semibold">Algorithm</label>
              <Select value={algo} onValueChange={setAlgo}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="Multi-Centroid">Multi-Centroid (Recommended)</SelectItem>
                  <SelectItem value="Average Vector">Average Vector</SelectItem>
                </SelectContent>
              </Select>
              <div className="rounded-lg border p-3 bg-slate-50/40 dark:bg-slate-900/30">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1">How it works</p>
                <p className="text-sm text-muted-foreground">
                  {algo === "Multi-Centroid"
                    ? "Multi-Centroid keeps multiple focus points from your seeds for broader discovery with stronger variety."
                    : "Average Vector blends all seeds into one center point for tighter and more literal similarity matches."}
                </p>
              </div>

              <div className="rounded-lg border p-3 bg-slate-50/40 dark:bg-slate-900/30 space-y-3">
                <div className="space-y-1">
                  <label className="text-sm font-semibold">Behavior Presets</label>
                  <div className="flex flex-wrap gap-2">
                    {behaviorPresets.map((preset) => (
                      <button
                        key={preset.label}
                        type="button"
                        onClick={() => {
                          setRandomness(preset.randomness)
                          setSkew(preset.skew)
                        }}
                        className={cn(
                          "px-2.5 py-1 rounded-md text-xs border transition-colors",
                          isPresetActive(preset)
                            ? "border-primary bg-primary/10 text-primary"
                            : "border-slate-300 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800"
                        )}
                      >
                        {preset.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="space-y-1">
                  <div className="flex items-center justify-between">
                    <label className="text-sm font-semibold">Randomness</label>
                    <span className="text-xs text-muted-foreground">{Math.round(randomness * 100)}%</span>
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={100}
                    step={1}
                    value={Math.round(randomness * 100)}
                    onChange={(e) => setRandomness(Number(e.target.value) / 100)}
                    className="w-full"
                  />
                  <p className="text-xs text-muted-foreground">Higher values introduce more exploratory randomness in ranking.</p>
                </div>

                <div className="space-y-1">
                  <div className="flex items-center justify-between">
                    <label className="text-sm font-semibold">Skew</label>
                    <span className="text-xs text-muted-foreground">{skew.toFixed(2)}x</span>
                  </div>
                  <input
                    type="range"
                    min={25}
                    max={300}
                    step={5}
                    value={Math.round(skew * 100)}
                    onChange={(e) => setSkew(Number(e.target.value) / 100)}
                    className="w-full"
                  />
                  <p className="text-xs text-muted-foreground">Above 1.0 favors tighter matches, below 1.0 broadens variety.</p>
                </div>
              </div>
            </div>
          </div>

          <div className="pt-4 border-t">
            <Button
              onClick={runSearch}
              disabled={!isReady || isSearching || selectedSongCount === 0}
              size="lg"
              className="w-full gap-2"
            >
              <Search className="w-5 h-5" />
              {isSearching ? "Searching..." : "Find Similar Songs"}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
