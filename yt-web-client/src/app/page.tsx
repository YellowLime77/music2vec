"use client"

import React, { useState, useEffect, useMemo } from "react"
import axios from "axios"
import { Loader2, DiscAlbum } from "lucide-react"
import { AppNavigation } from "@/components/app/navigation"
import { ResultsPanel } from "@/components/app/results-panel"
import { FindSimilarTab } from "@/components/tabs/find-similar-tab"
import { LibraryTab } from "@/components/tabs/library-tab"
import { TextSearchTab } from "@/components/tabs/text-search-tab"
import { VisualizationTab } from "@/components/tabs/visualization-tab"
import { UploadTab } from "@/components/tabs/upload-tab"
import { LibraryStructure, SearchResult, SongSearchPayload, TabId, UploadMode, VisualizationPoint, VisualizationTextPoint } from "@/types/music2vec"

const API_BASE_URL = (process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:8000").replace(/\/+$/, "")
const api = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    "ngrok-skip-browser-warning": "1",
  },
})

export default function Home() {
  const [activeTab, setActiveTab] = useState<TabId>("library")
  const [status, setStatus] = useState("Connecting to Backend...")
  const [isReady, setIsReady] = useState(false)
  const [loadProgress, setLoadProgress] = useState(0)
  const [library, setLibrary] = useState<LibraryStructure>({})
  const [clientGroups, setClientGroups] = useState<string[]>([])

  // Song Search Tab
  const [selectedGroupsForSearch, setSelectedGroupsForSearch] = useState<string[]>([])
  const [selectedFromGroup, setSelectedFromGroup] = useState<{ [group: string]: string[] }>({})
  const [algo, setAlgo] = useState("Multi-Centroid")
  const [searchRandomness, setSearchRandomness] = useState(0)
  const [searchSkew, setSearchSkew] = useState(1)
  const [isSongSearching, setIsSongSearching] = useState(false)

  // Text Search Tab
  const [textSearch, setTextSearch] = useState("")
  const [selectedGroupsForTextSearch, setSelectedGroupsForTextSearch] = useState<string[]>([])

  // Visualization Tab
  const [vizPoints, setVizPoints] = useState<VisualizationPoint[]>([])
  const [isVizLoading, setIsVizLoading] = useState(false)
  const [vizTextPoint, setVizTextPoint] = useState<VisualizationTextPoint | null>(null)
  const [isVizTextLoading, setIsVizTextLoading] = useState(false)

  // Upload Tab
  const [uploadMode, setUploadMode] = useState<UploadMode>("url")
  const [urlInput, setUrlInput] = useState("")
  const [songQueriesInput, setSongQueriesInput] = useState("")
  const [isExtracting, setIsExtracting] = useState(false)
  const [extractProgress, setExtractProgress] = useState(0)
  const [selectedGroupForUpload, setSelectedGroupForUpload] = useState("")
  const [newGroupName, setNewGroupName] = useState("")
  const [expandedGroups, setExpandedGroups] = useState<{ [key: string]: boolean }>({})

  // Results & Player
  const [results, setResults] = useState<SearchResult[]>([])
  const [activeVideoId, setActiveVideoId] = useState<string | null>(null)
  const [isMobile, setIsMobile] = useState(false)

  useEffect(() => {
    const checkMobile = () => setIsMobile(window.innerWidth < 768)
    checkMobile()
    window.addEventListener('resize', checkMobile)
    return () => window.removeEventListener('resize', checkMobile)
  }, [])

  useEffect(() => {
    let interval: NodeJS.Timeout
    if (!isReady) {
      interval = setInterval(checkStatus, 1000)
    } else {
      fetchLibrary()
    }
    return () => clearInterval(interval)
  }, [isReady])

  useEffect(() => {
    let extractInterval: NodeJS.Timeout
    if (isExtracting) {
      extractInterval = setInterval(checkExtractStatus, 800)
    }
    return () => clearInterval(extractInterval)
  }, [isExtracting])

  useEffect(() => {
    if (!isReady || activeTab !== "visualization") return
    void fetchVisualizationPoints([])
  }, [activeTab, isReady])

  const checkExtractStatus = async () => {
    try {
      const resp = await api.get("/extract_status")
      if (resp.data.status && resp.data.is_extracting) {
        setStatus(resp.data.status)
        setExtractProgress(resp.data.progress || 0)
      }
    } catch {
      // Handle silently
    }
  }

  const checkStatus = async () => {
    try {
      const resp = await api.get("/status")
      setStatus(resp.data.status || "Unknown Status")
      setLoadProgress(resp.data.progress || 0)
      if (resp.data.ready) {
        setIsReady(true)
      }
    } catch {
      setStatus("Failed to connect to backend...")
    }
  }

  const fetchLibrary = async () => {
    try {
      const resp = await api.get("/library")
      setLibrary(resp.data.library || {})
    } catch (e: unknown) {
      if (e instanceof Error) setStatus(`Error fetching library: ${e.message}`)
    }
  }

  const fetchVisualizationPoints = async (groups: string[]) => {
    setIsVizLoading(true)
    try {
      const resp = await api.post("/visualization/embeddings", { groups })
      setVizPoints(resp.data?.points || [])
    } catch (e: unknown) {
      if (axios.isAxiosError(e)) {
        setStatus(`Visualization failed: ${e.response?.data?.detail || e.message}`)
      } else if (e instanceof Error) {
        setStatus(`Visualization failed: ${e.message}`)
      }
    } finally {
      setIsVizLoading(false)
    }
  }

  const fetchVisualizationTextPoint = async (text: string, groups: string[]) => {
    setIsVizTextLoading(true)
    try {
      const resp = await api.post("/visualization/text", { text, groups })
      setVizTextPoint(resp.data?.point || null)
    } catch (e: unknown) {
      if (axios.isAxiosError(e)) {
        setStatus(`Text projection failed: ${e.response?.data?.detail || e.message}`)
      } else if (e instanceof Error) {
        setStatus(`Text projection failed: ${e.message}`)
      }
    } finally {
      setIsVizTextLoading(false)
    }
  }

  const handleSearchSong = async ({ song_ids1, song_ids2, groups, algo, randomness, skew }: SongSearchPayload) => {
    if (song_ids1.length === 0 && song_ids2.length === 0) {
      setStatus("Select at least one song.")
      return
    }

    setStatus("Searching...")
    setIsSongSearching(true)
    try {
      const res = await api.post("/search/song", {
        song_ids1,
        song_ids2,
        groups,
        algo,
        randomness,
        skew,
      })
      setResults(res.data.results || [])
      setStatus("Ready!")
    } catch (e: unknown) {
      if (axios.isAxiosError(e)) {
        setStatus(`Search failed: ${e.response?.data?.detail || e.message}`)
      } else if (e instanceof Error) {
        setStatus(`Search failed: ${e.message}`)
      }
    } finally {
      setIsSongSearching(false)
    }
  }

  const handleSearchText = async () => {
    if (!textSearch.trim()) return
    const groups = selectedGroupsForTextSearch.length > 0 ? selectedGroupsForTextSearch : Object.keys(library)
    
    setStatus("Searching text...")
    try {
      const res = await api.post("/search/text", {
        text: textSearch.trim(),
        groups
      })
      setResults(res.data.results || [])
      setStatus("Ready!")
    } catch (e: unknown) {
      if (axios.isAxiosError(e)) {
        setStatus(`Text search failed: ${e.response?.data?.detail || e.message}`)
      } else if (e instanceof Error) {
        setStatus(`Text search failed: ${e.message}`)
      }
    }
  }

  const handleExtract = async () => {
    const group = newGroupName.trim() || selectedGroupForUpload || "default"
    if (!group) {
      setStatus("Please select or type a group name")
      return
    }

    setIsExtracting(true)
    setExtractProgress(0)
    setStatus("Extracting embeddings...")
    try {
      let totalProcessed = 0

      if (uploadMode === "url") {
        const lines = urlInput
          .split(/\r?\n/)
          .map((line) => line.trim())
          .filter(Boolean)

        if (lines.length === 0) {
          setStatus("Paste at least one YouTube or Spotify URL first.")
          return
        }

        for (let i = 0; i < lines.length; i += 1) {
          const line = lines[i]
          setStatus(`Processing URL ${i + 1}/${lines.length}...`)
          const res = await api.post(
            "/extract",
            { group, query: line },
            { timeout: 300000 }
          )
          totalProcessed += Number(res.data?.processed || 0)
          setExtractProgress(Math.round(((i + 1) / lines.length) * 100))
        }
      }

      if (uploadMode === "songQueries") {
        const lines = songQueriesInput
          .split(/\r?\n/)
          .map((line) => line.trim())
          .filter(Boolean)

        if (lines.length === 0) {
          setStatus("Enter at least one song name query first.")
          return
        }

        const payload = lines.length === 1
          ? { group, query: lines[0] }
          : { group, playlist_queries: lines, query: "song-query-list" }

        const res = await api.post("/extract", payload, { timeout: 300000 })
        totalProcessed += Number(res.data?.processed || 0)
        setExtractProgress(100)
      }

      setStatus(`Added ${totalProcessed} song(s) to ${group}.`)
      setUrlInput("")
      setSongQueriesInput("")
      setNewGroupName("")
      fetchLibrary()
    } catch (e: unknown) {
      if (axios.isAxiosError(e)) {
        setStatus(`Upload failed: ${e.response?.data?.detail || e.message}`)
      } else if (e instanceof Error) {
        setStatus(`Upload failed: ${e.message}`)
      }
    } finally {
      setExtractProgress(0)
      setIsExtracting(false)
    }
  }

  const handleRemoveSongs = async (group: string, ytIds: string[]) => {
    if (clientGroups.includes(group)) {
      setClientGroups(prev => prev.filter(g => g !== group))
    }

    if (ytIds.length === 0) return
    setStatus(`Removing ${ytIds.length} song(s) from ${group}...`)
    try {
      const res = await api.post("/remove_songs", {
        yt_ids: ytIds,
        group
      })
      setStatus(`Removed ${res.data.removed} song(s) from ${group}.`)
      fetchLibrary()
    } catch (e: unknown) {
      if (axios.isAxiosError(e)) {
        setStatus(`Failed to remove: ${e.response?.data?.detail || e.message}`)
      } else if (e instanceof Error) {
        setStatus(`Failed to remove: ${e.message}`)
      }
    }
  }

  const toggleGroupExpanded = (group: string) => {
    setExpandedGroups(prev => ({
      ...prev,
      [group]: !prev[group]
    }))
  }

  const handleCreateGroup = (groupName: string) => {
    if (groupName.trim() && !clientGroups.includes(groupName.trim()) && !library[groupName.trim()]) {
      setClientGroups([...clientGroups, groupName.trim()])
      setExpandedGroups((prev) => ({ ...prev, [groupName.trim()]: true }))
    }
  }

  const allGroups = Array.from(new Set([...Object.keys(library), ...clientGroups]))

  const extendedLibrary = useMemo(() => {
    const lib = { ...library }
    for (const g of clientGroups) {
      if (!lib[g]) lib[g] = {}
    }
    return lib
  }, [library, clientGroups])

  const renderContent = () => {
    switch (activeTab) {
      case "library":
        return (
          <LibraryTab
            allGroups={allGroups}
            library={extendedLibrary}
            expandedGroups={expandedGroups}
            onToggleGroupExpanded={toggleGroupExpanded}
            onSetActiveVideo={setActiveVideoId}
            onRemoveSongs={handleRemoveSongs}
            onGoToUpload={() => setActiveTab("upload")}
            onCreateGroup={handleCreateGroup}
          />
        )
      
      case "song":
        return (
          <FindSimilarTab
            library={extendedLibrary}
            allGroups={allGroups}
            selectedFromGroup={selectedFromGroup}
            setSelectedFromGroup={setSelectedFromGroup}
            selectedGroupsForSearch={selectedGroupsForSearch}
            setSelectedGroupsForSearch={setSelectedGroupsForSearch}
            algo={algo}
            setAlgo={setAlgo}
            randomness={searchRandomness}
            setRandomness={setSearchRandomness}
            skew={searchSkew}
            setSkew={setSearchSkew}
            isReady={isReady}
            isSearching={isSongSearching}
            onSearch={handleSearchSong}
            expandedGroups={expandedGroups}
            onToggleGroupExpanded={toggleGroupExpanded}
            onSetActiveVideo={setActiveVideoId}
          />
        )
      
      case "text":
        return (
          <TextSearchTab
            textSearch={textSearch}
            setTextSearch={setTextSearch}
            allGroups={allGroups}
            selectedGroupsForTextSearch={selectedGroupsForTextSearch}
            setSelectedGroupsForTextSearch={setSelectedGroupsForTextSearch}
            onSearch={handleSearchText}
            isReady={isReady}
          />
        )
      
      case "upload":
        return (
          <UploadTab
            uploadMode={uploadMode}
            setUploadMode={setUploadMode}
            urlInput={urlInput}
            setUrlInput={setUrlInput}
            songQueriesInput={songQueriesInput}
            setSongQueriesInput={setSongQueriesInput}
            selectedGroupForUpload={selectedGroupForUpload}
            setSelectedGroupForUpload={setSelectedGroupForUpload}
            newGroupName={newGroupName}
            setNewGroupName={setNewGroupName}
            allGroups={allGroups}
            isExtracting={isExtracting}
            extractProgress={extractProgress}
            status={status}
            isReady={isReady}
            onExtract={handleExtract}
          />
        )

      case "visualization":
        return (
          <VisualizationTab
            allGroups={allGroups}
            points={vizPoints}
            textPoint={vizTextPoint}
            isLoading={isVizLoading}
            isTextLoading={isVizTextLoading}
            onRefresh={fetchVisualizationPoints}
            onSearchTextEmbedding={fetchVisualizationTextPoint}
            onClearTextEmbedding={() => setVizTextPoint(null)}
            onSetActiveVideo={setActiveVideoId}
          />
        )
    }
  }

  return (
    <div className="h-screen w-full flex flex-col bg-slate-50 dark:bg-slate-950 overflow-hidden text-slate-900 dark:text-slate-100 font-sans">
      
      {/* Top Navbar */}
      <header className="h-16 shrink-0 bg-white dark:bg-slate-900 border-b flex items-center justify-between px-6 z-20">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center shadow-sm">
            <DiscAlbum className="w-5 h-5 text-primary-foreground text-white" />
          </div>
          <h1 className="font-bold tracking-tight text-lg">Music2Vec <span className="text-muted-foreground font-medium text-sm hidden sm:inline-block ml-1">Studio</span></h1>
        </div>
        
        <div className="flex items-center gap-4">
          <div className="text-sm flex items-center gap-2 bg-slate-100 dark:bg-slate-800/80 px-3 py-1.5 rounded-full border border-slate-200 dark:border-slate-700/50 shadow-inner">
            {!isReady ? (
               <>
                 <Loader2 className="w-3.5 h-3.5 animate-spin text-amber-500" />
                 <span className="font-medium text-amber-600 dark:text-amber-400">
                   {status.includes("Backend") ? status : `${status} ${loadProgress > 0 ? `(${loadProgress}%)` : ''}`}
                 </span>
               </>
            ) : status.includes("Extracting") || status.includes("Searching") ? (
               <>
                 <Loader2 className="w-3.5 h-3.5 animate-spin text-blue-500" />
                 <span className="font-medium text-blue-600 dark:text-blue-400 flex items-center gap-1">
                    Busy <span className="hidden sm:inline-block">({extractProgress}%)</span>
                 </span>
               </>
            ) : (
               <>
                 <div className="w-2 h-2 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.6)]"></div>
                 <span className="font-medium text-emerald-600 dark:text-emerald-400">Ready</span>
               </>
            )}
          </div>
        </div>
      </header>

      {/* Main App Layout */}
      <div className="flex-1 flex overflow-hidden">
        <AppNavigation activeTab={activeTab} onTabChange={setActiveTab} />

        {/* Center Content Area */}
        <main className="flex-1 shrink-0 min-w-0 overflow-y-auto bg-slate-50 dark:bg-slate-950 p-6 md:p-8">
          <div className="max-w-5xl mx-auto">
            <AppNavigation activeTab={activeTab} onTabChange={setActiveTab} mobile />

            {renderContent()}

            <div className="md:hidden mt-8">
              <ResultsPanel
                results={results}
                activeVideoId={isMobile ? activeVideoId : null}
                onSetActiveVideo={setActiveVideoId}
                isSearching={isSongSearching || status.includes("Searching")}
              />
            </div>
          </div>
        </main>

        <aside className="w-[350px] lg:w-[400px] shrink-0 border-l shadow-[-4px_0_24px_rgba(0,0,0,0.02)] dark:shadow-none z-10 hidden md:flex">
          <ResultsPanel
            results={results}
            activeVideoId={!isMobile ? activeVideoId : null}
            onSetActiveVideo={setActiveVideoId}
            isSearching={isSongSearching || status.includes("Searching")}
            className="w-full h-full rounded-none border-0"
          />
        </aside>
      </div>

      {/* Global CSS for hiding scrollbars on mobile nav */}
      <style>{`
        .hide-scrollbar::-webkit-scrollbar {
          display: none;
        }
        .hide-scrollbar {
          -ms-overflow-style: none;
          scrollbar-width: none;
        }
      `}</style>
    </div>
  )
}
