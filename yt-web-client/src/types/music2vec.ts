export type TabId = "library" | "song" | "text" | "upload"

export type LibraryStructure = Record<string, Record<string, string>>

export type SearchResult = {
  yt_id: string
  group: string
  display_name: string
  similarity: number
}

export type SongSearchPayload = {
  song_ids1: string[]
  song_ids2: string[]
  groups: string[]
  algo: string
}

export type UploadMode = "youtube" | "singleQuery" | "playlistQueries"

export type YTMusicCandidate = {
  yt_id: string
  title: string
  artist: string
  duration?: number
  url: string
}
