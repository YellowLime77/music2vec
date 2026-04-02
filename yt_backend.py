from fastapi import FastAPI, BackgroundTasks, HTTPException
from pydantic import BaseModel
import os
import json
import torch
import torchaudio
import yt_dlp
import tempfile
import threading
from concurrent.futures import ThreadPoolExecutor, as_completed
from spotdl import Spotdl
from muq import MuQMuLan
from typing import List, Dict, Optional, Any
from fastapi.middleware.cors import CORSMiddleware

app = FastAPI(title="Music2Vec Backend")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Allows all origins, you can restrict this to your frontend URL later
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
device = 'cuda' if torch.cuda.is_available() else 'cpu'
CACHE_DIR = 'yt_embeddings_cache'

# Global state
mulan = None
audio_embeddings = {}
song_metadata = {}
temp_embeddings = {}
temp_song_names = {}
is_ready = False
load_progress = 0
load_status = "Not started"
model_lock = threading.Lock()

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
            meta_path = os.path.join(CACHE_DIR, f"{yt_id}.json")
            if os.path.exists(meta_path):
                try:
                    with open(meta_path, 'r', encoding='utf-8') as f:
                        meta = json.load(f)
                        display_name = f"{meta.get('artist', 'Unknown')} - {meta.get('title', 'Unknown')}"
                except Exception:
                    pass
            
            try:
                embed = torch.load(cache_path, map_location=device, weights_only=True)
                audio_embeddings[yt_id] = embed
                song_metadata[yt_id] = display_name
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
    return {
        "ready": is_ready,
        "progress": load_progress,
        "status": load_status,
        "library_size": len(audio_embeddings),
        "temp_size": len(temp_embeddings)
    }

@app.get("/library")
def get_library():
    return {
        "library": song_metadata,
        "temp_library": temp_song_names
    }

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
        
    g = torch.Generator(device=device).manual_seed(42)
    indices = torch.randperm(len(stacked), generator=g, device=device)[:num_clusters]
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

def calc_similarities(target_embed, exclude_set, embeddings_dict, metadata_dict):
    results = []
    for song_id, embed in embeddings_dict.items():
        if song_id in exclude_set:
            continue
        embed = embed.to(device)
        if target_embed.size(0) > 1:
            sims = [torch.nn.functional.cosine_similarity(c.unsqueeze(0), embed, dim=-1).item() for c in target_embed]
            sim = max(sims)
        else:
            sim = torch.nn.functional.cosine_similarity(target_embed, embed, dim=-1).item()
            
        results.append({
            "yt_id": song_id,
            "display_name": metadata_dict.get(song_id, song_id),
            "similarity": sim
        })
    results.sort(key=lambda x: x["similarity"], reverse=True)
    return results

class SearchSongReq(BaseModel):
    group1: List[str]
    group2: List[str] = []
    algo: str = "Multi-Centroid"
    use_temp: bool = False

@app.post("/search/song")
def search_song(req: SearchSongReq):
    if not is_ready:
        raise HTTPException(status_code=503, detail="Backend not ready yet")
        
    src_embeddings = temp_embeddings if req.use_temp else audio_embeddings
    
    valid_songs_1 = [name for name in req.group1 if name in src_embeddings]
    valid_songs_2 = [name for name in req.group2 if name in src_embeddings]
    
    if not valid_songs_1 and not valid_songs_2:
        raise HTTPException(status_code=400, detail="No valid songs provided")
        
    embeds1 = [src_embeddings[name] for name in valid_songs_1]
    embeds2 = [src_embeddings[name] for name in valid_songs_2]
    
    target_embed_1 = combine_embeddings(embeds1, req.algo) if embeds1 else None
    target_embed_2 = combine_embeddings(embeds2, req.algo) if embeds2 else None
    
    exclude_songs = set(valid_songs_1 + valid_songs_2)
    
    # We compare against the main audio_embeddings database
    results = []
    for song_id, embed in audio_embeddings.items():
        if song_id in exclude_songs:
            continue
            
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
            "display_name": song_metadata.get(song_id, song_id),
            "similarity": sim_val
        })
        
    results.sort(key=lambda x: x["similarity"], reverse=True)
    return {"results": results[:100]}

class SearchTextReq(BaseModel):
    text: str

@app.post("/search/text")
def search_text(req: SearchTextReq):
    if not is_ready:
        raise HTTPException(status_code=503, detail="Backend not ready yet")
        
    if not req.text.strip():
        raise HTTPException(status_code=400, detail="Empty text")
        
    with torch.no_grad():
        with model_lock:
            text_embed = mulan(texts=[req.text.strip()]).to(device)
            
    results = calc_similarities(text_embed, set(), audio_embeddings, song_metadata)
    return {"results": results[:100]}

class UploadReq(BaseModel):
    query: str

@app.post("/extract")
def extract_embedding(req: UploadReq):
    if not is_ready:
        raise HTTPException(status_code=503, detail="Backend not ready yet")
        
    input_text = req.query.strip()
    if not input_text:
        raise HTTPException(status_code=400, detail="Empty query")
        
    extracted_songs = []
    processed_count = 0
    
    # Check if Spotify URL
    if "open.spotify.com" in input_text:
        try:
            spotdl = Spotdl(client_id="ae09839d37b945c2befde3297bee7dde", client_secret="5b6d92a5da9041d89cf3ac2fe188edc9")
            songs = spotdl.search([input_text])
            
            temp_dir = tempfile.mkdtemp()
            # Change directory temporarily so SpotDL downloads into the temp dir
            original_dir = os.getcwd()
            os.chdir(temp_dir)
            
            try:
                results = spotdl.download_songs(songs)
            finally:
                os.chdir(original_dir)
            
            for result, _ in results:
                if not result:
                    continue
                # spot_dl leaves the downloaded file in the temp dir
                pt_file = [f for f in os.listdir(temp_dir) if f.endswith('.mp3')]
                for file_name in pt_file:
                    audio_path = os.path.join(temp_dir, file_name)
                    # Use SpotDL's song object to get a suitable ID and meta
                    yt_id = "spot_" + sum([ord(c) for c in file_name]) # simple hash
                    yt_id = file_name.replace(".mp3", "").replace(" ", "_") # Better simple ID
                    
                    display_name = file_name.replace(".mp3", "")
                    
                    if yt_id in audio_embeddings or yt_id in temp_embeddings:
                        if os.path.exists(audio_path):
                            os.remove(audio_path)
                        continue
                        
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
                    
                    temp_embeddings[yt_id] = embed
                    temp_song_names[yt_id] = display_name
                    extracted_songs.append({"yt_id": yt_id, "display_name": display_name})
                    
                    if os.path.exists(audio_path):
                        os.remove(audio_path)
                        
                    processed_count += 1
            
            try:
                for f in os.listdir(temp_dir):
                    os.remove(os.path.join(temp_dir, f))
                os.rmdir(temp_dir)
            except:
                pass
                
            return {"processed": processed_count, "extracted": extracted_songs}
                
        except Exception as e:
            raise HTTPException(status_code=500, detail=str(e))

    # --- YouTube Logic ---
    search_url = input_text
    if 'list=' in input_text:
        pass
    elif 'v=' in input_text:
        yt_id = input_text.split('v=')[1].split('&')[0]
        search_url = f'https://www.youtube.com/watch?v={yt_id}'
    elif 'youtu.be/' in input_text:
        yt_id = input_text.split('youtu.be/')[1].split('?')[0]
        search_url = f'https://www.youtube.com/watch?v={yt_id}'
    else:
        search_url = f'https://www.youtube.com/watch?v={input_text}'

    yt_ids = []
    ydl_opts_extract = {
        'extract_flat': True, 
        'quiet': True,
        'ignoreerrors': True,
        'sleep_interval': 10,
        'max_sleep_interval': 30,
        'sleep_requests': 1
    }
    try:
        with yt_dlp.YoutubeDL(ydl_opts_extract) as ydl:
            info = ydl.extract_info(search_url, download=False)
            if info and 'entries' in info:
                yt_ids = [entry['id'] for entry in info['entries'] if entry]
            elif info:
                yt_ids = [info['id']]
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to extract IDs: {str(e)}")

    def process_yt_id(yt_id):
        if yt_id in audio_embeddings or yt_id in temp_embeddings:
            return None
            
        temp_dir = tempfile.mkdtemp()
        audio_path = os.path.join(temp_dir, f"{yt_id}.mp3")
        ydl_opts = {
            'format': 'bestaudio/best',
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
            'sleep_interval': 10,
            'max_sleep_interval': 30,
            'sleep_requests': 1,
            'ratelimit': 5000000,
            'ignoreerrors': True,
        }
        
        extracted_info = None
        try:
            with yt_dlp.YoutubeDL(ydl_opts) as ydl:
                info = ydl.extract_info(f'https://www.youtube.com/watch?v={yt_id}', download=True)
                
                if info:
                    metadata = {
                        'title': info.get('title', 'Unknown Title'),
                        'artist': info.get('uploader', 'Unknown Artist')
                    }
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

    max_workers = 4 
    with ThreadPoolExecutor(max_workers=max_workers) as executor:
        futures = [executor.submit(process_yt_id, yid) for yid in yt_ids]
        for future in as_completed(futures):
            try:
                res = future.result()
                if res:
                    temp_embeddings[res["yt_id"]] = res["embed"]
                    temp_song_names[res["yt_id"]] = res["display_name"]
                    extracted_songs.append({"yt_id": res["yt_id"], "display_name": res["display_name"]})
                    processed_count += 1
            except Exception as e:
                print(f"File processing failed: {e}")

    return {"processed": processed_count, "extracted": extracted_songs}
