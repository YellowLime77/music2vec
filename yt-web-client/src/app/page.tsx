"use client"

import React, { useState, useEffect, useRef } from "react"
import axios from "axios"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Progress } from "@/components/ui/progress"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { X, Search, Plus, Play, ListMusic, Music, Database, Info, Loader2 } from "lucide-react"

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://127.0.0.1:8000';

export default function Home() {
  const [status, setStatus] = useState("Connecting to Backend...")
  const [progress, setProgress] = useState(0)
  const [isReady, setIsReady] = useState(false)
  const [library, setLibrary] = useState<Record<string, string>>({})
  const [tempLibrary, setTempLibrary] = useState<Record<string, string>>({})

  // Song Search Tab
  const [searchFilter, setSearchFilter] = useState("")
  const [selectedLibrarySongs, setSelectedLibrarySongs] = useState<string[]>([])
  const [group1, setGroup1] = useState<string[]>([])
  const [group2, setGroup2] = useState<string[]>([])
  const [algo, setAlgo] = useState("Multi-Centroid")

  // Text Search Tab
  const [textSearch, setTextSearch] = useState("")

  // Add YouTube ID Tab
  const [ytInput, setYtInput] = useState("")
  const [isExtracting, setIsExtracting] = useState(false)
  const [selectedTempLibSongs, setSelectedTempLibSongs] = useState<string[]>([])
  const [tempGroup, setTempGroup] = useState<string[]>([])

  // Results & Player
  const [results, setResults] = useState<{yt_id: string, display_name: string, similarity: number}[]>([])
  const [activeVideoId, setActiveVideoId] = useState<string | null>(null)

  useEffect(() => {
    let interval: NodeJS.Timeout
    if (!isReady) {
      interval = setInterval(checkStatus, 1000)
    } else {
      fetchLibrary()
    }
    return () => clearInterval(interval)
  }, [isReady])

  const checkStatus = async () => {
    try {
      const resp = await axios.get(`${API_BASE_URL}/status`)
      setProgress(resp.data.progress || 0)
      setStatus(resp.data.status || "Unknown Status")
      if (resp.data.ready) {
        setIsReady(true)
      }
    } catch (e) {
      setStatus("Failed to connect to backend...")
    }
  }

  const fetchLibrary = async () => {
    try {
      const resp = await axios.get(`${API_BASE_URL}/library`)
      setLibrary(resp.data.library || {})
      setTempLibrary(resp.data.temp_library || {})
    } catch (e: any) {
      setStatus(`Error fetching library: ${e.message}`)
    }
  }

  const handleSearchSong = async (useTemp: boolean) => {
    let g1 = group1
    let g2 = group2
    if (useTemp) {
      g1 = tempGroup.length > 0 ? tempGroup : selectedTempLibSongs
      g2 = []
    } else {
      if (group1.length === 0 && group2.length === 0) {
        g1 = selectedLibrarySongs
        g2 = []
      }
    }

    if (g1.length === 0 && g2.length === 0) {
      setStatus("Select at least one song.")
      return
    }

    setStatus("Searching...")
    try {
      const res = await axios.post(`${API_BASE_URL}/search/song`, {
        group1: g1,
        group2: g2,
        algo,
        use_temp: useTemp
      })
      setResults(res.data.results || [])
      setStatus("Ready!")
    } catch (e: any) {
      setStatus(`Search failed: ${e.response?.data?.detail || e.message}`)
    }
  }

  const handleSearchText = async () => {
    if (!textSearch.trim()) return
    setStatus("Searching text...")
    try {
      const res = await axios.post(`${API_BASE_URL}/search/text`, { text: textSearch.trim() })
      setResults(res.data.results || [])
      setStatus("Ready!")
    } catch (e: any) {
      setStatus(`Text search failed: ${e.response?.data?.detail || e.message}`)
    }
  }

  const handleExtract = async () => {
    if (!ytInput.trim()) return
    setIsExtracting(true)
    setStatus(`Extracting embeddings for ${ytInput}...`)
    try {
      const res = await axios.post(`${API_BASE_URL}/extract`, { query: ytInput.trim() }, { timeout: 300000 })
      setStatus(`Added ${res.data.processed} song(s) to temp library.`)
      fetchLibrary()
    } catch (e: any) {
      setStatus(`Upload failed: ${e.response?.data?.detail || e.message}`)
    } finally {
      setIsExtracting(false)
    }
  }

  const toggleSelection = (id: string, selectedList: string[], setter: React.Dispatch<React.SetStateAction<string[]>>) => {
    if (selectedList.includes(id)) {
      setter(selectedList.filter(x => x !== id))
    } else {
      setter([...selectedList, id])
    }
  }

  const addSelectedToGroup = (selected: string[], groupSetter: React.Dispatch<React.SetStateAction<string[]>>, currentGroup: string[]) => {
    const newItems = selected.filter(id => !currentGroup.includes(id))
    groupSetter([...currentGroup, ...newItems])
    // Optionally unselect from library list after adding:
    // setSelectedLibrarySongs([]) 
  }

  const removeGroupSong = (id: string, groupSetter: React.Dispatch<React.SetStateAction<string[]>>, currentGroup: string[]) => {
    groupSetter(currentGroup.filter(x => x !== id))
  }

  const libraryEntries = Object.entries(library).filter(([id, name]) => name.toLowerCase().includes(searchFilter.toLowerCase()))
  const tempLibraryEntries = Object.entries(tempLibrary)

  return (
    <div className="min-h-screen bg-slate-50/50 dark:bg-slate-950 pb-12">
      {/* Header */}
      <header className="sticky top-0 z-10 bg-white/80 dark:bg-slate-900/80 backdrop-blur-md border-b shadow-sm w-full mb-6">
        <div className="container mx-auto px-4 max-w-7xl h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="bg-primary/10 p-2 rounded-lg">
              <Music className="w-5 h-5 text-primary" />
            </div>
            <h1 className="font-bold tracking-tight text-xl">Music2Vec <span className="text-muted-foreground font-normal">Explorer</span></h1>
          </div>
          <div className="flex items-center gap-3">
            <div className="text-sm font-medium flex items-center gap-2 bg-slate-100 dark:bg-slate-800 px-3 py-1.5 rounded-full">
              {!isReady && <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />}
              <span className={status.includes("Ready") || status.includes("Added") ? "text-primary" : "text-muted-foreground"}>{status}</span>
            </div>
            {!isReady && (
                <div className="w-24 px-2 hidden sm:block">
                  <Progress value={progress} className="h-2" />
                </div>
            )}
          </div>
        </div>
      </header>

      <div className="container mx-auto px-4 max-w-7xl flex flex-col lg:flex-row gap-6">
        
        {/* Left Column: Search & Controls */}
        <div className="flex-1 min-w-0 flex flex-col gap-6">
          <Tabs defaultValue="song" className="w-full">
            <TabsList className="w-full grid grid-cols-3 h-12 p-1 bg-slate-100/80 dark:bg-slate-900 border">
              <TabsTrigger value="song" className="font-medium">Search By Song</TabsTrigger>
              <TabsTrigger value="text" className="font-medium">Search By Text</TabsTrigger>
              <TabsTrigger value="upload" className="font-medium">+ Upload/Add</TabsTrigger>
            </TabsList>
            
            <div className="mt-4">
              <TabsContent value="song" className="m-0">
                <Card className="border shadow-sm">
                  <CardHeader className="pb-4 border-b bg-slate-50/50 dark:bg-slate-900/50">
                    <CardTitle className="flex items-center gap-2 text-lg">
                      <ListMusic className="w-5 h-5 text-muted-foreground" />
                      Music Library
                    </CardTitle>
                    <CardDescription>Select songs to build groups and find acoustic similarities.</CardDescription>
                  </CardHeader>
                  <CardContent className="pt-6 flex flex-col gap-6">
                    
                    {/* Search row */}
                    <div className="flex flex-col sm:flex-row gap-3">
                      <div className="relative flex-1">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                        <Input 
                          className="pl-9 bg-slate-50 dark:bg-slate-900/50 focus-visible:bg-transparent"
                          placeholder="Search library..." 
                          value={searchFilter} 
                          onChange={e => setSearchFilter(e.target.value)} 
                        />
                      </div>
                      <div className="flex gap-2">
                          <Button variant="secondary" className="shadow-sm" onClick={() => addSelectedToGroup(selectedLibrarySongs, setGroup1, group1)} disabled={selectedLibrarySongs.length === 0}>
                            Add To G1
                          </Button>
                          <Button variant="secondary" className="shadow-sm" onClick={() => addSelectedToGroup(selectedLibrarySongs, setGroup2, group2)} disabled={selectedLibrarySongs.length === 0}>
                            Add To G2
                          </Button>
                      </div>
                    </div>
                    
                    {/* Library List */}
                    <div className="border rounded-xl  overflow-hidden bg-background shadow-inner">
                      <div className="bg-slate-100 dark:bg-slate-800/80 px-4 py-2 border-b text-xs font-semibold text-muted-foreground uppercase tracking-wider flex justify-between items-center">
                        <span>Library Entries</span>
                        <span>{libraryEntries.length} songs</span>
                      </div>
                      <ScrollArea className="h-[220px]">
                        {libraryEntries.length > 0 ? (
                          <div className="p-1.5 flex flex-col gap-1">
                            {libraryEntries.map(([id, name]) => {
                              const isSelected = selectedLibrarySongs.includes(id);
                              return (
                                <div 
                                  key={id} 
                                  className={`px-3 py-2 text-sm cursor-pointer rounded-lg flex items-center justify-between transition-colors min-w-0
                                    ${isSelected 
                                      ? 'bg-primary/10 text-primary border border-primary/20 shadow-sm font-medium' 
                                      : 'hover:bg-slate-100 dark:hover:bg-slate-800 border border-transparent'}`}
                                  onClick={() => toggleSelection(id, selectedLibrarySongs, setSelectedLibrarySongs)}
                                  onDoubleClick={() => setActiveVideoId(id)}
                                >
                                  <span className="truncate pr-4 flex-1" title={name}>{name}</span>
                                  {isSelected && <div className="w-2 h-2 rounded-full bg-primary shrink-0" />}
                                </div>
                              )
                            })}
                          </div>
                        ) : (
                          <div className="h-full flex items-center justify-center text-sm text-muted-foreground flex-col gap-2 opacity-60">
                            <Database className="w-8 h-8" />
                            <p>No songs found in Library.</p>
                          </div>
                        )}
                      </ScrollArea>
                    </div>

                    {/* Groups */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      
                      {/* Group 1 */}
                      <div className="border rounded-xl overflow-hidden bg-slate-50/50 dark:bg-slate-900/30 min-w-0">
                        <div className="flex justify-between items-center px-4 py-2 bg-slate-100 dark:bg-slate-800 border-b">
                          <span className="text-sm font-semibold text-slate-700 dark:text-slate-300">Group 1</span>
                          {group1.length > 0 && <Button variant="ghost" size="sm" className="h-6 px-2 text-xs text-muted-foreground hover:text-destructive" onClick={() => setGroup1([])}>Clear</Button>}
                        </div>
                        <ScrollArea className="h-36">
                          {group1.length > 0 ? (
                            <div className="p-1 flex flex-col gap-1">
                              {group1.map(id => (
                                <div key={id} className="min-w-0 px-3 py-1.5 text-xs flex justify-between items-center group/item hover:bg-slate-200/50 dark:hover:bg-slate-800/50 rounded-md transition-colors border border-transparent hover:border-slate-200 dark:hover:border-slate-700">
                                    <span className="truncate flex-1 font-medium min-w-0 pr-2" title={library[id] || id}>{library[id] || id}</span>
                                    <button 
                                      className="shrink-0 text-muted-foreground hover:text-destructive hover:bg-destructive/10 p-1 rounded transition-colors opacity-0 group-hover/item:opacity-100 focus:opacity-100" 
                                      onClick={() => removeGroupSong(id, setGroup1, group1)}
                                      title="Remove"
                                    >
                                      <X className="w-3.5 h-3.5" />
                                    </button>
                                </div>
                              ))}
                            </div>
                          ) : (
                            <div className="h-full flex items-center justify-center text-xs text-muted-foreground px-4 text-center">
                                Select songs from the library to add here.
                            </div>
                          )}
                        </ScrollArea>
                      </div>

                      {/* Group 2 */}
                      <div className="border rounded-xl overflow-hidden bg-slate-50/50 dark:bg-slate-900/30 min-w-0">
                        <div className="flex justify-between items-center px-4 py-2 bg-slate-100 dark:bg-slate-800 border-b">
                          <span className="text-sm font-semibold text-slate-700 dark:text-slate-300">Group 2</span>
                          {group2.length > 0 && <Button variant="ghost" size="sm" className="h-6 px-2 text-xs text-muted-foreground hover:text-destructive" onClick={() => setGroup2([])}>Clear</Button>}
                        </div>
                        <ScrollArea className="h-36">
                          {group2.length > 0 ? (
                            <div className="p-1 flex flex-col gap-1">
                              {group2.map(id => (
                                <div key={id} className="min-w-0 px-3 py-1.5 text-xs flex justify-between items-center group/item hover:bg-slate-200/50 dark:hover:bg-slate-800/50 rounded-md transition-colors border border-transparent hover:border-slate-200 dark:hover:border-slate-700">
                                    <span className="truncate flex-1 font-medium min-w-0 pr-2" title={library[id] || id}>{library[id] || id}</span>
                                    <button 
                                      className="shrink-0 text-muted-foreground hover:text-destructive hover:bg-destructive/10 p-1 rounded transition-colors opacity-0 group-hover/item:opacity-100 focus:opacity-100" 
                                      onClick={() => removeGroupSong(id, setGroup2, group2)}
                                      title="Remove"
                                    >
                                      <X className="w-3.5 h-3.5" />
                                    </button>
                                </div>
                              ))}
                            </div>
                          ) : (
                            <div className="h-full flex items-center justify-center text-xs text-muted-foreground px-4 text-center">
                                Select songs from the library to add here.
                            </div>
                          )}
                        </ScrollArea>
                      </div>
                    </div>

                    {/* Bottom Action Row */}
                    <div className="flex flex-col sm:flex-row gap-4 items-center justify-between pt-2 border-t">
                      <div className="flex items-center gap-3 w-full sm:w-auto">
                        <span className="text-sm font-medium text-muted-foreground">Combination Algorithm:</span>
                        <Select value={algo} onValueChange={setAlgo}>
                          <SelectTrigger className="w-[180px] bg-background shadow-sm">
                              <SelectValue placeholder="Algorithm" />
                          </SelectTrigger>
                          <SelectContent>
                              <SelectItem value="Multi-Centroid">Multi-Centroid</SelectItem>
                              <SelectItem value="Average Vector">Average Vector</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      
                      <Button onClick={() => handleSearchSong(false)} disabled={!isReady} className="w-full sm:w-auto gap-2 shadow-md hover:shadow-lg transition-shadow">
                        <Search className="w-4 h-4" />
                        Find Similar Songs
                      </Button>
                    </div>

                  </CardContent>
                </Card>
              </TabsContent>
              
              <TabsContent value="text" className="m-0">
                <Card className="border shadow-sm">
                  <CardHeader className="pb-4 border-b bg-slate-50/50 dark:bg-slate-900/50">
                    <CardTitle className="text-lg">Semantic Text Search</CardTitle>
                    <CardDescription>Describe the music style, mood, or instruments you are looking for.</CardDescription>
                  </CardHeader>
                  <CardContent className="pt-8 pb-10">
                    <div className="flex flex-col sm:flex-row gap-3 max-w-2xl mx-auto">
                      <Input 
                        className="flex-1 shadow-sm text-base h-12"
                        placeholder="e.g. 'upbeat acoustic guitar with strong vocals'" 
                        value={textSearch}
                        onChange={e => setTextSearch(e.target.value)}
                        onKeyDown={e => e.key === 'Enter' && handleSearchText()}
                      />
                      <Button onClick={handleSearchText} disabled={!isReady || !textSearch.trim()} className="h-12 px-6 gap-2 w-full sm:w-auto">
                        <Search className="w-4 h-4" />
                        Search
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              </TabsContent>
              
              <TabsContent value="upload" className="m-0">
                <Card className="border shadow-sm">
                  <CardHeader className="pb-4 border-b bg-slate-50/50 dark:bg-slate-900/50">
                    <CardTitle className="flex items-center gap-2 text-lg">
                      <Plus className="w-5 h-5 text-muted-foreground" />
                      Add from YouTube/Spotify
                    </CardTitle>
                    <CardDescription>Extract embeddings from new YouTube/Spotify links or IDs.</CardDescription>
                  </CardHeader>
                  <CardContent className="pt-6 flex flex-col gap-6">
                    
                    <div className="flex flex-col sm:flex-row gap-3">
                      <Input 
                        className="flex-1 shadow-sm"
                        placeholder="Paste YouTube ID, URL, Playlist, or Spotify URL here..." 
                        value={ytInput}
                        onChange={e => setYtInput(e.target.value)}
                      />
                      <Button onClick={handleExtract} disabled={!isReady || isExtracting || !ytInput.trim()} className="gap-2">
                        {isExtracting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
                        Extract Audio
                      </Button>
                    </div>

                    <div className="flex gap-2 justify-end border-t pt-4">
                      <Button variant="secondary" className="shadow-sm" onClick={() => addSelectedToGroup(selectedTempLibSongs, setTempGroup, tempGroup)} disabled={selectedTempLibSongs.length === 0}>
                        Add to Temp Group
                      </Button>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div className="border rounded-xl overflow-hidden bg-slate-50/50 dark:bg-slate-900/30 min-w-0">
                        <div className="flex justify-between items-center px-4 py-2 bg-slate-100 dark:bg-slate-800 border-b">
                          <span className="text-sm font-semibold text-slate-700 dark:text-slate-300">Temp Library</span>
                        </div>
                        <ScrollArea className="h-40">
                          <div className="p-1 flex flex-col gap-1">
                            {tempLibraryEntries.map(([id, name]) => {
                                const isSelected = selectedTempLibSongs.includes(id);
                                return (
                                <div 
                                  key={id} 
                                  className={`px-3 py-2 text-sm cursor-pointer rounded-lg flex items-center justify-between transition-colors min-w-0
                                    ${isSelected 
                                      ? 'bg-primary/10 text-primary border border-primary/20 shadow-sm font-medium' 
                                      : 'hover:bg-slate-100 dark:hover:bg-slate-800 border border-transparent'}`}
                                  onClick={() => toggleSelection(id, selectedTempLibSongs, setSelectedTempLibSongs)}
                                  onDoubleClick={() => setActiveVideoId(id)}
                                >
                                  <span className="truncate pr-4 flex-1 min-w-0" title={name}>{name}</span>
                                </div>
                              )
                            })}
                            {tempLibraryEntries.length === 0 && (
                                <div className="text-center text-sm text-muted-foreground p-4 opacity-60">
                                    No temp songs extracted yet.
                                </div>
                            )}
                          </div>
                        </ScrollArea>
                      </div>

                      <div className="border rounded-xl overflow-hidden bg-slate-50/50 dark:bg-slate-900/30 min-w-0">
                        <div className="flex justify-between items-center px-4 py-2 bg-slate-100 dark:bg-slate-800 border-b">
                          <span className="text-sm font-semibold text-slate-700 dark:text-slate-300">Temp Group</span>
                          {tempGroup.length > 0 && <Button variant="ghost" size="sm" className="h-6 px-2 text-xs text-muted-foreground hover:text-destructive" onClick={() => setTempGroup([])}>Clear</Button>}
                        </div>
                        <ScrollArea className="h-40">
                          <div className="p-1 flex flex-col gap-1">
                            {tempGroup.map(id => (
                              <div key={id} className="min-w-0 px-3 py-1.5 text-xs flex justify-between items-center group/item hover:bg-slate-200/50 dark:hover:bg-slate-800/50 rounded-md transition-colors border border-transparent hover:border-slate-200 dark:hover:border-slate-700">
                                  <span className="truncate flex-1 font-medium min-w-0 pr-2" title={tempLibrary[id] || id}>{tempLibrary[id] || id}</span>
                                  <button 
                                      className="shrink-0 text-muted-foreground hover:text-destructive hover:bg-destructive/10 p-1 rounded transition-colors opacity-0 group-hover/item:opacity-100 focus:opacity-100" 
                                      onClick={() => removeGroupSong(id, setTempGroup, tempGroup)}
                                      title="Remove"
                                    >
                                      <X className="w-3.5 h-3.5" />
                                    </button>
                               </div>
                            ))}
                             {tempGroup.length === 0 && (
                                <div className="text-center text-sm text-muted-foreground p-4 opacity-60">
                                    Select temp songs to query.
                                </div>
                            )}
                          </div>
                        </ScrollArea>
                      </div>
                    </div>

                    <div className="flex justify-end pt-2 border-t">
                      <Button onClick={() => handleSearchSong(true)} disabled={!isReady || tempGroup.length === 0} className="gap-2 shadow-md">
                        <Search className="w-4 h-4" />
                        Find Similar in Main Library
                      </Button>
                    </div>

                  </CardContent>
                </Card>
              </TabsContent>
            </div>
          </Tabs>
        </div>

        {/* Right Column: Player & Results */}
        <div className="w-full lg:w-[400px] xl:w-[450px] flex flex-col gap-6 shrink-0 min-w-0">
          
          <Card className={`overflow-hidden shadow-lg border transition-all duration-300 ${activeVideoId ? 'border-primary/50 shadow-primary/10' : 'border-dashed bg-slate-50/50 dark:bg-slate-900/50 shadow-sm'}`}>
            <CardHeader className="py-2.5 px-4 bg-slate-100/50 dark:bg-slate-900 border-b flex flex-row items-center justify-between">
              <CardTitle className="text-sm font-semibold flex items-center gap-2">
                <Play className="w-4 h-4 text-primary" />
                Player
              </CardTitle>
              {activeVideoId && (
                <Button variant="ghost" className="h-7 w-7 p-0 rounded-full hover:bg-slate-200 dark:hover:bg-slate-800" onClick={() => setActiveVideoId(null)}>
                  <X className="w-4 h-4" />
                </Button>
              )}
            </CardHeader>
            <CardContent className="p-0">
               {activeVideoId ? (
                <div className="aspect-video w-full bg-black relative">
                  <iframe 
                    width="100%" 
                    height="100%" 
                    src={`https://www.youtube.com/embed/${activeVideoId}?autoplay=1`} 
                    title="YouTube video player" 
                    frameBorder="0" 
                    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" 
                    allowFullScreen
                    className="absolute inset-0"
                  ></iframe>
                </div>
               ) : (
                <div className="aspect-video w-full flex items-center justify-center bg-slate-100/30 dark:bg-slate-900/30">
                  <div className="flex flex-col items-center gap-2 text-muted-foreground opacity-60">
                    <Music className="w-8 h-8" />
                    <p className="text-sm font-medium">No active video</p>
                    <p className="text-xs">Double click a song to play it</p>
                  </div>
                </div>
               )}
            </CardContent>
          </Card>

          <Card className="flex-1 min-h-[500px] flex flex-col shadow-md border">
            <CardHeader className="py-3 px-4 bg-slate-50 dark:bg-slate-900/50 border-b">
              <CardTitle className="text-base font-semibold flex items-center gap-2">
                <Info className="w-4 h-4 text-primary" />
                Similar Songs Results
              </CardTitle>
              <CardDescription className="text-xs">The top matches closest to your query.</CardDescription>
            </CardHeader>
            <CardContent className="flex-1 p-0 bg-background relative">
               <ScrollArea className="h-full absolute inset-0">
                  {results.length > 0 ? (
                    <div className="divide-y divide-slate-100 dark:divide-slate-800">
                      {results.map((res, i) => {
                        const isActive = activeVideoId === res.yt_id;
                        return (
                          <div 
                            key={`${res.yt_id}-${i}`} 
                            className={`p-4 text-sm cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-900 flex flex-col gap-1.5 transition-colors group/result
                              ${isActive ? 'border-l-4 border-l-primary bg-slate-50 dark:bg-slate-900' : 'border-l-4 border-l-transparent'}`}
                            onClick={() => setActiveVideoId(res.yt_id)}
                          >
                            <div className="flex justify-between items-start gap-4">
                              <span className={`flex-1 min-w-0 font-medium line-clamp-2 ${isActive ? 'text-primary' : 'text-foreground group-hover/result:text-primary transition-colors'}`}>
                                {res.display_name}
                              </span>
                              <div className="shrink-0 bg-slate-100 dark:bg-slate-800 text-slate-500 font-mono text-[10px] px-1.5 py-0.5 rounded border">
                                {(res.similarity * 100).toFixed(1)}%
                              </div>
                            </div>
                            <div className="w-full bg-slate-100 dark:bg-slate-800 rounded-full h-1 mt-1">
                               <div className="bg-primary h-1 rounded-full" style={{ width: `${Math.max(0, res.similarity * 100)}%` }} />
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  ) : (
                    <div className="flex flex-col items-center justify-center p-12 text-center text-muted-foreground opacity-60 h-full">
                       <Search className="w-8 h-8 mb-3" />
                       <p className="text-sm font-medium">No results to display.</p>
                       <p className="text-xs mt-1">Run a search to find similar songs across the embedded library.</p>
                    </div>
                  )}
               </ScrollArea>
            </CardContent>
          </Card>
        </div>

      </div>
    </div>
  )
}
