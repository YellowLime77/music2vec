import warnings
warnings.filterwarnings("ignore", category=RuntimeWarning, module="numpy.core.getlimits")

import torch, librosa
from muq import MuQMuLan
import numpy as np
import matplotlib.pyplot as plt
import matplotlib as mpl
import umap
import os
import hashlib

device = 'cuda'
mulan = MuQMuLan.from_pretrained("OpenMuQ/MuQ-MuLan-large")
mulan = mulan.to(device).eval()

directory = 'songs'
with os.scandir(directory) as entries:
    audio_files = [entry for entry in entries if entry.is_file()]

CACHE_DIR = 'embeddings_cache'
os.makedirs(CACHE_DIR, exist_ok=True)

def get_file_hash(filepath):
    hasher = hashlib.sha256()
    with open(filepath, 'rb') as f:
        buf = f.read()
        hasher.update(buf)
    return hasher.hexdigest()

audio_embeddings = []

for audio_file in [os.path.join(directory, file.name) for file in audio_files]:
    file_hash = get_file_hash(audio_file)
    cache_path = os.path.join(CACHE_DIR, f"{file_hash}.pt")
    
    if os.path.exists(cache_path):
        print(f"Loading cached embedding for {audio_file}...")
        audio_embeds = torch.load(cache_path, map_location=device, weights_only=True)
    else:
        print(f"Extracting embedding for {audio_file}...")
        wav, sr = librosa.load(audio_file, sr = 24000)
        wavs = torch.tensor(wav).unsqueeze(0).to(device) 
        with torch.no_grad():
            audio_embeds = mulan(wavs = wavs)
        torch.save(audio_embeds, cache_path)
        
    audio_embeddings.append(audio_embeds) 

np_audio = np.array([emb.cpu().numpy().flatten() for emb in audio_embeddings])

reducer = umap.UMAP(n_components=3)
reduced_data = reducer.fit_transform(np_audio)

x, y, z = reduced_data[:, 0], reduced_data[:, 1], reduced_data[:, 2]

mpl.rcParams['axes3d.mouserotationstyle'] = 'azel'

fig = plt.figure()
ax = fig.add_subplot(projection='3d')
ax.scatter(x, y, z)

for i, txt in enumerate([file.name for file in audio_files]):
    ax.text(x[i], y[i], z[i], txt, size=10, zorder=1, color='k')

ax.view_init(elev=30., azim=-60.) 

plt.title("Embeddings Visualized in 3D")

# # Calculate similarity matrix between audio files
# n_files = len(audio_embeddings)
# sim_matrix = np.zeros((n_files, n_files))

# for i in range(n_files):
#     for j in range(n_files):
#         sim = mulan.calc_similarity(audio_embeddings[i], audio_embeddings[j])
#         sim_matrix[i, j] = sim.item()

# # Visualize similarity matrix
# plt.figure()
# plt.imshow(sim_matrix, cmap='viridis', interpolation='nearest')
# plt.colorbar()

# labels = [file.name for file in audio_files]
# plt.xticks(ticks=np.arange(n_files), labels=labels, rotation=45, ha='right')
# plt.yticks(ticks=np.arange(n_files), labels=labels)
# plt.title("Audio Embeddings Similarity Matrix")
# plt.tight_layout()

plt.show()