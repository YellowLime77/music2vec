import React from "react"
import { Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Progress } from "@/components/ui/progress"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { UploadMode, YTMusicCandidate } from "@/types/music2vec"

type UploadTabProps = {
  uploadMode: UploadMode
  setUploadMode: React.Dispatch<React.SetStateAction<UploadMode>>
  ytInput: string
  setYtInput: React.Dispatch<React.SetStateAction<string>>
  singleSongQuery: string
  setSingleSongQuery: React.Dispatch<React.SetStateAction<string>>
  singleSongCandidates: YTMusicCandidate[]
  selectedCandidateId: string
  setSelectedCandidateId: React.Dispatch<React.SetStateAction<string>>
  onSearchUploadCandidates: () => void
  isSearchingUploadCandidates: boolean
  playlistTextInput: string
  setPlaylistTextInput: React.Dispatch<React.SetStateAction<string>>
  playlistFileName: string
  onPlaylistFileSelected: (file: File | null) => void
  selectedGroupForUpload: string
  setSelectedGroupForUpload: React.Dispatch<React.SetStateAction<string>>
  newGroupName: string
  setNewGroupName: React.Dispatch<React.SetStateAction<string>>
  allGroups: string[]
  isExtracting: boolean
  extractProgress: number
  status: string
  isReady: boolean
  onExtract: () => void
}

export function UploadTab({
  uploadMode,
  setUploadMode,
  ytInput,
  setYtInput,
  singleSongQuery,
  setSingleSongQuery,
  singleSongCandidates,
  selectedCandidateId,
  setSelectedCandidateId,
  onSearchUploadCandidates,
  isSearchingUploadCandidates,
  playlistTextInput,
  setPlaylistTextInput,
  playlistFileName,
  onPlaylistFileSelected,
  selectedGroupForUpload,
  setSelectedGroupForUpload,
  newGroupName,
  setNewGroupName,
  allGroups,
  isExtracting,
  extractProgress,
  status,
  isReady,
  onExtract,
}: UploadTabProps) {
  const formatDuration = (duration?: number) => {
    if (!duration) return "--:--"
    const mins = Math.floor(duration / 60)
    const secs = duration % 60
    return `${mins}:${String(secs).padStart(2, "0")}`
  }

  const hasValidInput =
    (uploadMode === "youtube" && ytInput.trim().length > 0) ||
    (uploadMode === "singleQuery" && selectedCandidateId.length > 0) ||
    (uploadMode === "playlistQueries" && playlistTextInput.trim().length > 0)

  return (
    <div className="space-y-6 animate-in fade-in-50 duration-300 max-w-2xl">
      <div>
        <h2 className="text-2xl font-bold tracking-tight">Upload Music</h2>
        <p className="text-muted-foreground">Upload from YouTube links or resolve song queries via YouTube Music.</p>
      </div>

      <Card className="shadow-sm border-primary/10 bg-gradient-to-b from-primary/5 to-transparent">
        <CardContent className="p-8 space-y-6">
          <div className="space-y-3">
            <label className="text-sm font-semibold">Upload Source</label>
            <div className="grid sm:grid-cols-3 gap-2">
              <Button
                type="button"
                variant={uploadMode === "youtube" ? "default" : "outline"}
                onClick={() => setUploadMode("youtube")}
              >
                YouTube URL/ID
              </Button>
              <Button
                type="button"
                variant={uploadMode === "singleQuery" ? "default" : "outline"}
                onClick={() => setUploadMode("singleQuery")}
              >
                Single Song Query
              </Button>
              <Button
                type="button"
                variant={uploadMode === "playlistQueries" ? "default" : "outline"}
                onClick={() => setUploadMode("playlistQueries")}
              >
                Playlist Query List
              </Button>
            </div>
          </div>

          {uploadMode === "youtube" && (
            <div className="space-y-3">
              <label className="text-sm font-semibold">YouTube URL or ID</label>
              <Input
                className="bg-background h-12 text-base"
                placeholder="https://youtube.com/watch?v=..."
                value={ytInput}
                onChange={(e) => setYtInput(e.target.value)}
              />
              <p className="text-[11px] text-muted-foreground">Supports single videos or full playlists.</p>
            </div>
          )}

          {uploadMode === "singleQuery" && (
            <div className="space-y-3">
              <label className="text-sm font-semibold">Song + Artist Query (YouTube Music songs-only)</label>
              <div className="flex gap-2">
                <Input
                  className="bg-background h-12 text-base"
                  placeholder="e.g. Time - Pink Floyd"
                  value={singleSongQuery}
                  onChange={(e) => setSingleSongQuery(e.target.value)}
                />
                <Button
                  type="button"
                  variant="outline"
                  onClick={onSearchUploadCandidates}
                  disabled={isSearchingUploadCandidates || !singleSongQuery.trim()}
                >
                  {isSearchingUploadCandidates ? "Searching..." : "Search"}
                </Button>
              </div>

              {singleSongCandidates.length > 0 && (
                <div className="rounded-lg border bg-background max-h-64 overflow-y-auto">
                  {singleSongCandidates.map((candidate) => (
                    <label
                      key={candidate.yt_id}
                      className="flex items-start gap-3 p-3 border-b last:border-b-0 cursor-pointer hover:bg-muted/40"
                    >
                      <input
                        type="radio"
                        name="selected-yt-candidate"
                        checked={selectedCandidateId === candidate.yt_id}
                        onChange={() => setSelectedCandidateId(candidate.yt_id)}
                        className="mt-1"
                      />
                      <div className="min-w-0">
                        <div className="font-medium text-sm truncate">{candidate.title}</div>
                        <div className="text-xs text-muted-foreground truncate">{candidate.artist} • {formatDuration(candidate.duration)}</div>
                      </div>
                    </label>
                  ))}
                </div>
              )}
            </div>
          )}

          {uploadMode === "playlistQueries" && (
            <div className="space-y-3">
              <label className="text-sm font-semibold">Playlist Song Queries</label>
              <textarea
                className="w-full min-h-36 rounded-md border bg-background px-3 py-2 text-sm"
                placeholder={"One song per line, for example:\nDaft Punk - One More Time\nPorter Robinson - Language"}
                value={playlistTextInput}
                onChange={(e) => setPlaylistTextInput(e.target.value)}
              />
              <div className="flex flex-wrap items-center gap-3">
                <Input
                  type="file"
                  accept=".txt,text/plain"
                  className="max-w-xs bg-background"
                  onChange={(e) => onPlaylistFileSelected(e.target.files?.[0] || null)}
                />
                {playlistFileName && (
                  <span className="text-xs text-muted-foreground">Loaded: {playlistFileName}</span>
                )}
              </div>
              <p className="text-[11px] text-muted-foreground">For each line, the backend resolves and uploads the best YouTube Music song match.</p>
            </div>
          )}

          <div className="space-y-3 pt-2">
            <label className="text-sm font-semibold">Target Group</label>
            <div className="grid sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <span className="text-xs font-medium text-muted-foreground">Select Existing</span>
                <Select value={selectedGroupForUpload} onValueChange={setSelectedGroupForUpload}>
                  <SelectTrigger className="bg-background h-10">
                    <SelectValue placeholder="Choose group..." />
                  </SelectTrigger>
                  <SelectContent>
                    {allGroups.map((group) => (
                      <SelectItem key={group} value={group}>{group}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <span className="text-xs font-medium text-muted-foreground">Or Create New</span>
                <Input
                  className="bg-background h-10"
                  placeholder="New group name..."
                  value={newGroupName}
                  onChange={(e) => setNewGroupName(e.target.value)}
                />
              </div>
            </div>
          </div>

          <div className="pt-6 border-t border-primary/10">
            {isExtracting && (
              <div className="mb-6 space-y-2 p-4 rounded-lg bg-background shadow-inner">
                <div className="flex items-center justify-between text-sm">
                  <span className="font-medium text-primary flex items-center gap-2">
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Processing...
                  </span>
                  <span className="font-mono text-muted-foreground">{extractProgress}%</span>
                </div>
                <Progress value={extractProgress} className="h-2 bg-slate-100 dark:bg-slate-800" />
                <p className="text-xs text-muted-foreground truncate">{status}</p>
              </div>
            )}

            <Button
              onClick={onExtract}
              disabled={!isReady || isExtracting || !hasValidInput || !(newGroupName.trim() || selectedGroupForUpload)}
              size="lg"
              className="w-full font-semibold"
            >
              {isExtracting ? "Extracting..." : "Process and Upload"}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
