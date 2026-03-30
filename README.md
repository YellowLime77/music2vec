# music2vec

A software to find similar songs, and search songs by musical content

Uses muq-mulan to extract vector embeddings from songs and text.

Features:
* Find similar songs given one song, a group of songs, or 2 groups of songs (weighted 50/50)
  * For groups, can use either averaged vectors or multi-centroid (more effective for diverse tastes) 
* Search songs with text semantics rather than genre/titles (for example: "mid-tempo, instrumental, lo-fi, light percussion, rhythmic, non-intrusive, focus-oriented, acoustic guitar, soft piano, neutral mood, no lyrics" for songs suited for studying)

Use cases:
* Create a playlist for a certain mood requested
* Find songs recommendations based on existing playlist of songs
* Combine playlists together, find songs that are similar to both playlists