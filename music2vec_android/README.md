# music2vec_android

This is a standalone Kivy app that mirrors the core behavior of `app.py` and adds:

- Multi-select song picking
- Queue creation and playback
- Individual song playback
- Playlist save/load
- Sleep timer
- MuLan similarity search by song and text (when PyTorch + MuQ are available)

## Project layout

- `main.py`: Kivy application entry point
- `requirements.txt`: Python dependencies
- `buildozer.spec.example`: Starter Buildozer configuration

## How songs are discovered

The app uses one of these folders (first existing path wins):

1. `MUSIC2VEC_SONGS_DIR` env var
2. `../songs` relative to this folder
3. `./songs` inside this folder

Supported formats: `.wav`, `.mp3`, `.flac`, `.m4a`, `.ogg`.

## Run locally

```bash
python main.py
```

## Android build outline (Buildozer)

1. Install Buildozer and Android build prerequisites.
2. Copy `buildozer.spec.example` to `buildozer.spec`.
3. Update `requirements` and package metadata for your environment.
4. Run:

```bash
buildozer android debug
```

5. Install APK on device:

```bash
buildozer android deploy run
```

## Notes

- If `torch`, `librosa`, or `muq` are not available, playback/queue/playlist/timer still work, but similarity search is disabled.
- Embeddings are cached in the app user data folder under `embeddings_cache`.
- Playlists are saved to app user data under `data/playlists.json`.
