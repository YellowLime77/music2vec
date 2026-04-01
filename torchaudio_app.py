import sys
import os
import hashlib
import threading
from concurrent.futures import ThreadPoolExecutor, as_completed
import torch
import torchaudio
import librosa
import soundfile as sf
import numpy as np
from PyQt6.QtWidgets import (QApplication, QMainWindow, QWidget, QVBoxLayout, 
                             QHBoxLayout, QComboBox, QLineEdit, QPushButton, 
                             QListWidget, QListWidgetItem, QLabel, QProgressBar, QStyle,
                             QCompleter, QTabWidget)
from PyQt6.QtCore import QThread, pyqtSignal, QUrl, Qt
from PyQt6.QtMultimedia import QMediaPlayer, QAudioOutput
from muq import MuQMuLan

device = 'cuda' if torch.cuda.is_available() else 'cpu'
CACHE_DIR = 'embeddings_cache'

class DataLoaderThread(QThread):
    finished = pyqtSignal(object, list, dict)
    progress = pyqtSignal(str)
    progress_percent = pyqtSignal(int)

    def run(self):
        self.progress.emit("Loading MuLan model...")
        self.progress_percent.emit(0)
        mulan = MuQMuLan.from_pretrained("OpenMuQ/MuQ-MuLan-large")
        mulan = mulan.to(device).eval()

        input_directory = 'songs'
        os.makedirs(CACHE_DIR, exist_ok=True)

        raw_files = []
        if os.path.exists(input_directory):
            raw_files = [f for f in os.listdir(input_directory) if os.path.isfile(os.path.join(input_directory, f)) and f.endswith(('.wav', '.mp3', '.flac', '.ogg', '.m4a'))]

        audio_embeddings = {}
        
        self.progress.emit("Loading cached embeddings...")
        
        valid_files = []
        for i, filename in enumerate(raw_files):
            cache_path = os.path.join(CACHE_DIR, f"{filename}.pt")
            if os.path.exists(cache_path):
                try:
                    embeds = torch.load(cache_path, map_location=device, weights_only=True)
                    audio_embeddings[filename] = embeds
                    valid_files.append(filename)
                    self.progress.emit(f"Loaded: {filename}")
                except Exception as e:
                    print(f"Error loading cache for {filename}: {e}")
            
            percent = int(((i + 1) / len(raw_files)) * 100)
            self.progress_percent.emit(percent)

        self.progress.emit("Ready!")
        self.progress_percent.emit(100)
        self.finished.emit(mulan, valid_files, audio_embeddings)

class MusicApp(QMainWindow):
    def __init__(self):
        super().__init__()
        self.setWindowTitle("Music2Vec Explorer")
        self.resize(600, 400)

        self.mulan = None
        self.song_names = []
        self.audio_embeddings = {}
        self.currently_playing = None
        self.active_button = None

        self.audio_output = QAudioOutput()
        self.player = QMediaPlayer()
        self.player.setAudioOutput(self.audio_output)
        self.player.playbackStateChanged.connect(self.on_playback_state_changed)

        self.initUI()
        self.loadData()

    def initUI(self):
        central_widget = QWidget()
        self.setCentralWidget(central_widget)
        layout = QVBoxLayout(central_widget)

        self.status_label = QLabel("Initializing...")
        layout.addWidget(self.status_label)

        self.progress_bar = QProgressBar()
        self.progress_bar.setRange(0, 100)
        self.progress_bar.setValue(0)
        layout.addWidget(self.progress_bar)

        # Search mode selector
        self.search_tabs = QTabWidget()

        song_tab = QWidget()
        song_layout = QVBoxLayout(song_tab)

        search_layout = QHBoxLayout()
        self.song_search_input = QLineEdit()
        self.song_search_input.setPlaceholderText("Search library...")
        self.song_search_input.textChanged.connect(self.filter_song_library)
        self.play_selected_btn = QPushButton()
        self.configure_play_button(self.play_selected_btn, "Play/Pause selected song sample")
        self.play_selected_btn.clicked.connect(self.toggle_selected_song_sample)
        self.play_selected_btn.setEnabled(False)
        self.add_to_group_1_btn = QPushButton("Add to Group 1")
        self.add_to_group_1_btn.clicked.connect(lambda: self.add_selected_song_to_group(1))
        self.add_to_group_1_btn.setEnabled(False)
        self.add_to_group_2_btn = QPushButton("Add to Group 2")
        self.add_to_group_2_btn.clicked.connect(lambda: self.add_selected_song_to_group(2))
        self.add_to_group_2_btn.setEnabled(False)
        self.find_song_btn = QPushButton("Find Similar Song")
        self.find_song_btn.clicked.connect(self.find_similar_by_song)
        self.find_song_btn.setEnabled(False)
        search_layout.addWidget(QLabel("Library:"))
        search_layout.addWidget(self.song_search_input)
        search_layout.addWidget(self.play_selected_btn)
        search_layout.addWidget(self.add_to_group_1_btn)
        search_layout.addWidget(self.add_to_group_2_btn)
        search_layout.addWidget(self.find_song_btn)
        song_layout.addLayout(search_layout)

        self.song_library_list = QListWidget()
        self.song_library_list.setSelectionMode(QListWidget.SelectionMode.ExtendedSelection)
        self.song_library_list.setMaximumHeight(100)
        song_layout.addWidget(self.song_library_list)

        song_group_row = QHBoxLayout()
        
        # Group 1
        group1_layout = QVBoxLayout()
        group1_layout.addWidget(QLabel("Group 1:"))
        self.song_group_list_1 = QListWidget()
        self.song_group_list_1.setMaximumHeight(100)
        group1_layout.addWidget(self.song_group_list_1)
        
        group1_actions = QHBoxLayout()
        self.remove_group_song_1_btn = QPushButton("Remove")
        self.remove_group_song_1_btn.clicked.connect(lambda: self.remove_group_song(1))
        self.remove_group_song_1_btn.setEnabled(False)
        self.clear_group_1_btn = QPushButton("Clear")
        self.clear_group_1_btn.clicked.connect(lambda: self.clear_group_songs(1))
        self.clear_group_1_btn.setEnabled(False)
        group1_actions.addWidget(self.remove_group_song_1_btn)
        group1_actions.addWidget(self.clear_group_1_btn)
        group1_layout.addLayout(group1_actions)
        song_group_row.addLayout(group1_layout)

        # Group 2
        group2_layout = QVBoxLayout()
        group2_layout.addWidget(QLabel("Group 2:"))
        self.song_group_list_2 = QListWidget()
        self.song_group_list_2.setMaximumHeight(100)
        group2_layout.addWidget(self.song_group_list_2)
        
        group2_actions = QHBoxLayout()
        self.remove_group_song_2_btn = QPushButton("Remove")
        self.remove_group_song_2_btn.clicked.connect(lambda: self.remove_group_song(2))
        self.remove_group_song_2_btn.setEnabled(False)
        self.clear_group_2_btn = QPushButton("Clear")
        self.clear_group_2_btn.clicked.connect(lambda: self.clear_group_songs(2))
        self.clear_group_2_btn.setEnabled(False)
        group2_actions.addWidget(self.remove_group_song_2_btn)
        group2_actions.addWidget(self.clear_group_2_btn)
        group2_layout.addLayout(group2_actions)
        song_group_row.addLayout(group2_layout)

        song_group_actions = QVBoxLayout()
        self.algo_combo = QComboBox()
        self.algo_combo.addItems(["Multi-Centroid", "Average Vector"])
        
        song_group_actions.addWidget(QLabel("Group Algo:"))
        song_group_actions.addWidget(self.algo_combo)
        song_group_actions.addStretch()
        song_group_row.addLayout(song_group_actions)

        song_layout.addWidget(QLabel("Song Group for Combined Search:"))
        song_layout.addLayout(song_group_row)

        text_tab = QWidget()
        text_layout = QHBoxLayout(text_tab)
        self.text_input = QLineEdit()
        self.text_input.setPlaceholderText("Enter text description to find similar songs...")
        self.find_text_btn = QPushButton("Search by Text")
        self.find_text_btn.clicked.connect(self.find_similar_by_text)
        self.find_text_btn.setEnabled(False)
        text_layout.addWidget(self.text_input)
        text_layout.addWidget(self.find_text_btn)

        # Describe Song Tab
        describe_tab = QWidget()
        describe_layout = QVBoxLayout(describe_tab)
        
        describe_search_layout = QHBoxLayout()
        self.describe_search_input = QLineEdit()
        self.describe_search_input.setPlaceholderText("Search library...")
        self.describe_search_input.textChanged.connect(self.filter_describe_library)
        
        self.describe_song_btn = QPushButton("Describe Selected Song")
        self.describe_song_btn.clicked.connect(self.describe_selected_song)
        self.describe_song_btn.setEnabled(False)
        
        describe_search_layout.addWidget(QLabel("Library:"))
        describe_search_layout.addWidget(self.describe_search_input)
        describe_search_layout.addWidget(self.describe_song_btn)
        describe_layout.addLayout(describe_search_layout)

        self.describe_library_list = QListWidget()
        self.describe_library_list.setSelectionMode(QListWidget.SelectionMode.SingleSelection)
        self.describe_library_list.setMaximumHeight(150)
        describe_layout.addWidget(self.describe_library_list)
        
        describe_layout.addWidget(QLabel("Description Results:"))
        self.describe_results_list = QListWidget()
        describe_layout.addWidget(self.describe_results_list)

        self.search_tabs.addTab(song_tab, "Search by Song")
        self.search_tabs.addTab(text_tab, "Search by Text")
        self.search_tabs.addTab(describe_tab, "Describe Song")
        layout.addWidget(self.search_tabs)

        # Results
        layout.addWidget(QLabel("Similar Songs:"))
        results_layout = QHBoxLayout()
        self.results_list = QListWidget()
        self.results_list.itemDoubleClicked.connect(self.play_result_item_sample)
        results_layout.addWidget(self.results_list)
        self.play_result_btn = QPushButton()
        self.configure_play_button(self.play_result_btn, "Play/Pause highlighted result sample")
        self.play_result_btn.clicked.connect(self.toggle_selected_result_sample)
        self.play_result_btn.setEnabled(False)
        results_layout.addWidget(self.play_result_btn)
        layout.addLayout(results_layout)

    def filter_song_library(self, text):
        search_term = text.lower()
        for i in range(self.song_library_list.count()):
            item = self.song_library_list.item(i)
            item.setHidden(search_term not in item.text().lower())

    def filter_describe_library(self, text):
        search_term = text.lower()
        for i in range(self.describe_library_list.count()):
            item = self.describe_library_list.item(i)
            item.setHidden(search_term not in item.text().lower())

    def loadData(self):
        self.loader = DataLoaderThread()
        self.loader.progress.connect(self.status_label.setText)
        self.loader.progress_percent.connect(self.progress_bar.setValue)
        self.loader.finished.connect(self.onDataLoaded)
        self.loader.start()

    def onDataLoaded(self, mulan, song_names, embeddings):
        self.mulan = mulan
        self.song_names = song_names
        self.audio_embeddings = embeddings
        self.progress_bar.setValue(100)
        
        self.song_library_list.addItems(song_names)
        self.describe_library_list.addItems(song_names)
        has_songs = len(song_names) > 0
        self.find_song_btn.setEnabled(has_songs)
        self.find_text_btn.setEnabled(has_songs)
        self.play_selected_btn.setEnabled(has_songs)
        self.add_to_group_1_btn.setEnabled(has_songs)
        self.add_to_group_2_btn.setEnabled(has_songs)
        self.describe_song_btn.setEnabled(has_songs)

    def get_group_song_names(self, group_index):
        list_widget = self.song_group_list_1 if group_index == 1 else self.song_group_list_2
        return [list_widget.item(i).data(Qt.ItemDataRole.UserRole) for i in range(list_widget.count())]

    def refresh_group_buttons(self, group_index):
        list_widget = self.song_group_list_1 if group_index == 1 else self.song_group_list_2
        has_group = list_widget.count() > 0
        if group_index == 1:
            self.remove_group_song_1_btn.setEnabled(has_group)
            self.clear_group_1_btn.setEnabled(has_group)
        else:
            self.remove_group_song_2_btn.setEnabled(has_group)
            self.clear_group_2_btn.setEnabled(has_group)

    def add_selected_song_to_group(self, group_index):
        selected_items = self.song_library_list.selectedItems()
        existing = set(self.get_group_song_names(group_index))
        list_widget = self.song_group_list_1 if group_index == 1 else self.song_group_list_2
        
        for item in selected_items:
            song_name = item.text().strip()
            if song_name and song_name in self.audio_embeddings and song_name not in existing:
                group_item = QListWidgetItem(song_name)
                group_item.setData(Qt.ItemDataRole.UserRole, song_name)
                list_widget.addItem(group_item)
                existing.add(song_name)
                
        self.refresh_group_buttons(group_index)

    def remove_group_song(self, group_index):
        list_widget = self.song_group_list_1 if group_index == 1 else self.song_group_list_2
        row = list_widget.currentRow()
        if row < 0:
            return
        list_widget.takeItem(row)
        self.refresh_group_buttons(group_index)

    def clear_group_songs(self, group_index):
        list_widget = self.song_group_list_1 if group_index == 1 else self.song_group_list_2
        list_widget.clear()
        self.refresh_group_buttons(group_index)

    def combine_song_embeddings(self, song_names):
        embeds = [self.audio_embeddings[name] for name in song_names if name in self.audio_embeddings]
        if not embeds:
            return None
            
        stacked = torch.stack([embed.squeeze(0) for embed in embeds], dim=0)
        
        if self.algo_combo.currentText() == "Average Vector":
            return stacked.mean(dim=0, keepdim=True)
        
        num_clusters = min(3, len(stacked))
        
        if num_clusters <= 1:
            return stacked
            
        # Multi-Centroid Clustering using simple KMeans in PyTorch
        g = torch.Generator(device=stacked.device).manual_seed(42)
        indices = torch.randperm(len(stacked), generator=g, device=stacked.device)[:num_clusters]
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

    def find_similar_by_song(self, *args):
        try:
            group1_songs = self.get_group_song_names(1)
            group2_songs = self.get_group_song_names(2)
            
            is_fallback = False
            # If no songs in any group, check if any song is selected in library
            if not group1_songs and not group2_songs:
                selected_items = self.song_library_list.selectedItems()
                group1_songs = [item.text().strip() for item in selected_items if item.text().strip()]
                is_fallback = True

            valid_songs_1 = [name for name in group1_songs if name in self.audio_embeddings]
            valid_songs_2 = [name for name in group2_songs if name in self.audio_embeddings]
            
            if not valid_songs_1 and not valid_songs_2:
                self.status_label.setText("Select at least one valid song for search.")
                return

            target_embed_1 = self.combine_song_embeddings(valid_songs_1) if valid_songs_1 else None
            target_embed_2 = self.combine_song_embeddings(valid_songs_2) if valid_songs_2 else None

            total_songs = len(valid_songs_1) + len(valid_songs_2)
            if is_fallback:
                self.status_label.setText(f"Searching by {total_songs} selected song(s) from library...")
            else:
                self.status_label.setText(f"Searching by {total_songs} song(s) in groups...")
            QApplication.processEvents()
            
            exclude_songs = valid_songs_1 + valid_songs_2
            self.rank_and_display(target_embed_1, target_embed_2, exclude_songs=exclude_songs)
            self.status_label.setText("Ready!")
        except Exception as e:
            import traceback
            with open("ui_error.log", "w") as f:
                traceback.print_exc(file=f)
            self.status_label.setText("Error occurred, check ui_error.log")

    def find_similar_by_text(self, *args):
        text = self.text_input.text().strip()
        if not text:
            return
        
        self.status_label.setText("Extracting text embedding...")
        QApplication.processEvents()
        
        with torch.no_grad():
            text_embed = self.mulan(texts=[text]) 
        
        self.status_label.setText("Ready!")
        self.rank_and_display(text_embed, None)

    def describe_selected_song(self):
        selected_items = self.describe_library_list.selectedItems()
        if not selected_items:
            self.status_label.setText("Please select a song from the list first.")
            return

        song_name = selected_items[0].text().strip()
        if not song_name or song_name not in self.audio_embeddings:
            self.status_label.setText("Please select a valid song first.")
            return

        audio_embed = self.audio_embeddings[song_name]

        # Use an expanded list of predefined tags
        tags = [
            # Genres & Subgenres
            "pop", "rock", "hip hop", "rap", "jazz", "classical", "electronic", "edm", "country", "r&b", 
            "folk", "indie", "alternative", "soul", "blues", "metal", "death metal", "black metal", "reggae", 
            "punk", "pop punk", "disco", "house", "deep house", "techno", "trance", "dubstep", "ambient", 
            "lo-fi", "synthwave", "vaporwave", "grunge", "emo", "ska", "k-pop", "j-pop", "latin", "reggaeton", 
            "salsa", "bossa nova", "afrobeats", "gospel", "funk", "bluegrass", "country rock", "math rock", 
            "progressive rock", "post-rock", "shoegaze", "hyperpop", "chiptune", "classical crossover", 
            "operatic", "orchestral", "trap", "drill", "drum and bass", "garage", "grime", "psytrance", 
            "hardstyle", "industrial", "synthpop", "new wave", "goth", "americana", "zydeco", "mariachi",

            # Instruments
            "acoustic guitar", "electric guitar", "bass guitar", "slap bass", "piano", "grand piano", "electric piano", 
            "synthesizer", "keyboard", "drums", "drum machine", "percussion", "cymbals", "hi-hat", "snare", 
            "kick drum", "strings", "violin", "cello", "viola", "double bass", "brass", "trumpet", "saxophone", 
            "trombone", "french horn", "woodwinds", "flute", "clarinet", "oboe", "bassoon", "vocals", "male vocals", 
            "female vocals", "choir", "a cappella", "rapping", "screaming", "growling", "falsetto", "harmonies", 
            "backing vocals", "beatboxing", "turntables", "sampler", "808", "banjo", "mandolin", "ukulele", 
            "harp", "sitar", "accordion", "harmonica", "kazoo", "xylophone", "glockenspiel", "marimba", "vibraphone", 
            "timpani", "bongos", "congas", "djembe", "tambourine", "cowbell", "triangle", "shaker", "castanets", 
            "gong", "chimes", "bells", "organ", "pipe organ", "mellotron", "theremin", "vocoder", "talkbox",

            # Moods,  Feels & Emotions
            "happy", "sad", "angry", "calm", "energetic", "relaxing", "upbeat", "melancholy", "romantic", "dark", 
            "eerie", "spooky", "tense", "anxious", "uplifting", "joyful", "triumphant", "euphoric", "depressing", 
            "gloomy", "nostalgic", "sentimental", "dreamy", "hypnotic", "trippy", "psychedelic", "aggressive", 
            "fierce", "intense", "peaceful", "serene", "soothing", "chill", "groovy", "funky", "soulful", 
            "sensual", "sexy", "passionate", "epic", "cinematic", "dramatic", "suspenseful", "quirky", "playful", 
            "silly", "humorous", "mysterious", "mystical", "ethereal", "majestic", "grand", "heroic", "noble", 
            "tragic", "sorrowful", "mournful", "heartbreaking", "bittersweet", "wistful", "reflective", "pensive", 
            "introspective", "contemplative", "meditative", "zen", "spiritual", "transcendent", "otherworldly",

            # Tempo, Dynamics & Structure
            "fast tempo", "slow tempo", "medium tempo", "mid-tempo", "up-tempo", "down-tempo", "heavy", "light", 
            "loud", "quiet", "dynamic", "static", "crescendo", "build-up", "drops", "beat drop", "fade out", 
            "staccato", "legato", "groove", "syncopation", "polyrhythm", "odd time signature", "4/4 time", 
            "acoustic", "electric", "unplugged", "live recording", "studio recording", "raw", "polished", 
            "overproduced", "high fidelity", "compressed", "distorted", "clean", "reverb-heavy", "echoey", 
            "atmospheric", "spatial", "wall of sound", "minimalist", "maximalist", "sparse", "dense", "monotonous", 
            "repetitive", "catchy hook", "melodic", "dissonant", "harmonic", "atonal", "rhythmic", "vocal-driven", 
            "instrumental", "bassy", "treble-heavy", "muffled", "muffled kicks", "crisp", "punchy", "smooth", 
            "harsh", "abrasive", "gritty", "fuzzy", "fuzzy guitar", "warm", "cold", "metallic", "wooden", "organic", 
            "synthetic", "robotic", "robotic vocals", "autotune"
        ]

        self.status_label.setText(f"Describing {song_name}...")
        QApplication.processEvents()

        try:
            with torch.no_grad():
                text_embeds = self.mulan(texts=tags)
            
            # Compute similarity
            similarities = []
            for i, tag in enumerate(tags):
                tag_embed = text_embeds[i].unsqueeze(0)
                sim = torch.nn.functional.cosine_similarity(audio_embed, tag_embed, dim=-1).item()
                similarities.append((sim, tag))
                
            similarities.sort(key=lambda x: x[0], reverse=True)
            
            self.describe_results_list.clear()
            self.describe_results_list.addItem(f"Top tags for '{song_name}':\n")
            for sim, tag in similarities[:15]:
                self.describe_results_list.addItem(f"{tag} (Similarity: {sim:.4f})")
                
            self.status_label.setText("Ready!")
            
        except Exception as e:
            import traceback
            with open("ui_error.log", "w") as f:
                traceback.print_exc(file=f)
            self.status_label.setText("Error occurred, check ui_error.log")

    def rank_and_display(self, target_embed_1, target_embed_2, exclude_songs=None):
        try:
            excluded = set(exclude_songs or [])
            results = []
            for song_name, embed in self.audio_embeddings.items():
                if song_name in excluded:
                    continue
                    
                def calc_sim(target_embed, e):
                    if target_embed.size(0) > 1:
                        sims = [torch.nn.functional.cosine_similarity(c.unsqueeze(0), e, dim=-1).item() for c in target_embed]
                        return max(sims)
                    else:
                        return torch.nn.functional.cosine_similarity(target_embed, e, dim=-1).item()
                
                sim1 = calc_sim(target_embed_1, embed) if target_embed_1 is not None else 0
                sim2 = calc_sim(target_embed_2, embed) if target_embed_2 is not None else 0
                
                if target_embed_1 is not None and target_embed_2 is not None:
                    sim = 0.5 * sim1 + 0.5 * sim2
                elif target_embed_1 is not None:
                    sim = sim1
                elif target_embed_2 is not None:
                    sim = sim2
                else:
                    sim = 0
                    
                results.append((sim, song_name))
                
            results.sort(key=lambda x: x[0], reverse=True)
            
            self.results_list.clear()
            for sim, name in results:
                item = QListWidgetItem(f"{name} (Similarity: {sim:.4f})")
                item.setData(Qt.ItemDataRole.UserRole, name)
                self.results_list.addItem(item)

            has_results = self.results_list.count() > 0
            self.play_result_btn.setEnabled(has_results)
            if has_results:
                self.results_list.setCurrentRow(0)
        except Exception as e:
            import traceback
            with open("ui_error.log", "w") as f:
                traceback.print_exc(file=f)
            self.status_label.setText("Error in rank_and_display, check log")

    def configure_play_button(self, button, tooltip):
        button.setCheckable(False)
        button.setFixedSize(30, 30)
        button.setToolTip(tooltip)
        self.set_play_icon(button)

    def set_play_icon(self, button):
        button.setIcon(self.style().standardIcon(QStyle.StandardPixmap.SP_MediaPlay))

    def set_pause_icon(self, button):
        button.setIcon(self.style().standardIcon(QStyle.StandardPixmap.SP_MediaPause))

    def reset_play_buttons(self):
        self.set_play_icon(self.play_selected_btn)
        self.set_play_icon(self.play_result_btn)

    def get_song_path(self, song_name):
        return os.path.join('songs', song_name)

    def play_song_sample(self, song_name, source_button):
        if not song_name:
            return

        audio_path = self.get_song_path(song_name)
        if not os.path.exists(audio_path):
            self.status_label.setText(f"Audio file not found: {song_name}")
            return

        self.player.stop()
        self.player.setSource(QUrl.fromLocalFile(os.path.abspath(audio_path)))
        self.player.play()

        self.currently_playing = song_name
        self.active_button = source_button
        self.reset_play_buttons()
        self.set_pause_icon(source_button)
        self.status_label.setText(f"Playing sample: {song_name}")

    def toggle_play_pause(self, song_name, source_button):
        if not song_name:
            return

        state = self.player.playbackState()
        if self.currently_playing == song_name and self.active_button == source_button:
            if state == QMediaPlayer.PlaybackState.PlayingState:
                self.player.pause()
                self.set_play_icon(source_button)
                self.status_label.setText(f"Paused sample: {song_name}")
                return
            if state == QMediaPlayer.PlaybackState.PausedState:
                self.player.play()
                self.set_pause_icon(source_button)
                self.status_label.setText(f"Playing sample: {song_name}")
                return

        self.play_song_sample(song_name, source_button)

    def toggle_selected_song_sample(self):
        selected_items = self.song_library_list.selectedItems()
        if selected_items:
            self.toggle_play_pause(selected_items[0].text(), self.play_selected_btn)

    def toggle_selected_result_sample(self):
        item = self.results_list.currentItem()
        if item is None:
            return
        song_name = item.data(Qt.ItemDataRole.UserRole)
        self.toggle_play_pause(song_name, self.play_result_btn)

    def play_result_item_sample(self, item):
        if item is None:
            return
        song_name = item.data(Qt.ItemDataRole.UserRole)
        self.play_song_sample(song_name, self.play_result_btn)

    def on_playback_state_changed(self, state):
        if state == QMediaPlayer.PlaybackState.StoppedState:
            self.currently_playing = None
            self.active_button = None
            self.reset_play_buttons()

    def stop_sample(self):
        self.player.stop()
        if self.currently_playing:
            self.status_label.setText(f"Stopped sample: {self.currently_playing}")
        self.currently_playing = None
        self.active_button = None
        self.reset_play_buttons()

if __name__ == '__main__':
    app = QApplication(sys.argv)
    window = MusicApp()
    window.show()
    sys.exit(app.exec())
