import React, { useRef } from "react"
import { Search } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { useVirtualizer } from "@tanstack/react-virtual"
import { cn } from "@/lib/utils"

const VirtualizedTextSearchGroupList = ({
  allGroups,
  selectedGroupsForTextSearch,
  onToggleGroup,
}: {
  allGroups: string[]
  selectedGroupsForTextSearch: string[]
  onToggleGroup: (group: string) => void
}) => {
  const parentRef = useRef<HTMLDivElement>(null)

  const virtualizer = useVirtualizer({
    count: allGroups.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 34,
    overscan: 12,
  })

  return (
    <div ref={parentRef} className="h-48 overflow-y-auto pr-1 border rounded-md bg-slate-50/40 dark:bg-slate-900/30">
      <div className="relative w-full" style={{ height: `${virtualizer.getTotalSize()}px` }}>
        {virtualizer.getVirtualItems().map((virtualRow) => {
          const group = allGroups[virtualRow.index]
          const isSelected = selectedGroupsForTextSearch.includes(group)
          return (
            <div
              key={`${group}-${virtualRow.index}`}
              className="absolute left-0 top-0 w-full px-2 py-1"
              style={{ transform: `translateY(${virtualRow.start}px)` }}
            >
              <button
                onClick={() => onToggleGroup(group)}
                className={cn(
                  "w-full text-left px-3 py-1.5 rounded-md text-xs font-medium transition-colors border truncate",
                  isSelected
                    ? "bg-primary/10 text-primary border-primary/30"
                    : "bg-white text-slate-600 border-slate-200 hover:bg-slate-50 dark:bg-slate-900 dark:text-slate-400 dark:border-slate-800 dark:hover:bg-slate-800"
                )}
                title={group}
              >
                {group}
              </button>
            </div>
          )
        })}
      </div>
    </div>
  )
}

type TextSearchTabProps = {
  textSearch: string
  setTextSearch: React.Dispatch<React.SetStateAction<string>>
  allGroups: string[]
  selectedGroupsForTextSearch: string[]
  setSelectedGroupsForTextSearch: React.Dispatch<React.SetStateAction<string[]>>
  onSearch: () => void
  isReady: boolean
}

export function TextSearchTab({
  textSearch,
  setTextSearch,
  allGroups,
  selectedGroupsForTextSearch,
  setSelectedGroupsForTextSearch,
  onSearch,
  isReady,
}: TextSearchTabProps) {
  const toggleGroup = (group: string) => {
    setSelectedGroupsForTextSearch((prev) =>
      prev.includes(group) ? prev.filter((g) => g !== group) : [...prev, group]
    )
  }

  return (
    <div className="space-y-6 animate-in fade-in-50 duration-300 max-w-3xl">
      <div>
        <h2 className="text-2xl font-bold tracking-tight">Text Search</h2>
        <p className="text-muted-foreground">Describe the vibe, genre, or instruments you&apos;re looking for.</p>
      </div>

      <Card className="shadow-sm">
        <CardContent className="p-6 space-y-6">
          <div className="space-y-2">
            <label className="text-sm font-semibold">Description</label>
            <div className="relative">
              <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
              <Input
                className="h-14 pl-12 text-base bg-slate-50 dark:bg-slate-900 border-slate-200 dark:border-slate-800 focus-visible:ring-primary/20"
                placeholder="e.g., 'upbeat acoustic guitar with strong female vocals'"
                value={textSearch}
                onChange={(e) => setTextSearch(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && onSearch()}
              />
            </div>
          </div>

          <div className="space-y-3 pt-2">
            <label className="text-sm font-semibold">Filter Search Groups</label>
            <div className="flex flex-wrap gap-2">
              <button
                onClick={() => {
                  if (selectedGroupsForTextSearch.length === allGroups.length) {
                    setSelectedGroupsForTextSearch([])
                  } else {
                    setSelectedGroupsForTextSearch(allGroups)
                  }
                }}
                className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors border ${
                  selectedGroupsForTextSearch.length === allGroups.length && allGroups.length > 0
                    ? "bg-slate-800 text-white border-slate-800 dark:bg-slate-200 dark:text-black dark:border-slate-200"
                    : "bg-white text-slate-600 border-slate-200 hover:bg-slate-50 dark:bg-slate-900 dark:text-slate-400 dark:border-slate-800 dark:hover:bg-slate-800"
                }`}
              >
                All Groups
              </button>
            </div>
            <VirtualizedTextSearchGroupList
              allGroups={allGroups}
              selectedGroupsForTextSearch={selectedGroupsForTextSearch}
              onToggleGroup={toggleGroup}
            />
          </div>

          <div className="pt-4 border-t">
            <Button onClick={onSearch} disabled={!isReady || !textSearch.trim()} size="lg" className="w-full gap-2">
              Search using Text
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
