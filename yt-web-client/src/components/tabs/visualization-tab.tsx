import React, { useDeferredValue, useMemo, useRef, useState } from "react"
import { Loader2, RefreshCcw, Search, ZoomIn, ZoomOut } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { VisualizationPoint, VisualizationTextPoint } from "@/types/music2vec"
import { cn } from "@/lib/utils"
import { useVirtualizer } from "@tanstack/react-virtual"

type VisualizationTabProps = {
  allGroups: string[]
  points: VisualizationPoint[]
  textPoint: VisualizationTextPoint | null
  isLoading: boolean
  isTextLoading: boolean
  onRefresh: (groups: string[]) => Promise<void>
  onSearchTextEmbedding: (text: string, groups: string[]) => Promise<void>
  onClearTextEmbedding: () => void
  onSetActiveVideo: (ytId: string) => void
}

type Viewport = {
  scale: number
  tx: number
  ty: number
}

const PALETTE = [
  "#2563eb",
  "#ef4444",
  "#16a34a",
  "#f59e0b",
  "#0891b2",
  "#7c3aed",
  "#dc2626",
  "#0d9488",
  "#4f46e5",
  "#9333ea",
  "#ea580c",
  "#0f766e",
]

const pointKey = (p: VisualizationPoint) => `${p.group}::${p.yt_id}`

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))

const VirtualizedSearchMatches = ({
  searchMatches,
  resolvedFocusedKey,
  onFocus,
}: {
  searchMatches: VisualizationPoint[]
  resolvedFocusedKey: string | null
  onFocus: (key: string) => void
}) => {
  const parentRef = useRef<HTMLDivElement>(null)

  const virtualizer = useVirtualizer({
    count: searchMatches.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 34,
    overscan: 10,
  })

  return (
    <div ref={parentRef} className="h-44 overflow-y-auto pr-1 border rounded-md bg-slate-50/50 dark:bg-slate-900/30">
      <div className="relative w-full" style={{ height: `${virtualizer.getTotalSize()}px` }}>
        {virtualizer.getVirtualItems().map((virtualRow) => {
          const p = searchMatches[virtualRow.index]
          const key = pointKey(p)
          const isActive = resolvedFocusedKey === key

          return (
            <div
              key={`${key}-${virtualRow.index}`}
              className="absolute left-0 top-0 w-full px-2 py-1"
              style={{ transform: `translateY(${virtualRow.start}px)` }}
            >
              <button
                type="button"
                onClick={() => onFocus(key)}
                className={cn(
                  "w-full text-left text-xs px-2.5 py-1 rounded-md border transition-colors truncate",
                  isActive
                    ? "border-primary bg-primary/10 text-primary"
                    : "border-slate-200 hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-900"
                )}
                title={p.display_name}
              >
                {p.display_name}
              </button>
            </div>
          )
        })}
      </div>
    </div>
  )
}

export function VisualizationTab({
  allGroups,
  points,
  textPoint,
  isLoading,
  isTextLoading,
  onRefresh,
  onSearchTextEmbedding,
  onClearTextEmbedding,
  onSetActiveVideo,
}: VisualizationTabProps) {
  const [selectedGroups, setSelectedGroups] = useState<string[]>(allGroups)
  const [query, setQuery] = useState("")
  const [textQuery, setTextQuery] = useState("")
  const [focusedPointKey, setFocusedPointKey] = useState<string | null>(null)
  const [viewport, setViewport] = useState<Viewport>({ scale: 1, tx: 0, ty: 0 })
  const [dragStart, setDragStart] = useState<{ x: number; y: number; tx: number; ty: number } | null>(null)
  const [hasDragged, setHasDragged] = useState(false)

  const svgRef = useRef<SVGSVGElement | null>(null)
  const deferredQuery = useDeferredValue(query)

  const sanitizedSelectedGroups = useMemo(() => {
    return selectedGroups.filter((g) => allGroups.includes(g))
  }, [selectedGroups, allGroups])

  const groupColors = useMemo(() => {
    const map: Record<string, string> = {}
    allGroups.forEach((group, idx) => {
      map[group] = PALETTE[idx % PALETTE.length]
    })
    return map
  }, [allGroups])

  const filteredPoints = useMemo(() => {
    if (sanitizedSelectedGroups.length === 0) return []
    return points.filter((p) => sanitizedSelectedGroups.includes(p.group))
  }, [points, sanitizedSelectedGroups])

  const normalizedQuery = deferredQuery.trim().toLowerCase()

  const searchMatches = useMemo(() => {
    if (!normalizedQuery) return []
    return filteredPoints.filter((p) => {
      const haystack = `${p.display_name} ${p.group} ${p.yt_id}`.toLowerCase()
      return haystack.includes(normalizedQuery)
    })
  }, [filteredPoints, normalizedQuery])

  const searchMatchKeys = useMemo(() => {
    return new Set(searchMatches.map((p) => pointKey(p)))
  }, [searchMatches])

  const resolvedFocusedKey = useMemo(() => {
    if (!normalizedQuery || searchMatches.length === 0) {
      return focusedPointKey
    }
    if (focusedPointKey && searchMatches.some((p) => pointKey(p) === focusedPointKey)) {
      return focusedPointKey
    }
    return pointKey(searchMatches[0])
  }, [focusedPointKey, normalizedQuery, searchMatches])

  const focusedPoint = useMemo(() => {
    if (!resolvedFocusedKey) return null
    return filteredPoints.find((p) => pointKey(p) === resolvedFocusedKey) ?? null
  }, [filteredPoints, resolvedFocusedKey])

  const width = 1000
  const height = 640
  const pad = 60

  const projectX = (x: number) => pad + ((x + 1) / 2) * (width - pad * 2)
  const projectY = (y: number) => height - (pad + ((y + 1) / 2) * (height - pad * 2))

  const toggleGroup = (group: string) => {
    setSelectedGroups((prev) => {
      if (prev.includes(group)) {
        return prev.filter((g) => g !== group)
      }
      return [...prev, group]
    })
  }

  const setAllGroups = () => {
    setSelectedGroups(allGroups)
  }

  const clearGroups = () => {
    setSelectedGroups([])
  }

  const onPointerDown = (e: React.MouseEvent<SVGSVGElement>) => {
    setDragStart({ x: e.clientX, y: e.clientY, tx: viewport.tx, ty: viewport.ty })
    setHasDragged(false)
  }

  const onPointerMove = (e: React.MouseEvent<SVGSVGElement>) => {
    if (!dragStart || !svgRef.current) return

    const rect = svgRef.current.getBoundingClientRect()
    const scaleX = width / rect.width
    const scaleY = height / rect.height
    const dx = (e.clientX - dragStart.x) * scaleX
    const dy = (e.clientY - dragStart.y) * scaleY

    if (!hasDragged && (Math.abs(dx) > 2 || Math.abs(dy) > 2)) {
      setHasDragged(true)
    }

    setViewport((prev) => ({ ...prev, tx: dragStart.tx + dx, ty: dragStart.ty + dy }))
  }

  const endDrag = () => {
    setDragStart(null)
    window.setTimeout(() => setHasDragged(false), 0)
  }

  const handleWheel = (e: React.WheelEvent<SVGSVGElement>) => {
    if (!svgRef.current) return
    e.preventDefault()

    const rect = svgRef.current.getBoundingClientRect()
    const px = (e.clientX - rect.left) * (width / rect.width)
    const py = (e.clientY - rect.top) * (height / rect.height)

    setViewport((prev) => {
      const factor = e.deltaY < 0 ? 1.12 : 0.88
      const newScale = clamp(prev.scale * factor, 0.6, 8)
      const worldX = (px - prev.tx) / prev.scale
      const worldY = (py - prev.ty) / prev.scale
      const tx = px - worldX * newScale
      const ty = py - worldY * newScale
      return { scale: newScale, tx, ty }
    })
  }

  const zoomBy = (factor: number) => {
    const px = width / 2
    const py = height / 2
    setViewport((prev) => {
      const newScale = clamp(prev.scale * factor, 0.6, 8)
      const worldX = (px - prev.tx) / prev.scale
      const worldY = (py - prev.ty) / prev.scale
      const tx = px - worldX * newScale
      const ty = py - worldY * newScale
      return { scale: newScale, tx, ty }
    })
  }

  const resetView = () => {
    setViewport({ scale: 1, tx: 0, ty: 0 })
  }

  const handleSearchTextEmbedding = async () => {
    const value = textQuery.trim()
    if (!value) return
    await onSearchTextEmbedding(value, sanitizedSelectedGroups)
  }

  return (
    <div className="space-y-6 animate-in fade-in-50 duration-300">
      <div>
        <h2 className="text-2xl font-bold tracking-tight">Embedding Map</h2>
        <p className="text-muted-foreground">A 2D projection of embedding similarity. Nearby dots are musically closer.</p>
      </div>

      <Card className="shadow-sm">
        <CardHeader className="pb-4">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div className="space-y-1">
              <CardTitle>Controls</CardTitle>
              <CardDescription>Filter visible groups, search songs, and project text embeddings onto the same map.</CardDescription>
            </div>
            <Button
              type="button"
              variant="outline"
              className="gap-2"
              onClick={() => onRefresh(sanitizedSelectedGroups)}
              disabled={isLoading}
            >
              {isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCcw className="w-4 h-4" />}
              Refresh Map
            </Button>
          </div>
        </CardHeader>

        <CardContent className="space-y-5">
          <div className="space-y-3">
            <label className="text-sm font-semibold">Visible Groups</label>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={setAllGroups}
                className={cn(
                  "px-3 py-1.5 rounded-full text-xs font-medium border transition-colors",
                  sanitizedSelectedGroups.length === allGroups.length && allGroups.length > 0
                    ? "bg-slate-900 text-white border-slate-900 dark:bg-slate-100 dark:text-slate-900 dark:border-slate-100"
                    : "bg-white text-slate-600 border-slate-200 hover:bg-slate-50 dark:bg-slate-900 dark:text-slate-300 dark:border-slate-700"
                )}
              >
                All
              </button>
              <button
                type="button"
                onClick={clearGroups}
                className={cn(
                  "px-3 py-1.5 rounded-full text-xs font-medium border transition-colors",
                  sanitizedSelectedGroups.length === 0
                    ? "bg-slate-900 text-white border-slate-900 dark:bg-slate-100 dark:text-slate-900 dark:border-slate-100"
                    : "bg-white text-slate-600 border-slate-200 hover:bg-slate-50 dark:bg-slate-900 dark:text-slate-300 dark:border-slate-700"
                )}
              >
                None
              </button>
              {allGroups.map((group) => {
                const selected = sanitizedSelectedGroups.includes(group)
                const color = groupColors[group] || "#64748b"
                return (
                  <button
                    type="button"
                    key={group}
                    onClick={() => toggleGroup(group)}
                    className={cn(
                      "px-3 py-1.5 rounded-full text-xs font-medium border transition-colors flex items-center gap-2",
                      selected
                        ? "bg-primary/10 text-primary border-primary/30"
                        : "bg-white text-slate-600 border-slate-200 hover:bg-slate-50 dark:bg-slate-900 dark:text-slate-300 dark:border-slate-700"
                    )}
                  >
                    <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: color }} />
                    {group}
                  </button>
                )
              })}
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-semibold">Find Song On Map</label>
            <div className="relative max-w-xl">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search by song title, group, or YouTube ID"
                className="pl-9"
              />
            </div>
            {normalizedQuery && (
              <p className="text-xs text-muted-foreground">
                {searchMatches.length} match{searchMatches.length === 1 ? "" : "es"} in visible groups.
              </p>
            )}
            {searchMatches.length > 0 && (
              <VirtualizedSearchMatches
                searchMatches={searchMatches}
                resolvedFocusedKey={resolvedFocusedKey}
                onFocus={setFocusedPointKey}
              />
            )}
          </div>

          <div className="space-y-2">
            <label className="text-sm font-semibold">Project Text Embedding</label>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <div className="relative flex-1 max-w-xl">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input
                  value={textQuery}
                  onChange={(e) => setTextQuery(e.target.value)}
                  placeholder="e.g. dreamy synth with female vocals"
                  className="pl-9"
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      void handleSearchTextEmbedding()
                    }
                  }}
                />
              </div>
              <Button
                type="button"
                variant="default"
                onClick={() => void handleSearchTextEmbedding()}
                disabled={isTextLoading || !textQuery.trim()}
                className="gap-2"
              >
                {isTextLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
                Locate Text
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={onClearTextEmbedding}
                disabled={!textPoint}
              >
                Clear
              </Button>
            </div>
            {textPoint && (
              <p className="text-xs text-muted-foreground">
                Text point: &quot;{textPoint.text}&quot;.
              </p>
            )}
          </div>
        </CardContent>
      </Card>

      <Card className="shadow-sm overflow-hidden">
        <CardContent className="p-0">
          <div className="w-full h-[60vh] min-h-[420px] bg-gradient-to-b from-slate-50 to-white dark:from-slate-950 dark:to-slate-900 border-t relative">
            {isLoading && (
              <div className="absolute inset-0 z-20 bg-white/70 dark:bg-slate-950/70 backdrop-blur-[1px] flex items-center justify-center gap-2 text-sm font-medium">
                <Loader2 className="w-4 h-4 animate-spin" />
                Building projection...
              </div>
            )}

            <div className="absolute right-3 top-3 z-10 flex items-center gap-2">
              <Button type="button" size="sm" variant="outline" onClick={() => zoomBy(1.15)} className="h-8 px-2">
                <ZoomIn className="w-4 h-4" />
              </Button>
              <Button type="button" size="sm" variant="outline" onClick={() => zoomBy(0.87)} className="h-8 px-2">
                <ZoomOut className="w-4 h-4" />
              </Button>
              <Button type="button" size="sm" variant="outline" onClick={resetView} className="h-8 px-2.5 text-xs">
                Reset
              </Button>
            </div>

            {filteredPoints.length === 0 ? (
              <div className="h-full w-full flex items-center justify-center text-muted-foreground text-sm px-6 text-center">
                {sanitizedSelectedGroups.length === 0
                  ? "No groups selected. Choose at least one group to render points."
                  : "No points to show. Try refreshing the map."}
              </div>
            ) : (
              <svg
                ref={svgRef}
                viewBox={`0 0 ${width} ${height}`}
                className={cn("w-full h-full", dragStart ? "cursor-grabbing" : "cursor-grab")}
                onMouseDown={onPointerDown}
                onMouseMove={onPointerMove}
                onMouseUp={endDrag}
                onMouseLeave={endDrag}
                onWheel={handleWheel}
              >
                <g transform={`translate(${viewport.tx} ${viewport.ty}) scale(${viewport.scale})`}>
                  {[0, 1, 2, 3, 4].map((i) => {
                    const t = i / 4
                    const x = pad + t * (width - 2 * pad)
                    const y = pad + t * (height - 2 * pad)
                    return (
                      <g key={i}>
                        <line x1={x} y1={pad} x2={x} y2={height - pad} stroke="currentColor" className="text-slate-300/70 dark:text-slate-700/70" strokeWidth="1" />
                        <line x1={pad} y1={y} x2={width - pad} y2={y} stroke="currentColor" className="text-slate-300/70 dark:text-slate-700/70" strokeWidth="1" />
                      </g>
                    )
                  })}

                  <line x1={pad} y1={height / 2} x2={width - pad} y2={height / 2} stroke="currentColor" className="text-slate-500/80 dark:text-slate-500/80" strokeWidth="1.5" />
                  <line x1={width / 2} y1={pad} x2={width / 2} y2={height - pad} stroke="currentColor" className="text-slate-500/80 dark:text-slate-500/80" strokeWidth="1.5" />

                  {filteredPoints.map((p) => {
                    const key = pointKey(p)
                    const isFocused = resolvedFocusedKey === key
                    const isMatch = normalizedQuery.length > 0 && searchMatchKeys.has(key)
                    const x = projectX(p.x)
                    const y = projectY(p.y)
                    const fill = groupColors[p.group] || "#64748b"

                    return (
                      <g key={key}>
                        {isFocused && (
                          <circle cx={x} cy={y} r={16} fill={fill} fillOpacity={0.15} />
                        )}
                        <circle
                          cx={x}
                          cy={y}
                          r={isFocused ? 8 : isMatch ? 6 : 4.5}
                          fill={fill}
                          fillOpacity={isFocused ? 1 : 0.85}
                          stroke={isFocused ? "white" : "none"}
                          strokeWidth={isFocused ? 2.5 : 0}
                          className="cursor-pointer"
                          onClick={() => {
                            if (hasDragged) return
                            setFocusedPointKey(key)
                            onSetActiveVideo(p.yt_id)
                          }}
                        >
                          <title>{`${p.display_name} (${p.group})`}</title>
                        </circle>
                      </g>
                    )
                  })}

                  {focusedPoint && (
                    <g>
                      <rect
                        x={Math.max(pad, Math.min(width - 330, projectX(focusedPoint.x) + 14))}
                        y={Math.max(pad, Math.min(height - 64, projectY(focusedPoint.y) - 36))}
                        width="320"
                        height="52"
                        rx="8"
                        fill="rgba(15,23,42,0.88)"
                      />
                      <text
                        x={Math.max(pad + 12, Math.min(width - 318, projectX(focusedPoint.x) + 26))}
                        y={Math.max(pad + 20, Math.min(height - 20, projectY(focusedPoint.y) - 16))}
                        fill="white"
                        fontSize="14"
                        fontWeight="600"
                      >
                        {focusedPoint.display_name.length > 48
                          ? `${focusedPoint.display_name.slice(0, 45)}...`
                          : focusedPoint.display_name}
                      </text>
                      <text
                        x={Math.max(pad + 12, Math.min(width - 318, projectX(focusedPoint.x) + 26))}
                        y={Math.max(pad + 38, Math.min(height - 8, projectY(focusedPoint.y) + 2))}
                        fill="rgba(255,255,255,0.82)"
                        fontSize="12"
                      >
                        {focusedPoint.group}
                      </text>
                    </g>
                  )}

                  {textPoint && (
                    <g>
                      <circle cx={projectX(textPoint.x)} cy={projectY(textPoint.y)} r={24} fill="#f97316" fillOpacity={0.18} />
                      <circle cx={projectX(textPoint.x)} cy={projectY(textPoint.y)} r={12} fill="#f97316" stroke="white" strokeWidth="3" />
                      <line
                        x1={projectX(textPoint.x) - 16}
                        y1={projectY(textPoint.y)}
                        x2={projectX(textPoint.x) + 16}
                        y2={projectY(textPoint.y)}
                        stroke="#f97316"
                        strokeWidth="3"
                      />
                      <line
                        x1={projectX(textPoint.x)}
                        y1={projectY(textPoint.y) - 16}
                        x2={projectX(textPoint.x)}
                        y2={projectY(textPoint.y) + 16}
                        stroke="#f97316"
                        strokeWidth="3"
                      />
                    </g>
                  )}
                </g>
              </svg>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
