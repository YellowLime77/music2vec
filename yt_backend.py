from fastapi import FastAPI, BackgroundTasks, HTTPException, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field
import os
import traceback
from dotenv import load_dotenv

load_dotenv()
import json
import re
from urllib.parse import quote_plus
import torch
import torchaudio
import yt_dlp
import tempfile
import threading
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
import spotipy
from spotipy.oauth2 import SpotifyOAuth
from muq import MuQMuLan
from typing import List, Dict, Optional, Any
from fastapi.middleware.cors import CORSMiddleware

app = FastAPI(title="Music2Vec Backend")

DEFAULT_CORS_ORIGINS = [
    "http://localhost:3000",
    "http://127.0.0.1:3000",
    "https://music2vec.onrender.com",
]

cors_origins_env = os.getenv("CORS_ALLOWED_ORIGINS", "")
if cors_origins_env.strip():
    CORS_ALLOWED_ORIGINS = [origin.strip() for origin in cors_origins_env.split(",") if origin.strip()]
else:
    CORS_ALLOWED_ORIGINS = DEFAULT_CORS_ORIGINS

@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    print(f"Unhandled Error on {request.method} {request.url}: {exc}")
    traceback.print_exc()
    return JSONResponse(status_code=500, content={"detail": "Internal Server Error"})

@app.exception_handler(HTTPException)
async def http_exception_handler(request: Request, exc: HTTPException):
    print(f"HTTP Exception {exc.status_code} on {request.method} {request.url}: {exc.detail}")
    return JSONResponse(status_code=exc.status_code, content={"detail": exc.detail})

app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ALLOWED_ORIGINS,
    allow_origin_regex=r"https://.*\.ngrok-free\.dev",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
device = 'cuda' if torch.cuda.is_available() else 'cpu'
CACHE_DIR = 'yt_embeddings_cache'

# Optional yt-dlp auth env vars:
# - YTDLP_COOKIES_FILE: absolute/relative path to exported cookies.txt
# - YTDLP_COOKIES_FROM_BROWSER: e.g. chrome or chrome,Default
# - YTDLP_USER_AGENT: optional custom UA string
YTDLP_COOKIES_FILE = os.getenv("YTDLP_COOKIES_FILE", "").strip()
YTDLP_COOKIES_FROM_BROWSER = os.getenv("YTDLP_COOKIES_FROM_BROWSER", "").strip()
YTDLP_USER_AGENT = os.getenv("YTDLP_USER_AGENT", "").strip()
PLAYLIST_ITEM_DELAY_MS = max(0, int(os.getenv("PLAYLIST_ITEM_DELAY_MS", "500")))

PERMANENT_YTDLP_ERROR_HINTS = [
    "this video is not available",
    "private video",
    "members-only",
    "video unavailable",
    "has been removed",
]

# Lightweight resolver cache to avoid repeated remote lookups for common queries.
query_resolution_cache: Dict[str, List[Dict[str, Any]]] = {}
query_resolution_lock = threading.Lock()
video_metadata_cache: Dict[str, Dict[str, Any]] = {}
video_metadata_lock = threading.Lock()

def with_yt_dlp_auth(base_opts: Dict[str, Any]) -> Dict[str, Any]:
    opts = dict(base_opts)

    if YTDLP_COOKIES_FILE and os.path.exists(YTDLP_COOKIES_FILE):
        opts['cookiefile'] = YTDLP_COOKIES_FILE
    elif YTDLP_COOKIES_FROM_BROWSER:
        browser_parts = [p.strip() for p in YTDLP_COOKIES_FROM_BROWSER.split(',') if p.strip()]
        if browser_parts:
            opts['cookiesfrombrowser'] = tuple(browser_parts)

    if YTDLP_USER_AGENT:
        opts['http_headers'] = {
            **opts.get('http_headers', {}),
            'User-Agent': YTDLP_USER_AGENT,
        }

    return opts

def yt_dlp_extract_info(url: str, base_opts: Dict[str, Any], download: bool):
    """Run yt-dlp with auth fallbacks to reduce YouTube bot-check failures."""
    attempts: List[Dict[str, Any]] = []

    # 1) Primary configuration (env-driven auth + headers).
    attempts.append(with_yt_dlp_auth(base_opts))

    # 2) If no explicit auth configured, try common browsers automatically.
    if not YTDLP_COOKIES_FILE and not YTDLP_COOKIES_FROM_BROWSER:
        for browser in ("chrome", "edge", "firefox"):
            alt = dict(base_opts)
            alt['cookiesfrombrowser'] = (browser,)
            if YTDLP_USER_AGENT:
                alt['http_headers'] = {
                    **alt.get('http_headers', {}),
                    'User-Agent': YTDLP_USER_AGENT,
                }
            attempts.append(alt)

    last_error: Optional[Exception] = None
    for opts in attempts:
        try:
            with yt_dlp.YoutubeDL(opts) as ydl:
                return ydl.extract_info(url, download=download)
        except Exception as e:
            last_error = e
            err_text = str(e).lower()
            if any(hint in err_text for hint in PERMANENT_YTDLP_ERROR_HINTS):
                # Stop retry loops for permanent failures; fallback attempts won't help.
                raise e

    if last_error:
        raise last_error
    raise RuntimeError("yt-dlp failed without a captured exception")

# Global state
mulan = None
spotify_client = None
spotify_lock = threading.Lock()
audio_embeddings = {}  # {group_name: {yt_id: embed}}
song_metadata = {}  # {group_name: {yt_id: display_name}}
is_ready = False
load_progress = 0
load_status = "Not started"
model_lock = threading.Lock()

# Extraction progress state
extract_state = {
    "is_extracting": False,
    "status": "Idle",
    "progress": 0,
    "current": 0,
    "total": 0
}
extract_lock = threading.Lock()

@app.get("/extract_status")
def get_extract_status():
    return extract_state

def update_extract_state(status=None, current=None, total=None, is_extracting=None):
    with extract_lock:
        if is_extracting is not None:
            extract_state["is_extracting"] = is_extracting
        if status is not None:
            extract_state["status"] = status
        if total is not None:
            extract_state["total"] = total
        if current is not None:
            extract_state["current"] = current
            if extract_state["total"] > 0:
                extract_state["progress"] = int((extract_state["current"] / extract_state["total"]) * 100)
            else:
                extract_state["progress"] = 0

def load_data():
    global mulan, audio_embeddings, song_metadata, is_ready, load_progress, load_status
    try:
        load_status = "Loading MuLan model..."
        load_progress = 0
        local_mulan = MuQMuLan.from_pretrained("OpenMuQ/MuQ-MuLan-large")
        mulan = local_mulan.to(device).eval()
        
        os.makedirs(CACHE_DIR, exist_ok=True)
        pt_files = [f for f in os.listdir(CACHE_DIR) if f.endswith('.pt')]
        total_files = len(pt_files)
        
        if total_files == 0:
            load_progress = 100
            load_status = "Ready (No embeddings cached)"
            is_ready = True
            return
            
        load_status = "Loading cached embeddings..."
        for i, pt_file in enumerate(pt_files):
            cache_path = os.path.join(CACHE_DIR, pt_file)
            yt_id = pt_file[:-3]
            
            display_name = yt_id
            groups = ["default"]
            meta_path = os.path.join(CACHE_DIR, f"{yt_id}.json")
            if os.path.exists(meta_path):
                try:
                    with open(meta_path, 'r', encoding='utf-8') as f:
                        meta = json.load(f)
                        display_name = f"{meta.get('artist', 'Unknown')} - {meta.get('title', 'Unknown')}"
                        groups = meta.get('groups', [meta.get('group', 'default')])
                except Exception:
                    pass
            
            try:
                embed = torch.load(cache_path, map_location=device, weights_only=True)
                for g in groups:
                    if g not in audio_embeddings:
                        audio_embeddings[g] = {}
                    if g not in song_metadata:
                        song_metadata[g] = {}
                    audio_embeddings[g][yt_id] = embed
                    song_metadata[g][yt_id] = display_name
            except Exception as e:
                print(f"Error loading {pt_file}: {e}")
                
            load_progress = int(((i+1) / total_files) * 100)
            
        load_status = "Ready!"
        is_ready = True
    except Exception as e:
        load_status = f"Error during load: {str(e)}"
        print(load_status)

@app.on_event("startup")
async def startup_event():
    # Load model and cache in a background thread to avoid blocking server start
    threading.Thread(target=load_data, daemon=True).start()

@app.get("/status")
def get_status():
    total_embeddings = sum(len(group) for group in audio_embeddings.values())
    return {
        "ready": is_ready,
        "progress": load_progress,
        "status": load_status,
        "library_size": total_embeddings
    }

@app.get("/library")
def get_library():
    return {"library": song_metadata}

def combine_embeddings(embeds, algo: str):
    if not embeds:
        return None
    stacked = torch.stack([embed.squeeze(0).to(device) for embed in embeds], dim=0)
    
    if algo == "Average Vector":
        return stacked.mean(dim=0, keepdim=True)
    
    # Multi-Centroid
    num_clusters = min(3, len(stacked))
    if num_clusters <= 1:
        return stacked

    indices = torch.randperm(len(stacked), device=device)[:num_clusters]
    centroids = stacked[indices]
    
    for _ in range(20):
        dists = torch.cdist(stacked, centroids)
        labels = torch.argmin(dists, dim=1)
        
        new_centroids = []
        for i in range(num_clusters):
            cluster_points = stacked[labels == i]
            if len(cluster_points) > 0:
                new_centroids.append(cluster_points.mean(dim=0))
            else:
                new_centroids.append(centroids[i])
        centroids = torch.stack(new_centroids)
    return centroids

def calc_similarities(target_embed, exclude_set, embeddings_dict, metadata_dict, groups=None):
    results = []
    seen = set(exclude_set)
    if groups is None or len(groups) == 0:
        groups = list(embeddings_dict.keys())
    for group in groups:
        if group not in embeddings_dict:
            continue
        for song_id, embed in embeddings_dict[group].items():
            if song_id in seen:
                continue
            seen.add(song_id)
            embed = embed.to(device)
            if target_embed.size(0) > 1:
                sims = [torch.nn.functional.cosine_similarity(c.unsqueeze(0), embed, dim=-1).item() for c in target_embed]
                sim = max(sims)
            else:
                sim = torch.nn.functional.cosine_similarity(target_embed, embed, dim=-1).item()
                
            results.append({
                "yt_id": song_id,
                "group": group,
                "display_name": metadata_dict.get(group, {}).get(song_id, song_id),
                "similarity": sim
            })
    results.sort(key=lambda x: x["similarity"], reverse=True)
    return results

class SearchSongReq(BaseModel):
    song_ids1: List[str]
    song_ids2: List[str] = Field(default_factory=list)
    groups: List[str] = Field(default_factory=list)
    algo: str = "Multi-Centroid"
    randomness: float = Field(default=0.0, ge=0.0, le=1.0)
    skew: float = Field(default=1.0, ge=0.25, le=3.0)

@app.post("/search/song")
def search_song(req: SearchSongReq):
    if not is_ready:
        raise HTTPException(status_code=503, detail="Backend not ready yet")

    search_groups = req.groups if req.groups else list(audio_embeddings.keys())

    def find_valid_song_ids(song_ids: List[str], groups: List[str]) -> List[str]:
        seen = set()
        valid: List[str] = []
        for sid in song_ids:
            if sid in seen:
                continue
            for group in groups:
                if group in audio_embeddings and sid in audio_embeddings[group]:
                    valid.append(sid)
                    seen.add(sid)
                    break
        return valid

    valid_songs_1 = find_valid_song_ids(req.song_ids1, search_groups)
    valid_songs_2 = find_valid_song_ids(req.song_ids2, search_groups)

    # Recovery path: selected seeds may belong to groups that are not currently checked.
    # Keep result filtering on `search_groups`, but resolve seed embeddings from all groups.
    lookup_groups = search_groups
    if not valid_songs_1 and not valid_songs_2:
        all_groups = list(audio_embeddings.keys())
        valid_songs_1 = find_valid_song_ids(req.song_ids1, all_groups)
        valid_songs_2 = find_valid_song_ids(req.song_ids2, all_groups)
        lookup_groups = all_groups

    if not valid_songs_1 and not valid_songs_2:
        raise HTTPException(status_code=400, detail="No valid songs found in library")

    embeds_to_search = []
    for song_id in valid_songs_1 + valid_songs_2:
        for group in lookup_groups:
            if group in audio_embeddings and song_id in audio_embeddings[group]:
                embeds_to_search.append(audio_embeddings[group][song_id])
                break
    
    embeds1 = embeds_to_search[:len(valid_songs_1)] if valid_songs_1 else []
    embeds2 = embeds_to_search[len(valid_songs_1):] if valid_songs_2 else []
    
    target_embed_1 = combine_embeddings(embeds1, req.algo) if embeds1 else None
    target_embed_2 = combine_embeddings(embeds2, req.algo) if embeds2 else None
    
    exclude_songs = set(valid_songs_1 + valid_songs_2)
    
    results = []
    for group in search_groups:
        if group not in audio_embeddings:
            continue
        for song_id, embed in audio_embeddings[group].items():
            if song_id in exclude_songs:
                continue
            exclude_songs.add(song_id)
                
            embed = embed.to(device)
            def sim(tgt):
                if tgt is None: return 0
                if tgt.size(0) > 1:
                    return max([torch.nn.functional.cosine_similarity(c.unsqueeze(0), embed, dim=-1).item() for c in tgt])
                return torch.nn.functional.cosine_similarity(tgt, embed, dim=-1).item()
                
            s1 = sim(target_embed_1)
            s2 = sim(target_embed_2)
            
            sim_val = 0
            if target_embed_1 is not None and target_embed_2 is not None:
                sim_val = 0.5 * s1 + 0.5 * s2
            elif target_embed_1 is not None:
                sim_val = s1
            else:
                sim_val = s2
                
            results.append({
                "yt_id": song_id,
                "group": group,
                "display_name": song_metadata.get(group, {}).get(song_id, song_id),
                "similarity": sim_val
            })
        
    randomness = max(0.0, min(1.0, req.randomness))
    skew = max(0.25, min(3.0, req.skew))

    # Defaults preserve old behavior; optional controls allow broader or noisier ranking.
    if randomness == 0.0 and abs(skew - 1.0) < 1e-9:
        results.sort(key=lambda x: x["similarity"], reverse=True)
    else:
        for item in results:
            base = (item["similarity"] + 1.0) / 2.0
            base = max(0.0, min(1.0, base))
            skewed = base ** skew
            random_component = torch.rand(1).item()
            item["_rank_score"] = (1.0 - randomness) * skewed + randomness * random_component

        results.sort(key=lambda x: x.get("_rank_score", 0.0), reverse=True)
        for item in results:
            item.pop("_rank_score", None)

    return {"results": results[:100]}

class SearchTextReq(BaseModel):
    text: str
    groups: List[str] = Field(default_factory=list)

class EmbeddingVisualizationReq(BaseModel):
    groups: List[str] = Field(default_factory=list)

class EmbeddingTextVisualizationReq(BaseModel):
    text: str
    groups: List[str] = Field(default_factory=list)

MAX_VIZ_POINTS_PER_GROUP = 5000

def _collect_visualization_rows(groups: List[str]):
    rows: List[torch.Tensor] = []
    rows_meta: List[Dict[str, str]] = []

    for group in groups:
        group_embeddings = audio_embeddings.get(group, {})
        group_items = list(group_embeddings.items())
        if len(group_items) > MAX_VIZ_POINTS_PER_GROUP:
            group_items = group_items[:MAX_VIZ_POINTS_PER_GROUP]

        for yt_id, embed in group_items:
            vector = embed.squeeze(0).detach().to("cpu", dtype=torch.float32)
            if vector.ndim != 1:
                continue
            rows.append(vector)
            rows_meta.append({
                "yt_id": yt_id,
                "group": group,
                "display_name": song_metadata.get(group, {}).get(yt_id, yt_id),
            })

    return rows, rows_meta

def _project_visualization_rows(groups: List[str]):
    rows, rows_meta = _collect_visualization_rows(groups)
    if not rows:
        return [], None

    # Guard against malformed rows with mismatched embedding dimensions.
    target_dim = rows[0].shape[0]
    valid_rows: List[torch.Tensor] = []
    valid_meta: List[Dict[str, str]] = []
    for i, row in enumerate(rows):
        if row.shape[0] == target_dim:
            valid_rows.append(row)
            valid_meta.append(rows_meta[i])

    if not valid_rows:
        return [], None

    matrix = torch.stack(valid_rows, dim=0)
    center = matrix.mean(dim=0, keepdim=True)
    components: Optional[torch.Tensor] = None
    q = 0

    if matrix.size(0) == 1:
        coords = torch.zeros((1, 2), dtype=torch.float32)
    else:
        centered = matrix - center
        q = min(2, centered.size(0), centered.size(1))
        if q <= 0:
            coords = torch.zeros((centered.size(0), 2), dtype=torch.float32)
        else:
            try:
                _, _, v = torch.pca_lowrank(centered, q=q)
                components = v[:, :q]
                projected = centered @ components
                if q == 1:
                    zeros = torch.zeros((projected.size(0), 1), dtype=projected.dtype)
                    coords = torch.cat([projected, zeros], dim=1)
                else:
                    coords = projected
            except Exception:
                coords = torch.zeros((centered.size(0), 2), dtype=torch.float32)

    min_xy = coords.min(dim=0).values
    max_xy = coords.max(dim=0).values
    span = (max_xy - min_xy).clamp_min(1e-6)
    norm = (coords - min_xy) / span
    scaled = norm * 2 - 1

    points = []
    for i, meta in enumerate(valid_meta):
        points.append({
            "yt_id": meta["yt_id"],
            "group": meta["group"],
            "display_name": meta["display_name"],
            "x": float(scaled[i, 0].item()),
            "y": float(scaled[i, 1].item()),
        })

    projection_ctx = {
        "target_dim": target_dim,
        "center": center,
        "components": components,
        "q": q,
        "min_xy": min_xy,
        "span": span,
    }
    return points, projection_ctx

@app.post("/visualization/embeddings")
def get_embedding_visualization(req: EmbeddingVisualizationReq):
    if not is_ready:
        raise HTTPException(status_code=503, detail="Backend not ready yet")

    groups = req.groups if req.groups else list(audio_embeddings.keys())
    points, _ = _project_visualization_rows(groups)
    return {"points": points}

@app.post("/visualization/text")
def get_text_embedding_visualization(req: EmbeddingTextVisualizationReq):
    if not is_ready:
        raise HTTPException(status_code=503, detail="Backend not ready yet")

    text = req.text.strip()
    if not text:
        raise HTTPException(status_code=400, detail="Empty text")

    groups = req.groups if req.groups else list(audio_embeddings.keys())
    points, projection_ctx = _project_visualization_rows(groups)
    if not projection_ctx:
        return {"point": None, "nearest": []}

    with torch.no_grad():
        with model_lock:
            text_embed = mulan(texts=[text]).to(device)

    vector = text_embed.squeeze(0).detach().to("cpu", dtype=torch.float32)
    if vector.ndim != 1:
        raise HTTPException(status_code=500, detail="Text embedding shape is invalid")
    if vector.shape[0] != projection_ctx["target_dim"]:
        raise HTTPException(status_code=500, detail="Embedding dimension mismatch")

    centered = vector.unsqueeze(0) - projection_ctx["center"]
    components = projection_ctx["components"]
    q = projection_ctx["q"]

    if components is not None and q > 0:
        projected = centered @ components
        if q == 1:
            zeros = torch.zeros((1, 1), dtype=projected.dtype)
            coords = torch.cat([projected, zeros], dim=1)
        else:
            coords = projected
    else:
        coords = torch.zeros((1, 2), dtype=torch.float32)

    norm = (coords - projection_ctx["min_xy"]) / projection_ctx["span"]
    scaled = norm * 2 - 1
    text_x = float(scaled[0, 0].item())
    text_y = float(scaled[0, 1].item())

    nearest = sorted(
        points,
        key=lambda p: (p["x"] - text_x) ** 2 + (p["y"] - text_y) ** 2
    )[:10]

    return {
        "point": {
            "text": text,
            "x": text_x,
            "y": text_y,
        },
        "nearest": nearest,
    }

@app.post("/search/text")
def search_text(req: SearchTextReq):
    if not is_ready:
        raise HTTPException(status_code=503, detail="Backend not ready yet")
        
    if not req.text.strip():
        raise HTTPException(status_code=400, detail="Empty text")
        
    with torch.no_grad():
        with model_lock:
            text_embed = mulan(texts=[req.text.strip()]).to(device)
            
    results = calc_similarities(text_embed, set(), audio_embeddings, song_metadata, groups=req.groups)
    return {"results": results[:100]}

def is_youtube_reference(input_text: str) -> bool:
    if not input_text:
        return False
    if "youtube.com" in input_text or "youtu.be" in input_text or "list=" in input_text:
        return True
    # Common plain YouTube video ID format.
    return bool(re.fullmatch(r"[A-Za-z0-9_-]{11}", input_text.strip()))

def get_yt_video_metadata(yt_id: str) -> Optional[Dict[str, Any]]:
    with video_metadata_lock:
        cached = video_metadata_cache.get(yt_id)
    if cached is not None:
        return cached

    probe_opts = {
        'quiet': True,
        'no_warnings': True,
        'ignoreerrors': True,
        'skip_download': True,
    }

    try:
        info = yt_dlp_extract_info(f"https://www.youtube.com/watch?v={yt_id}", probe_opts, download=False)
        if not info or not info.get('id'):
            return None

        metadata = {
            'yt_id': yt_id,
            'title': info.get('title') or 'Unknown Title',
            'artist': info.get('uploader') or info.get('channel') or info.get('artist') or info.get('creator') or 'Unknown Artist',
            'duration': info.get('duration'),
            'url': f"https://www.youtube.com/watch?v={yt_id}",
        }
        with video_metadata_lock:
            video_metadata_cache[yt_id] = metadata
        return metadata
    except Exception:
        return None

def search_ytmusic_song_candidates(query: str, limit: int = 5, hydrate_metadata: bool = False):
    if not query.strip():
        return []

    cache_key = f"{query.strip().lower()}::{limit}::{int(hydrate_metadata)}"
    with query_resolution_lock:
        cached = query_resolution_cache.get(cache_key)
    if cached is not None:
        return cached

    search_url = f"https://music.youtube.com/search?q={quote_plus(query)}#songs"

    ydl_opts = {
        'extract_flat': True,
        'quiet': True,
        'no_warnings': True,
        'ignoreerrors': True,
        'skip_download': True,
        'playlistend': max(10, limit * 3),
        'extractor_args': {
            'youtube': {
                'music_search': ['songs']
            }
        },
        'cookiefile': 'cookies.txt'
    }

    try:
        info = yt_dlp_extract_info(search_url, ydl_opts, download=False)
    except Exception:
        fallback_opts = {
            'extract_flat': True,
            'quiet': True,
            'no_warnings': True,
            'ignoreerrors': True,
            'skip_download': True,
        }
        info = yt_dlp_extract_info(search_url, fallback_opts, download=False)

    entries = info.get('entries', []) if info else []

    # If YT Music search yields no entries, fallback to plain YouTube search.
    if not entries:
        try:
            generic = yt_dlp_extract_info(
                f"ytsearch{max(5, limit * 3)}:{query}",
                {
                    'extract_flat': True,
                    'quiet': True,
                    'no_warnings': True,
                    'ignoreerrors': True,
                    'skip_download': True,
                },
                download=False,
            )
            entries = generic.get('entries', []) if generic else []
        except Exception:
            entries = []

    candidates = []
    for entry in entries:
        if not entry:
            continue

        yt_id = entry.get('id')
        if not yt_id:
            continue

        title = entry.get('title') or 'Unknown Title'
        artist = entry.get('uploader') or entry.get('channel') or entry.get('artist') or 'Unknown Artist'
        duration = entry.get('duration')

        haystack = f"{title} {artist}".lower()
        if any(token in haystack for token in ['playlist', 'full album', 'album stream', ' dj mix ', 'hour mix']):
            continue
        if duration and duration > 15 * 60:
            continue

        candidates.append({
            'yt_id': yt_id,
            'title': title,
            'artist': artist,
            'duration': duration,
            'url': f"https://www.youtube.com/watch?v={yt_id}"
        })

    limited = candidates[:max(1, limit)]

    if hydrate_metadata and limited:
        hydrated_by_id: Dict[str, Dict[str, Any]] = {}
        workers = min(4, len(limited))
        with ThreadPoolExecutor(max_workers=workers) as executor:
            future_map = {
                executor.submit(get_yt_video_metadata, c['yt_id']): c['yt_id']
                for c in limited
            }
            for future in as_completed(future_map):
                yt_id = future_map[future]
                try:
                    enriched = future.result()
                    if enriched:
                        hydrated_by_id[yt_id] = enriched
                except Exception:
                    pass

        rebuilt = []
        for c in limited:
            enriched = hydrated_by_id.get(c['yt_id'])
            if not enriched:
                rebuilt.append(c)
                continue
            rebuilt.append({
                'yt_id': c['yt_id'],
                'title': enriched.get('title') or c.get('title') or 'Unknown Title',
                'artist': enriched.get('artist') or c.get('artist') or 'Unknown Artist',
                'duration': enriched.get('duration', c.get('duration')),
                'url': enriched.get('url') or c.get('url') or f"https://www.youtube.com/watch?v={c['yt_id']}",
            })
        limited = rebuilt

    with query_resolution_lock:
        query_resolution_cache[cache_key] = limited
    return limited

def resolve_query_to_yt_id(query: str, candidate_limit: int = 3) -> Optional[str]:
    search_url = f"https://music.youtube.com/search?q={quote_plus(query)}#songs"
    ydl_opts = {
        'extract_flat': True,
        'quiet': True,
        'no_warnings': True,
        'ignoreerrors': True,
        'skip_download': True,
        'playlistend': 10,
        'extractor_args': {
            'youtube': {
                'music_search': ['songs']
            }
        }
    }
    
    try:
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            info = ydl.extract_info(search_url, download=False)
            entries = info.get('entries', []) if info else []
            
            if not entries:
                generic_opts = dict(ydl_opts)
                del generic_opts['extractor_args']
                info = ydl.extract_info(f"ytsearch5:{query}", generic_opts, download=False)
                entries = info.get('entries', []) if info else []
            
            for entry in entries:
                if not entry or not entry.get('id'):
                    continue
                
                title = entry.get('title', '').lower()
                artist = (entry.get('uploader') or entry.get('channel') or entry.get('artist') or '').lower()
                duration = entry.get('duration')
                
                haystack = f"{title} {artist}"
                if any(token in haystack for token in ['playlist', 'full album', 'album stream', ' dj mix ', 'hour mix']):
                    continue
                if duration and duration > 15 * 60:
                    continue
                    
                return entry['id']
    except Exception as e:
        print(f"Error resolving {query}: {e}")
    return None

class SearchYTMusicReq(BaseModel):
    query: str
    limit: int = 5

@app.post("/ytmusic/search")
def search_ytmusic(req: SearchYTMusicReq):
    query = req.query.strip()
    if not query:
        raise HTTPException(status_code=400, detail="Empty query")

    safe_limit = max(1, min(req.limit, 5))
    try:
        return {"results": search_ytmusic_song_candidates(query, safe_limit)}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"YouTube Music search failed: {str(e)}")

class UploadReq(BaseModel):
    query: str = ""
    group: str = "default"
    selected_yt_id: Optional[str] = None
    playlist_queries: List[str] = Field(default_factory=list)

@app.post("/extract")
def extract_embedding(req: UploadReq):
    if not is_ready:
        raise HTTPException(status_code=503, detail="Backend not ready yet")
        
    input_text = req.query.strip() if req.query else ""
    selected_yt_id = req.selected_yt_id.strip() if req.selected_yt_id else ""
    playlist_queries = [q.strip() for q in (req.playlist_queries or []) if q and q.strip()]

    if not input_text and not selected_yt_id and not playlist_queries:
        raise HTTPException(status_code=400, detail="Empty query")
    
    group = req.group.strip()
    if not group:
        group = "default"
        
    extracted_songs = []
    processed_count = 0
    
    if group not in audio_embeddings:
        audio_embeddings[group] = {}
    if group not in song_metadata:
        song_metadata[group] = {}
    
    update_extract_state(is_extracting=True, status="Starting...", current=0, total=1)
    
    # Check if Spotify URL
    if "open.spotify.com" in input_text:
        global spotify_client
        try:
            update_extract_state(status="Fetching Spotify playlist data...")
            with spotify_lock:
                if spotify_client is None:
                    # Using SPOTIPY_ values as they are set in .env
                    client_id = os.getenv('SPOTIPY_CLIENT_ID')
                    client_secret = os.getenv('SPOTIPY_CLIENT_SECRET')
                    if not client_id or not client_secret:
                        update_extract_state(is_extracting=False, status="Spotify credentials missing")
                        raise HTTPException(status_code=500, detail="SPOTIPY_CLIENT_ID and SPOTIPY_CLIENT_SECRET environment variables must be set.")
                        
                    spotify_client = spotipy.Spotify(auth_manager=SpotifyOAuth(
                        redirect_uri="http://127.0.0.1:9900",
                        scope="playlist-read-private"
                    ))
                
                parts = input_text.split('/')
                spotify_queries = []
                if 'playlist' in parts:
                    playlist_id = parts[parts.index('playlist') + 1].split('?')[0]
                    results = spotify_client.playlist_items(playlist_id)
                    tracks = results['items']
                    while results['next']:
                        results = spotify_client.next(results)
                        tracks.extend(results['items'])
                    
                    for playlist_item in tracks:
                        track = playlist_item.get('track') or playlist_item.get('item')
                        if track:
                            artist = track['artists'][0]['name'] if track.get('artists') else ""
                            name = track.get('name', '')
                            if name:
                                spotify_queries.append(f"{name} {artist}".strip())
                elif 'track' in parts:
                    track_id = parts[parts.index('track') + 1].split('?')[0]
                    track = spotify_client.track(track_id)
                    artist = track['artists'][0]['name'] if track['artists'] else ""
                    name = track['name']
                    spotify_queries.append(f"{name} {artist}".strip())
                elif 'album' in parts:
                    album_id = parts[parts.index('album') + 1].split('?')[0]
                    results = spotify_client.album_tracks(album_id)
                    tracks = results['items']
                    while results['next']:
                        results = spotify_client.next(results)
                        tracks.extend(results['items'])
                    
                    for track in tracks:
                        artist = track['artists'][0]['name'] if track['artists'] else ""
                        name = track['name']
                        spotify_queries.append(f"{name} {artist}".strip())
                else:
                    raise ValueError("Unsupported Spotify URL format. Must be playlist, track, or album.")
                
                if not spotify_queries:
                    update_extract_state(is_extracting=False, status="No songs matched from Spotify")
                    raise HTTPException(status_code=400, detail="No songs matched from Spotify URL")
                
                playlist_queries.extend(spotify_queries)
                
            input_text = ""
            update_extract_state(status=f"Found {len(spotify_queries)} songs from Spotify. Resolving...", current=0, total=len(playlist_queries))
                
        except HTTPException:
            raise
        except Exception as e:
            import traceback
            traceback.print_exc()
            update_extract_state(is_extracting=False, status=f"Error: {e}")
            raise HTTPException(status_code=500, detail=str(e))

    yt_ids = []
    if selected_yt_id:
        yt_ids = [selected_yt_id]
        update_extract_state(status="Selected song confirmed. Starting extraction...", current=0, total=1)
    elif playlist_queries:
        update_extract_state(status="Resolving and processing playlist songs...", current=0, total=len(playlist_queries))
    else:
        # --- YouTube URL/ID or search query logic ---
        ydl_opts_extract = {
            'extract_flat': True,
            'quiet': True,
            'ignoreerrors': True,
            'retries': 2,
            'sleep_interval': 5,
            'max_sleep_interval': 20,
            'sleep_requests': 1,
            'cookiefile': 'cookies.txt'
        }

        if not is_youtube_reference(input_text):
            try:
                update_extract_state(status="Searching YouTube Music songs...")
                resolved = resolve_query_to_yt_id(input_text, candidate_limit=5)
                if not resolved:
                    update_extract_state(is_extracting=False, status="No song match found for query")
                    raise HTTPException(status_code=404, detail="No song match found for query")
                yt_ids = [resolved]
                update_extract_state(status="Best match selected. Starting extraction...", current=0, total=1)
            except HTTPException:
                raise
            except Exception as e:
                update_extract_state(is_extracting=False, status="Failed to search YouTube Music")
                raise HTTPException(status_code=500, detail=f"Failed to search YouTube Music: {str(e)}")
        else:
            if 'list=' in input_text:
                search_url = input_text
                try:
                    update_extract_state(status="Fetching YouTube metadata...")
                    info = yt_dlp_extract_info(search_url, ydl_opts_extract, download=False)
                    if info and 'entries' in info:
                        yt_ids = [entry['id'] for entry in info['entries'] if entry]
                    elif info:
                        yt_ids = [info['id']]
                    update_extract_state(total=len(yt_ids), current=0, status=f"Found {len(yt_ids)} videos, starting download...")
                except Exception as e:
                    update_extract_state(is_extracting=False, status="Failed to extract IDs")
                    raise HTTPException(status_code=500, detail=f"Failed to extract IDs: {str(e)}")
            else:
                if 'v=' in input_text:
                    yt_id = input_text.split('v=')[1].split('&')[0]
                elif 'youtu.be/' in input_text:
                    yt_id = input_text.split('youtu.be/')[1].split('?')[0]
                else:
                    yt_id = input_text.strip()
                yt_ids = [yt_id]
                update_extract_state(total=len(yt_ids), current=0, status=f"Starting download...")

    def process_yt_id(yt_id):
        if yt_id in audio_embeddings.get(group, {}):
            return {
                "yt_id": yt_id,
                "display_name": song_metadata.get(group, {}).get(yt_id, yt_id),
                "embed": audio_embeddings[group][yt_id]
            }

        cache_path = os.path.join(CACHE_DIR, f"{yt_id}.pt")
        meta_path = os.path.join(CACHE_DIR, f"{yt_id}.json")
        
        if os.path.exists(cache_path) and os.path.exists(meta_path):
            try:
                with open(meta_path, 'r', encoding='utf-8') as f:
                    metadata = json.load(f)
                
                if 'groups' not in metadata:
                    metadata['groups'] = [metadata.get('group', 'default')]
                    if 'group' in metadata:
                        del metadata['group']
                
                if group not in metadata['groups']:
                    metadata['groups'].append(group)
                    
                with open(meta_path, 'w', encoding='utf-8') as f:
                    json.dump(metadata, f, ensure_ascii=False)
                    
                display_name = f"{metadata.get('artist', 'Unknown')} - {metadata.get('title', 'Unknown')}"
                embed = torch.load(cache_path, map_location=device, weights_only=True)
                
                return {
                    "yt_id": yt_id,
                    "display_name": display_name,
                    "embed": embed
                }
            except Exception as e:
                print(f"Failed to load existing cache for {yt_id}, re-extracting: {e}")
            
        temp_dir = tempfile.mkdtemp()
        audio_path = os.path.join(temp_dir, f"{yt_id}.mp3")
        base_ydl_opts = {
            'postprocessors': [{
                'key': 'FFmpegExtractAudio',
                'preferredcodec': 'mp3',
                'preferredquality': '128',
            }],
            'outtmpl': os.path.join(temp_dir, '%(id)s.%(ext)s'),
            'quiet': True,
            'no_warnings': True,
            'postprocessor_args': [
                '-ar', '24000', '-ac', '1'
            ],
            'noplaylist': True,
            'ratelimit': 5000000,
            'ignoreerrors': True,
            'retries': 2,
            'fragment_retries': 2,
            'sleep_interval': 5,
            'max_sleep_interval': 20,
            'sleep_requests': 1,

            'cookiefile': 'cookies.txt',
            'extractor_args': {
                'youtube': {
                    'player_client': ['android', 'web', 'ios', 'tv']
                }
            }
        }

        extracted_info = None
        try:
            metadata = {
                'title': 'Unknown Title',
                'artist': 'Unknown Artist',
                'groups': [group]
            }
            
            ydl_opts = {
                **base_ydl_opts,
                'format': 'bestaudio[ext=m4a]/bestaudio/best/ba/b/all',
            }
            
            info = None
            try:
                info = yt_dlp_extract_info(f'https://www.youtube.com/watch?v={yt_id}', ydl_opts, download=True)
            except Exception as e:
                print(f"Audio download failed for {yt_id}: {e}")

            if not os.path.exists(audio_path):
                return None

            if info:
                metadata['title'] = info.get('title', 'Unknown Title')
                metadata['artist'] = info.get('uploader', 'Unknown Artist')
                meta_path = os.path.join(CACHE_DIR, f"{yt_id}.json")
                with open(meta_path, 'w', encoding='utf-8') as f:
                    json.dump(metadata, f, ensure_ascii=False)
            
            if not os.path.exists(audio_path):
                return None
                
            display_name = f"{metadata['artist']} - {metadata['title']}"

            wav_tensor, sr = torchaudio.load(audio_path)
            if wav_tensor.shape[0] > 1:
                wav_tensor = wav_tensor.mean(dim=0, keepdim=True)
                
            max_val = torch.max(torch.abs(wav_tensor))
            if max_val > 0:
                wav_tensor = wav_tensor / max_val
                
            wav_tensor = wav_tensor.to(device)
            
            with torch.no_grad():
                with model_lock:
                    embed = mulan(wavs=wav_tensor)
                
            embed = embed[0].unsqueeze(0).cpu()
            
            torch.save(embed, os.path.join(CACHE_DIR, f"{yt_id}.pt"))
            
            extracted_info = {
                "yt_id": yt_id,
                "display_name": display_name,
                "embed": embed
            }
            
        except Exception as e:
            print(f"Error handling {yt_id}: {e}")
        finally:
            if os.path.exists(audio_path):
                try: os.remove(audio_path)
                except: pass
            if os.path.exists(temp_dir):
                try:
                    for file in os.listdir(temp_dir):
                        os.remove(os.path.join(temp_dir, file))
                    os.rmdir(temp_dir)
                except: pass
                
        return extracted_info

    if playlist_queries and not selected_yt_id:
        seen_ids = set()
        total_queries = len(playlist_queries)

        for idx, query in enumerate(playlist_queries, start=1):
            update_extract_state(
                status=f"Resolving {idx}/{total_queries}: {query[:50]}",
                current=idx - 1,
                total=total_queries,
            )
            try:
                if is_youtube_reference(query):
                    if 'v=' in query:
                        resolved_yt_id = query.split('v=')[1].split('&')[0]
                    elif 'youtu.be/' in query:
                        resolved_yt_id = query.split('youtu.be/')[1].split('?')[0]
                    elif bool(re.fullmatch(r"[A-Za-z0-9_-]{11}", query.strip())):
                        resolved_yt_id = query.strip()
                    else:
                        resolved_yt_id = resolve_query_to_yt_id(query, candidate_limit=3)
                else:
                    resolved_yt_id = resolve_query_to_yt_id(query, candidate_limit=3)
            except Exception as e:
                print(f"Failed to resolve playlist line '{query}': {e}")
                update_extract_state(current=idx, status=f"Skipped {idx}/{total_queries} (resolve failed)")
                continue

            if not resolved_yt_id:
                update_extract_state(current=idx, status=f"Skipped {idx}/{total_queries} (no match)")
                continue

            if resolved_yt_id in seen_ids:
                update_extract_state(current=idx, status=f"Skipped {idx}/{total_queries} (duplicate)")
                continue
            seen_ids.add(resolved_yt_id)

            update_extract_state(
                status=f"Downloading/extracting {idx}/{total_queries}",
                current=idx - 1,
                total=total_queries,
            )

            try:
                res = process_yt_id(resolved_yt_id)
                if res:
                    audio_embeddings[group][res["yt_id"]] = res["embed"]
                    song_metadata[group][res["yt_id"]] = res["display_name"]
                    extracted_songs.append({"yt_id": res["yt_id"], "display_name": res["display_name"]})
                    processed_count += 1
            except Exception as e:
                print(f"File processing failed for playlist item '{query}': {e}")

            update_extract_state(current=idx, status=f"Processed {idx}/{total_queries}")
            if idx < total_queries and PLAYLIST_ITEM_DELAY_MS > 0:
                time.sleep(PLAYLIST_ITEM_DELAY_MS / 1000.0)

        if processed_count == 0:
            update_extract_state(is_extracting=False, status="No songs matched from playlist queries")
            raise HTTPException(status_code=400, detail="No songs matched from playlist queries")

        update_extract_state(is_extracting=False, status=f"Done. Added {processed_count} songs.")
        return {"processed": processed_count, "extracted": extracted_songs}

    max_workers = 4 
    completed_so_far = 0

    with ThreadPoolExecutor(max_workers=max_workers) as executor:
        futures = [executor.submit(process_yt_id, yid) for yid in yt_ids]
        for future in as_completed(futures):
            completed_so_far += 1
            update_extract_state(current=completed_so_far, status=f"Processed {completed_so_far} / {len(yt_ids)}")
            try:
                res = future.result()
                if res:
                    audio_embeddings[group][res["yt_id"]] = res["embed"]
                    song_metadata[group][res["yt_id"]] = res["display_name"]
                    extracted_songs.append({"yt_id": res["yt_id"], "display_name": res["display_name"]})
                    processed_count += 1
            except Exception as e:
                print(f"File processing failed: {e}")

    update_extract_state(is_extracting=False, status=f"Done. Added {processed_count} songs.")
    return {"processed": processed_count, "extracted": extracted_songs}

class RemoveSongsReq(BaseModel):
    yt_ids: List[str]
    group: str = "default"

@app.post("/remove_songs")
def remove_songs(req: RemoveSongsReq):
    if not is_ready:
        raise HTTPException(status_code=503, detail="Backend not ready yet")
        
    group = req.group.strip() if req.group else "default"
    removed_count = 0

    if group in audio_embeddings:
        for yt_id in req.yt_ids:
            if yt_id in audio_embeddings[group]:
                del audio_embeddings[group][yt_id]
                removed_count += 1
            if group in song_metadata and yt_id in song_metadata[group]:
                del song_metadata[group][yt_id]
                
            # Handle cache removal or update
            pt_path = os.path.join(CACHE_DIR, f"{yt_id}.pt")
            json_path = os.path.join(CACHE_DIR, f"{yt_id}.json")
            if os.path.exists(json_path):
                try:
                    with open(json_path, 'r', encoding='utf-8') as f:
                        metadata = json.load(f)
                    
                    if 'groups' in metadata and group in metadata['groups']:
                        metadata['groups'].remove(group)
                    
                    if not metadata.get('groups'):
                        if os.path.exists(pt_path):
                            os.remove(pt_path)
                        os.remove(json_path)
                    else:
                        with open(json_path, 'w', encoding='utf-8') as f:
                            json.dump(metadata, f, ensure_ascii=False)
                except Exception as e:
                    print(f"Failed to update cache for {yt_id}: {e}")
                
        if len(audio_embeddings[group]) == 0:
            del audio_embeddings[group]
            if group in song_metadata:
                del song_metadata[group]
                
    return {"removed": removed_count}

