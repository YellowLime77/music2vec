import hashlib
import json
import os
import threading
from concurrent.futures import ThreadPoolExecutor, as_completed

from kivy.app import App
from kivy.clock import Clock
from kivy.core.audio import SoundLoader
from kivy.lang import Builder
from kivy.metrics import dp
from kivy.properties import BooleanProperty, ListProperty, NumericProperty, StringProperty
from kivy.uix.boxlayout import BoxLayout
from kivy.uix.button import Button
from kivy.uix.checkbox import CheckBox
from kivy.uix.gridlayout import GridLayout
from kivy.uix.label import Label
from kivy.uix.scrollview import ScrollView
from kivy.uix.spinner import Spinner
from kivy.uix.textinput import TextInput

KV = """
<RootView>:
    orientation: "vertical"
    spacing: dp(8)
    padding: dp(8)

    Label:
        id: status_label
        text: root.status_text
        size_hint_y: None
        height: dp(28)
        text_size: self.size
        halign: "left"
        valign: "middle"

    ProgressBar:
        id: progress_bar
        max: 100
        value: root.progress_value
        size_hint_y: None
        height: dp(18)

    BoxLayout:
        size_hint_y: None
        height: dp(42)
        spacing: dp(8)

        Spinner:
            id: song_spinner
            text: "Select Song"
            values: root.song_names

        Button:
            text: "Play/Pause Song"
            on_release: root.toggle_selected_song()

        Button:
            id: find_song_btn
            text: "Find Similar"
            disabled: not root.search_enabled
            on_release: root.find_similar_by_song()

    BoxLayout:
        size_hint_y: None
        height: dp(42)
        spacing: dp(8)

        TextInput:
            id: text_search_input
            hint_text: "Describe music to search"
            multiline: False

        Button:
            id: find_text_btn
            text: "Search by Text"
            disabled: not root.search_enabled
            on_release: root.find_similar_by_text()

    Label:
        text: "Library (multi-select)"
        size_hint_y: None
        height: dp(26)

    ScrollView:
        do_scroll_x: False
        do_scroll_y: True
        size_hint_y: 0.26

        GridLayout:
            id: library_layout
            cols: 1
            size_hint_y: None
            height: self.minimum_height
            spacing: dp(4)

    BoxLayout:
        size_hint_y: None
        height: dp(42)
        spacing: dp(8)

        Button:
            text: "Add Selected To Queue"
            on_release: root.add_selected_to_queue()

        Button:
            text: "Play Queue"
            on_release: root.play_queue_from_start()

        Button:
            text: "Clear Queue"
            on_release: root.clear_queue()

    Label:
        text: "Queue"
        size_hint_y: None
        height: dp(26)

    ScrollView:
        do_scroll_x: False
        do_scroll_y: True
        size_hint_y: 0.20

        GridLayout:
            id: queue_layout
            cols: 1
            size_hint_y: None
            height: self.minimum_height
            spacing: dp(4)

    BoxLayout:
        size_hint_y: None
        height: dp(42)
        spacing: dp(8)

        TextInput:
            id: playlist_name_input
            hint_text: "Playlist name"
            multiline: False

        Button:
            text: "Save Queue"
            on_release: root.save_playlist()

        Spinner:
            id: playlist_spinner
            text: "Select Playlist"
            values: root.playlist_names

        Button:
            text: "Load Playlist"
            on_release: root.load_playlist(replace_queue=True)

        Button:
            text: "Append Playlist"
            on_release: root.load_playlist(replace_queue=False)

    BoxLayout:
        size_hint_y: None
        height: dp(42)
        spacing: dp(8)

        TextInput:
            id: sleep_minutes_input
            hint_text: "Sleep minutes"
            multiline: False
            input_filter: "int"

        Button:
            text: "Start Sleep Timer"
            on_release: root.start_sleep_timer()

        Button:
            text: "Cancel Sleep Timer"
            on_release: root.cancel_sleep_timer()

    Label:
        text: "Search Results"
        size_hint_y: None
        height: dp(26)

    ScrollView:
        do_scroll_x: False
        do_scroll_y: True
        size_hint_y: 0.22

        GridLayout:
            id: results_layout
            cols: 1
            size_hint_y: None
            height: self.minimum_height
            spacing: dp(4)
"""

SUPPORTED_AUDIO_EXT = (".wav", ".mp3", ".flac", ".m4a", ".ogg")


def get_file_hash(filepath):
    hasher = hashlib.sha256()
    with open(filepath, "rb") as file_handle:
        while True:
            chunk = file_handle.read(1024 * 1024)
            if not chunk:
                break
            hasher.update(chunk)
    return hasher.hexdigest()


class EmbedderEngine:
    def __init__(self, songs_dir, cache_dir):
        self.songs_dir = songs_dir
        self.cache_dir = cache_dir
        os.makedirs(self.cache_dir, exist_ok=True)

        self.mulan = None
        self.audio_embeddings = {}
        self.song_names = []
        self.import_error = None

        self._torch = None
        self._librosa = None
        self._model_lock = threading.Lock()

    def load_all(self, status_cb, progress_cb):
        try:
            import torch
            import librosa
            from muq import MuQMuLan
        except Exception as exc:
            self.import_error = str(exc)
            self.song_names = self._discover_songs()
            status_cb("Search model unavailable: {}".format(exc))
            progress_cb(100)
            return

        self._torch = torch
        self._librosa = librosa

        status_cb("Loading MuLan model...")
        progress_cb(0)
        self.mulan = MuQMuLan.from_pretrained("OpenMuQ/MuQ-MuLan-large")
        if torch.cuda.is_available():
            self.mulan = self.mulan.to("cuda")
        self.mulan = self.mulan.eval()

        self.song_names = self._discover_songs()
        total = len(self.song_names)
        if total == 0:
            status_cb("No songs found. Add files to songs folder.")
            progress_cb(100)
            return

        status_cb("Building/loading embeddings...")

        def process_song(song_name):
            song_path = os.path.join(self.songs_dir, song_name)
            file_hash = get_file_hash(song_path)
            cache_path = os.path.join(self.cache_dir, "{}.pt".format(file_hash))

            if os.path.exists(cache_path):
                embed = torch.load(cache_path, map_location="cpu", weights_only=True)
                return song_name, embed, "cached"

            wav, _ = librosa.load(song_path, sr=24000)
            wavs = torch.tensor(wav).unsqueeze(0)
            if torch.cuda.is_available():
                wavs = wavs.to("cuda")

            with self._model_lock:
                with torch.no_grad():
                    embed = self.mulan(wavs=wavs)

            embed_cpu = embed.detach().cpu()
            torch.save(embed_cpu, cache_path)
            return song_name, embed_cpu, "extracted"

        max_workers = max(1, min(4, os.cpu_count() or 2))
        completed = 0
        with ThreadPoolExecutor(max_workers=max_workers) as executor:
            futures = [executor.submit(process_song, song_name) for song_name in self.song_names]
            for future in as_completed(futures):
                song_name, embed, mode = future.result()
                self.audio_embeddings[song_name] = embed
                completed += 1
                progress_cb(int(completed / total * 100))
                label = "Loaded cached" if mode == "cached" else "Embedded"
                status_cb("{}: {}".format(label, song_name))

        status_cb("Ready")
        progress_cb(100)

    def find_similar_for_song(self, song_name):
        if song_name not in self.audio_embeddings:
            return []
        return self._rank(self.audio_embeddings[song_name])

    def find_similar_for_text(self, text):
        if not self.mulan or not self._torch:
            return []
        with self._torch.no_grad():
            text_embed = self.mulan(texts=[text])
        return self._rank(text_embed.detach().cpu())

    def _rank(self, target_embed):
        if not self.mulan:
            return []
        ranked = []
        for song_name, embed in self.audio_embeddings.items():
            score = self.mulan.calc_similarity(target_embed, embed).item()
            ranked.append((float(score), song_name))
        ranked.sort(key=lambda item: item[0], reverse=True)
        return ranked

    def _discover_songs(self):
        if not os.path.isdir(self.songs_dir):
            return []
        names = []
        for name in os.listdir(self.songs_dir):
            path = os.path.join(self.songs_dir, name)
            if os.path.isfile(path) and name.lower().endswith(SUPPORTED_AUDIO_EXT):
                names.append(name)
        names.sort(key=lambda value: value.lower())
        return names


class RootView(BoxLayout):
    status_text = StringProperty("Initializing...")
    progress_value = NumericProperty(0)
    song_names = ListProperty([])
    playlist_names = ListProperty([])
    search_enabled = BooleanProperty(False)

    def __init__(self, **kwargs):
        super().__init__(**kwargs)
        self.queue = []
        self.queue_index = -1
        self.selected_songs = set()

        self.current_song = None
        self.current_sound = None
        self._stop_initiated_by_user = False

        self.sleep_event = None

        self.songs_dir = self._resolve_songs_dir()
        self.data_dir = os.path.join(App.get_running_app().user_data_dir, "data")
        os.makedirs(self.data_dir, exist_ok=True)
        self.playlists_path = os.path.join(self.data_dir, "playlists.json")
        cache_dir = os.path.join(App.get_running_app().user_data_dir, "embeddings_cache")

        self.embedder = EmbedderEngine(self.songs_dir, cache_dir)

        Clock.schedule_once(lambda _dt: self._init_after_kv(), 0)

    def _init_after_kv(self):
        self._load_playlists()
        self._start_background_loading()

    def _resolve_songs_dir(self):
        env_dir = os.environ.get("MUSIC2VEC_SONGS_DIR")
        if env_dir and os.path.isdir(env_dir):
            return env_dir

        here = os.path.dirname(os.path.abspath(__file__))
        candidate = os.path.abspath(os.path.join(here, "..", "songs"))
        if os.path.isdir(candidate):
            return candidate

        local = os.path.join(here, "songs")
        return local

    def _start_background_loading(self):
        self._set_status("Loading songs and model...")

        def worker():
            self.embedder.load_all(self._set_status_threadsafe, self._set_progress_threadsafe)
            Clock.schedule_once(lambda _dt: self._on_library_loaded(), 0)

        threading.Thread(target=worker, daemon=True).start()

    def _on_library_loaded(self):
        self.song_names = list(self.embedder.song_names)
        self.ids.song_spinner.values = self.song_names
        if self.song_names:
            self.ids.song_spinner.text = self.song_names[0]

        self.search_enabled = self.embedder.mulan is not None
        self.ids.find_song_btn.disabled = not self.search_enabled
        self.ids.find_text_btn.disabled = not self.search_enabled

        self._render_library()
        self._render_queue()

        if not self.search_enabled and self.embedder.import_error:
            self._set_status("Playback ready. Search unavailable: {}".format(self.embedder.import_error))
        elif not self.song_names:
            self._set_status("No songs found. Put files in {}".format(self.songs_dir))
        else:
            self._set_status("Ready")

    def _set_status(self, text):
        self.status_text = text
        self.ids.status_label.text = text

    def _set_status_threadsafe(self, text):
        Clock.schedule_once(lambda _dt: self._set_status(text), 0)

    def _set_progress_threadsafe(self, value):
        Clock.schedule_once(lambda _dt: self._set_progress(value), 0)

    def _set_progress(self, value):
        self.progress_value = value
        self.ids.progress_bar.value = value

    def _render_library(self):
        layout = self.ids.library_layout
        layout.clear_widgets()

        for song_name in self.song_names:
            row = BoxLayout(size_hint_y=None, height=dp(34), spacing=dp(6))
            checkbox = CheckBox(size_hint_x=None, width=dp(30))
            checkbox.active = song_name in self.selected_songs
            checkbox.bind(active=lambda instance, active, name=song_name: self._set_selected(name, active))

            song_button = Button(text=song_name, halign="left")
            song_button.bind(on_release=lambda _instance, name=song_name: self.play_song(name))

            add_btn = Button(text="+Q", size_hint_x=None, width=dp(54))
            add_btn.bind(on_release=lambda _instance, name=song_name: self.add_song_to_queue(name))

            row.add_widget(checkbox)
            row.add_widget(song_button)
            row.add_widget(add_btn)
            layout.add_widget(row)

    def _set_selected(self, song_name, active):
        if active:
            self.selected_songs.add(song_name)
        else:
            self.selected_songs.discard(song_name)

    def _render_queue(self):
        layout = self.ids.queue_layout
        layout.clear_widgets()

        for index, song_name in enumerate(self.queue):
            row = BoxLayout(size_hint_y=None, height=dp(34), spacing=dp(6))
            prefix = "> " if index == self.queue_index else ""
            text = "{}{}. {}".format(prefix, index + 1, song_name)
            play_btn = Button(text=text)
            play_btn.bind(on_release=lambda _instance, idx=index: self.play_queue_index(idx))

            remove_btn = Button(text="Remove", size_hint_x=None, width=dp(90))
            remove_btn.bind(on_release=lambda _instance, idx=index: self.remove_queue_index(idx))

            row.add_widget(play_btn)
            row.add_widget(remove_btn)
            layout.add_widget(row)

    def _render_results(self, ranked_items):
        layout = self.ids.results_layout
        layout.clear_widgets()

        for score, song_name in ranked_items[:50]:
            row = BoxLayout(size_hint_y=None, height=dp(34), spacing=dp(6))
            caption = "{} ({:.4f})".format(song_name, score)
            play_btn = Button(text=caption)
            play_btn.bind(on_release=lambda _instance, name=song_name: self.play_song(name))

            queue_btn = Button(text="+Q", size_hint_x=None, width=dp(54))
            queue_btn.bind(on_release=lambda _instance, name=song_name: self.add_song_to_queue(name))

            row.add_widget(play_btn)
            row.add_widget(queue_btn)
            layout.add_widget(row)

    def toggle_selected_song(self):
        song_name = self.ids.song_spinner.text
        if song_name and song_name in self.song_names:
            self.toggle_play_pause(song_name)

    def play_song(self, song_name):
        if not song_name:
            return

        path = os.path.join(self.songs_dir, song_name)
        if not os.path.exists(path):
            self._set_status("Missing file: {}".format(song_name))
            return

        if self.current_sound is not None:
            self._stop_initiated_by_user = True
            self.current_sound.stop()

        sound = SoundLoader.load(path)
        if sound is None:
            self._set_status("Unable to play: {}".format(song_name))
            return

        sound.bind(on_stop=self._on_sound_stop)
        sound.play()

        self.current_sound = sound
        self.current_song = song_name
        self._set_status("Playing: {}".format(song_name))

    def toggle_play_pause(self, song_name):
        if self.current_song != song_name:
            self.play_song(song_name)
            return

        if self.current_sound is None:
            self.play_song(song_name)
            return

        if self.current_sound.state == "play":
            self.current_sound.stop()
            self._set_status("Stopped: {}".format(song_name))
            return

        self.play_song(song_name)

    def _on_sound_stop(self, _sound):
        if self._stop_initiated_by_user:
            self._stop_initiated_by_user = False
            return

        if self.queue_index >= 0 and self.queue_index + 1 < len(self.queue):
            self.queue_index += 1
            self._render_queue()
            next_song = self.queue[self.queue_index]
            Clock.schedule_once(lambda _dt: self.play_song(next_song), 0)
        else:
            self.current_song = None
            self.current_sound = None
            self._set_status("Playback finished")

    def add_song_to_queue(self, song_name):
        if not song_name:
            return
        self.queue.append(song_name)
        self._render_queue()
        self._set_status("Queued: {}".format(song_name))

    def add_selected_to_queue(self):
        selected = [name for name in self.song_names if name in self.selected_songs]
        if not selected:
            self._set_status("No songs selected")
            return

        self.queue.extend(selected)
        self._render_queue()
        self._set_status("Added {} songs to queue".format(len(selected)))

    def play_queue_from_start(self):
        if not self.queue:
            self._set_status("Queue is empty")
            return

        self.queue_index = 0
        self._render_queue()
        self.play_song(self.queue[0])

    def play_queue_index(self, index):
        if index < 0 or index >= len(self.queue):
            return

        self.queue_index = index
        self._render_queue()
        self.play_song(self.queue[index])

    def remove_queue_index(self, index):
        if index < 0 or index >= len(self.queue):
            return

        removed = self.queue.pop(index)
        if self.queue_index >= len(self.queue):
            self.queue_index = len(self.queue) - 1
        self._render_queue()
        self._set_status("Removed from queue: {}".format(removed))

    def clear_queue(self):
        self.queue = []
        self.queue_index = -1
        self._render_queue()
        self._set_status("Queue cleared")

    def find_similar_by_song(self):
        if not self.search_enabled:
            self._set_status("Search model unavailable")
            return

        song_name = self.ids.song_spinner.text
        if song_name not in self.embedder.audio_embeddings:
            self._set_status("Choose a valid song")
            return

        ranked = self.embedder.find_similar_for_song(song_name)
        self._render_results(ranked)
        self._set_status("Found {} matches".format(len(ranked)))

    def find_similar_by_text(self):
        if not self.search_enabled:
            self._set_status("Search model unavailable")
            return

        text = self.ids.text_search_input.text.strip()
        if not text:
            self._set_status("Enter search text")
            return

        self._set_status("Embedding text...")

        def worker():
            ranked = self.embedder.find_similar_for_text(text)
            Clock.schedule_once(lambda _dt: self._finish_text_search(ranked), 0)

        threading.Thread(target=worker, daemon=True).start()

    def _finish_text_search(self, ranked):
        self._render_results(ranked)
        self._set_status("Found {} matches".format(len(ranked)))

    def _load_playlists(self):
        playlists = self._read_playlists()
        self.playlist_names = sorted(playlists.keys())
        self.ids.playlist_spinner.values = self.playlist_names
        if self.playlist_names:
            self.ids.playlist_spinner.text = self.playlist_names[0]

    def _read_playlists(self):
        if not os.path.exists(self.playlists_path):
            return {}
        try:
            with open(self.playlists_path, "r", encoding="utf-8") as file_handle:
                data = json.load(file_handle)
            if isinstance(data, dict):
                return {str(key): list(value) for key, value in data.items()}
        except Exception:
            return {}
        return {}

    def _write_playlists(self, playlists):
        with open(self.playlists_path, "w", encoding="utf-8") as file_handle:
            json.dump(playlists, file_handle, indent=2)

    def save_playlist(self):
        name = self.ids.playlist_name_input.text.strip()
        if not name:
            self._set_status("Enter a playlist name")
            return
        if not self.queue:
            self._set_status("Queue is empty")
            return

        playlists = self._read_playlists()
        playlists[name] = list(self.queue)
        self._write_playlists(playlists)
        self._load_playlists()
        self._set_status("Saved playlist: {}".format(name))

    def load_playlist(self, replace_queue):
        name = self.ids.playlist_spinner.text
        playlists = self._read_playlists()
        songs = playlists.get(name)
        if not songs:
            self._set_status("Playlist is empty or missing")
            return

        valid = [song for song in songs if song in self.song_names]
        if replace_queue:
            self.queue = valid
            self.queue_index = -1
        else:
            self.queue.extend(valid)

        self._render_queue()
        self._set_status("Loaded playlist: {}".format(name))

    def start_sleep_timer(self):
        value = self.ids.sleep_minutes_input.text.strip()
        if not value:
            self._set_status("Enter timer minutes")
            return

        minutes = int(value)
        if minutes <= 0:
            self._set_status("Timer must be greater than 0")
            return

        self.cancel_sleep_timer(silent=True)
        seconds = minutes * 60
        self.sleep_event = Clock.schedule_once(lambda _dt: self._sleep_timer_triggered(), seconds)
        self._set_status("Sleep timer set for {} minute(s)".format(minutes))

    def cancel_sleep_timer(self, silent=False):
        if self.sleep_event is not None:
            self.sleep_event.cancel()
            self.sleep_event = None
            if not silent:
                self._set_status("Sleep timer canceled")

    def _sleep_timer_triggered(self):
        self.sleep_event = None
        if self.current_sound is not None:
            self._stop_initiated_by_user = True
            self.current_sound.stop()
        self.current_song = None
        self.current_sound = None
        self._set_status("Sleep timer stopped playback")


class Music2VecAndroidApp(App):
    def build(self):
        Builder.load_string(KV)
        return RootView()


if __name__ == "__main__":
    Music2VecAndroidApp().run()
