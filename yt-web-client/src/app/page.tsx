"use client"

import React, { useState, useEffect, useMemo } from "react"
import axios from "axios"
import { Loader2, DiscAlbum } from "lucide-react"
import { AppNavigation } from "@/components/app/navigation"
import { ResultsPanel } from "@/components/app/results-panel"
import { FindSimilarTab } from "@/components/tabs/find-similar-tab"
import { LibraryTab } from "@/components/tabs/library-tab"
import { TextSearchTab } from "@/components/tabs/text-search-tab"
import { UploadTab } from "@/components/tabs/upload-tab"
import { LibraryStructure, SearchResult, SongSearchPayload, TabId, UploadMode, YTMusicCandidate } from "@/types/music2vec"

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://127.0.0.1:8000'

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
  const [isSongSearching, setIsSongSearching] = useState(false)

  // Text Search Tab
  const [textSearch, setTextSearch] = useState("")
  const [selectedGroupsForTextSearch, setSelectedGroupsForTextSearch] = useState<string[]>([])

  // Upload Tab
  const [uploadMode, setUploadMode] = useState<UploadMode>("youtube")
  const [ytInput, setYtInput] = useState("")
  const [singleSongQuery, setSingleSongQuery] = useState("")
  const [singleSongCandidates, setSingleSongCandidates] = useState<YTMusicCandidate[]>([])
  const [selectedCandidateId, setSelectedCandidateId] = useState("")
  const [isSearchingUploadCandidates, setIsSearchingUploadCandidates] = useState(false)
  const [playlistTextInput, setPlaylistTextInput] = useState("")
  const [playlistFileName, setPlaylistFileName] = useState("")
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

  const checkExtractStatus = async () => {
    try {
      const resp = await axios.get(`${API_BASE_URL}/extract_status`)
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
      const resp = await axios.get(`${API_BASE_URL}/status`)
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
      const resp = await axios.get(`${API_BASE_URL}/library`)
      setLibrary(resp.data.library || {})
    } catch (e: unknown) {
      if (e instanceof Error) setStatus(`Error fetching library: ${e.message}`)
    }
  }

  const handleSearchSong = async ({ song_ids1, song_ids2, groups, algo }: SongSearchPayload) => {
    if (song_ids1.length === 0 && song_ids2.length === 0) {
      setStatus("Select at least one song.")
      return
    }

    setStatus("Searching...")
    setIsSongSearching(true)
    try {
      const res = await axios.post(`${API_BASE_URL}/search/song`, {
        song_ids1,
        song_ids2,
        groups,
        algo
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
      const res = await axios.post(`${API_BASE_URL}/search/text`, {
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

  const handleSearchUploadCandidates = async () => {
    if (!singleSongQuery.trim()) {
      setStatus("Type a song + artist query first.")
      return
    }

    setStatus("Searching YouTube Music songs...")
    setIsSearchingUploadCandidates(true)
    setSelectedCandidateId("")
    try {
      const res = await axios.post(`${API_BASE_URL}/ytmusic/search`, {
        query: singleSongQuery.trim(),
        limit: 8,
      })
      const results = (res.data?.results || []) as YTMusicCandidate[]
      setSingleSongCandidates(results)
      if (results.length > 0) {
        setSelectedCandidateId(results[0].yt_id)
        setStatus(`Found ${results.length} candidate songs. Select one and upload.`)
      } else {
        setStatus("No songs found. Try a more specific query.")
      }
    } catch (e: unknown) {
      if (axios.isAxiosError(e)) {
        setStatus(`Search failed: ${e.response?.data?.detail || e.message}`)
      } else if (e instanceof Error) {
        setStatus(`Search failed: ${e.message}`)
      }
    } finally {
      setIsSearchingUploadCandidates(false)
    }
  }

  const handlePlaylistFile = async (file: File | null) => {
    if (!file) return

    if (!file.name.toLowerCase().endsWith(".txt")) {
      setStatus("Please upload a .txt file for playlist queries.")
      return
    }

    try {
      const text = await file.text()
      setPlaylistTextInput(text)
      setPlaylistFileName(file.name)
      setStatus(`Loaded playlist from ${file.name}.`)
    } catch (e: unknown) {
      if (e instanceof Error) {
        setStatus(`Failed to read file: ${e.message}`)
      }
    }
  }

  const handleExtract = async () => {
    const group = newGroupName.trim() || selectedGroupForUpload || "default"
    if (!group) {
      setStatus("Please select or type a group name")
      return
    }

    const payload: {
      group: string
      query?: string
      selected_yt_id?: string
      playlist_queries?: string[]
    } = { group }

    if (uploadMode === "youtube") {
      if (!ytInput.trim()) {
        setStatus("Paste a YouTube URL or video ID first.")
        return
      }
      payload.query = ytInput.trim()
    }

    if (uploadMode === "singleQuery") {
      if (!selectedCandidateId) {
        setStatus("Search and select a song first.")
        return
      }
      payload.selected_yt_id = selectedCandidateId
      payload.query = singleSongQuery.trim()
    }

    if (uploadMode === "playlistQueries") {
      const lines = playlistTextInput
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean)

      if (lines.length === 0) {
        setStatus("Enter playlist lines or upload a .txt file first.")
        return
      }

      payload.playlist_queries = lines
      payload.query = "playlist-queries"
    }

    setIsExtracting(true)
    setStatus("Extracting embeddings...")
    try {
      const res = await axios.post(`${API_BASE_URL}/extract`, payload, { timeout: 300000 })
      setStatus(`Added ${res.data.processed} song(s) to ${group}.`)
      setYtInput("")
      setSingleSongQuery("")
      setSingleSongCandidates([])
      setSelectedCandidateId("")
      setPlaylistTextInput("")
      setPlaylistFileName("")
      setNewGroupName("")
      fetchLibrary()
    } catch (e: unknown) {
      if (axios.isAxiosError(e)) {
        setStatus(`Upload failed: ${e.response?.data?.detail || e.message}`)
      } else if (e instanceof Error) {
        setStatus(`Upload failed: ${e.message}`)
      }
    } finally {
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
      const res = await axios.post(`${API_BASE_URL}/remove_songs`, {
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
            ytInput={ytInput}
            setYtInput={setYtInput}
            singleSongQuery={singleSongQuery}
            setSingleSongQuery={setSingleSongQuery}
            singleSongCandidates={singleSongCandidates}
            selectedCandidateId={selectedCandidateId}
            setSelectedCandidateId={setSelectedCandidateId}
            onSearchUploadCandidates={handleSearchUploadCandidates}
            isSearchingUploadCandidates={isSearchingUploadCandidates}
            playlistTextInput={playlistTextInput}
            setPlaylistTextInput={setPlaylistTextInput}
            playlistFileName={playlistFileName}
            onPlaylistFileSelected={handlePlaylistFile}
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
