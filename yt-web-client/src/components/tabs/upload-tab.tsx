import React from "react"
import { Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Progress } from "@/components/ui/progress"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { UploadMode } from "@/types/music2vec"

type UploadTabProps = {
  uploadMode: UploadMode
  setUploadMode: React.Dispatch<React.SetStateAction<UploadMode>>
  urlInput: string
  setUrlInput: React.Dispatch<React.SetStateAction<string>>
  songQueriesInput: string
  setSongQueriesInput: React.Dispatch<React.SetStateAction<string>>
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
  urlInput,
  setUrlInput,
  songQueriesInput,
  setSongQueriesInput,
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
  const hasValidInput =
    (uploadMode === "url" && urlInput.trim().length > 0) ||
    (uploadMode === "songQueries" && songQueriesInput.trim().length > 0)

  return (
    <div className="space-y-6 animate-in fade-in-50 duration-300 max-w-2xl">
      <div>
        <h2 className="text-2xl font-bold tracking-tight">Upload Music</h2>
        <p className="text-muted-foreground">Upload by URL or by song name(s) using a single streamlined input per mode.</p>
      </div>

      <Card className="shadow-sm border-primary/10 bg-gradient-to-b from-primary/5 to-transparent">
        <CardContent className="p-8 space-y-6">
          <div className="space-y-3">
            <label className="text-sm font-semibold">Upload Source</label>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <Button
                type="button"
                variant={uploadMode === "url" ? "default" : "outline"}
                onClick={() => setUploadMode("url")}
              >
                By URL
              </Button>
              <Button
                type="button"
                variant={uploadMode === "songQueries" ? "default" : "outline"}
                onClick={() => setUploadMode("songQueries")}
              >
                By Song Name(s)
              </Button>
            </div>
          </div>

          {uploadMode === "url" && (
            <div className="space-y-3">
              <label className="text-sm font-semibold">YouTube or Spotify URL</label>
              <textarea
                className="w-full min-h-36 rounded-md border bg-background px-3 py-2 text-sm"
                placeholder={"Paste one URL per line, for example:\nhttps://youtube.com/watch?v=...\nhttps://open.spotify.com/playlist/..."}
                value={urlInput}
                onChange={(e) => setUrlInput(e.target.value)}
              />
              <p className="text-[11px] text-muted-foreground">Supports YouTube video/playlist URLs or IDs, and Spotify playlist/album/track URLs.</p>
            </div>
          )}

          {uploadMode === "songQueries" && (
            <div className="space-y-3">
              <label className="text-sm font-semibold">Song Name Query or Query List</label>
              <textarea
                className="w-full min-h-36 rounded-md border bg-background px-3 py-2 text-sm"
                placeholder={"One song per line, for example:\nDaft Punk - One More Time\nPorter Robinson - Language"}
                value={songQueriesInput}
                onChange={(e) => setSongQueriesInput(e.target.value)}
              />
              <p className="text-[11px] text-muted-foreground">Use one line for a single song, or multiple lines for a list. Each line is resolved via YouTube Music.</p>
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
