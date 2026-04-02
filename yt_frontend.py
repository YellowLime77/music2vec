import sys
import requests
from PyQt6.QtWidgets import (QApplication, QMainWindow, QWidget, QVBoxLayout, 
                             QHBoxLayout, QComboBox, QLineEdit, QPushButton, 
                             QListWidget, QListWidgetItem, QLabel, QProgressBar, QTabWidget)
from PyQt6.QtCore import QTimer, Qt, QThread, pyqtSignal

API_BASE_URL = "http://127.0.0.1:8000"

class UploadThread(QThread):
    finished = pyqtSignal(dict)
    error = pyqtSignal(str)
    
    def __init__(self, query):
        super().__init__()
        self.query = query
        
    def run(self):
        try:
            resp = requests.post(f"{API_BASE_URL}/extract", json={"query": self.query}, timeout=300) # 5 min timeout for downloads
            resp.raise_for_status()
            self.finished.emit(resp.json())
        except Exception as e:
            self.error.emit(str(e))


class MusicAppClient(QMainWindow):
    def __init__(self):
        super().__init__()
        self.setWindowTitle("Music2Vec Explorer Client")
        self.resize(700, 500)
        self.song_names = {}
        self.temp_song_names = {}
        
        self.initUI()
        
        # Start checking backend status
        self.status_timer = QTimer()
        self.status_timer.timeout.connect(self.check_status)
        self.status_timer.start(1000)

    def initUI(self):
        central_widget = QWidget()
        self.setCentralWidget(central_widget)
        layout = QVBoxLayout(central_widget)

        self.status_label = QLabel("Connecting to Backend...")
        layout.addWidget(self.status_label)

        self.progress_bar = QProgressBar()
        self.progress_bar.setRange(0, 100)
        self.progress_bar.setValue(0)
        layout.addWidget(self.progress_bar)

        self.search_tabs = QTabWidget()

        song_tab = QWidget()
        song_layout = QVBoxLayout(song_tab)
        search_layout = QHBoxLayout()
        self.song_search_input = QLineEdit()
        self.song_search_input.setPlaceholderText("Search library...")
        self.song_search_input.textChanged.connect(self.filter_song_library)
        self.open_selected_btn = QPushButton("Open in YouTube")
        self.open_selected_btn.clicked.connect(self.open_selected_song_youtube)
        self.open_selected_btn.setEnabled(False)
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
        search_layout.addWidget(self.open_selected_btn)
        search_layout.addWidget(self.add_to_group_1_btn)
        search_layout.addWidget(self.add_to_group_2_btn)
        search_layout.addWidget(self.find_song_btn)
        song_layout.addLayout(search_layout)

        self.song_library_list = QListWidget()
        self.song_library_list.setSelectionMode(QListWidget.SelectionMode.ExtendedSelection)
        self.song_library_list.setMaximumHeight(120)
        song_layout.addWidget(self.song_library_list)

        song_group_row = QHBoxLayout()
        group1_layout = QVBoxLayout()
        group1_layout.addWidget(QLabel("Group 1:"))
        self.song_group_list_1 = QListWidget()
        self.song_group_list_1.setMaximumHeight(100)
        group1_layout.addWidget(self.song_group_list_1)
        group1_actions = QHBoxLayout()
        self.remove_group_song_1_btn = QPushButton("Remove")
        self.remove_group_song_1_btn.clicked.connect(lambda: self.remove_group_song(1))
        self.clear_group_1_btn = QPushButton("Clear")
        self.clear_group_1_btn.clicked.connect(lambda: self.clear_group_songs(1))
        group1_actions.addWidget(self.remove_group_song_1_btn)
        group1_actions.addWidget(self.clear_group_1_btn)
        group1_layout.addLayout(group1_actions)
        song_group_row.addLayout(group1_layout)

        group2_layout = QVBoxLayout()
        group2_layout.addWidget(QLabel("Group 2:"))
        self.song_group_list_2 = QListWidget()
        self.song_group_list_2.setMaximumHeight(100)
        group2_layout.addWidget(self.song_group_list_2)
        group2_actions = QHBoxLayout()
        self.remove_group_song_2_btn = QPushButton("Remove")
        self.remove_group_song_2_btn.clicked.connect(lambda: self.remove_group_song(2))
        self.clear_group_2_btn = QPushButton("Clear")
        self.clear_group_2_btn.clicked.connect(lambda: self.clear_group_songs(2))
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
        self.text_input.setPlaceholderText("Enter text description...")
        self.find_text_btn = QPushButton("Search by Text")
        self.find_text_btn.clicked.connect(self.find_similar_by_text)
        self.find_text_btn.setEnabled(False)
        text_layout.addWidget(self.text_input)
        text_layout.addWidget(self.find_text_btn)

        upload_tab = QWidget()
        upload_layout = QVBoxLayout(upload_tab)
        upload_input_layout = QHBoxLayout()
        self.YouTube_id_input = QLineEdit()
        self.YouTube_id_input.setPlaceholderText("Enter YouTube ID, URL, or Playlist URL...")
        upload_input_layout.addWidget(self.YouTube_id_input)
        self.upload_btn = QPushButton("Extract Embedding(s)")
        self.upload_btn.clicked.connect(self.upload_and_search)
        self.upload_btn.setEnabled(False)
        upload_input_layout.addWidget(self.upload_btn)
        upload_layout.addLayout(upload_input_layout)

        temp_actions_layout = QHBoxLayout()
        self.temp_add_group_btn = QPushButton("Add to Temp Group")
        self.temp_add_group_btn.clicked.connect(self.add_temp_to_group)
        self.temp_find_btn = QPushButton("Find Similar in Main Library")
        self.temp_find_btn.clicked.connect(self.find_similar_from_temp)
        temp_actions_layout.addWidget(self.temp_add_group_btn)
        temp_actions_layout.addWidget(self.temp_find_btn)
        upload_layout.addLayout(temp_actions_layout)

        temp_lists_layout = QHBoxLayout()
        temp_lib_layout = QVBoxLayout()
        temp_lib_layout.addWidget(QLabel("Temp Library:"))
        self.temp_library_list = QListWidget()
        self.temp_library_list.setSelectionMode(QListWidget.SelectionMode.ExtendedSelection)
        temp_lib_layout.addWidget(self.temp_library_list)
        temp_lists_layout.addLayout(temp_lib_layout)

        temp_group_layout = QVBoxLayout()
        temp_group_layout.addWidget(QLabel("Temp Group:"))
        self.temp_group_list = QListWidget()
        temp_group_layout.addWidget(self.temp_group_list)
        temp_group_actions = QHBoxLayout()
        self.temp_remove_group_btn = QPushButton("Remove")
        self.temp_remove_group_btn.clicked.connect(self.remove_temp_group_song)
        self.temp_clear_group_btn = QPushButton("Clear")
        self.temp_clear_group_btn.clicked.connect(self.clear_temp_group_songs)
        temp_group_actions.addWidget(self.temp_remove_group_btn)
        temp_group_actions.addWidget(self.temp_clear_group_btn)
        temp_group_layout.addLayout(temp_group_actions)
        temp_lists_layout.addLayout(temp_group_layout)
        upload_layout.addLayout(temp_lists_layout)

        self.search_tabs.addTab(song_tab, "Search by Song")
        self.search_tabs.addTab(text_tab, "Search by Text")
        self.search_tabs.addTab(upload_tab, "Add YouTube ID")
        layout.addWidget(self.search_tabs)

        layout.addWidget(QLabel("Similar Songs:"))
        results_layout = QHBoxLayout()
        self.results_list = QListWidget()
        self.results_list.itemDoubleClicked.connect(self.open_result_item_youtube)
        results_layout.addWidget(self.results_list)
        self.open_result_btn = QPushButton("Open in YouTube")
        self.open_result_btn.clicked.connect(self.open_selected_result_youtube)
        self.open_result_btn.setEnabled(False)
        results_layout.addWidget(self.open_result_btn)
        layout.addLayout(results_layout)

    def check_status(self):
        try:
            resp = requests.get(f"{API_BASE_URL}/status")
            if resp.status_code == 200:
                data = resp.json()
                self.progress_bar.setValue(data.get("progress", 0))
                self.status_label.setText(data.get("status", "Unknown Status"))
                
                if data.get("ready"):
                    self.status_timer.stop()
                    self.fetch_library()
        except requests.exceptions.RequestException:
            self.status_label.setText("Failed to connect to backend...")
            
    def fetch_library(self):
        try:
            resp = requests.get(f"{API_BASE_URL}/library")
            if resp.status_code == 200:
                data = resp.json()
                self.song_names = data.get("library", {})
                self.temp_song_names = data.get("temp_library", {})
                
                self.song_library_list.clear()
                
                for yt_id, display_name in self.song_names.items():
                    self._add_to_libraries(yt_id, display_name)
                    
                for yt_id, display_name in self.temp_song_names.items():
                    self._add_to_temp_library(yt_id, display_name)
                    
                has_songs = len(self.song_names) > 0
                self.find_song_btn.setEnabled(has_songs)
                self.find_text_btn.setEnabled(has_songs)
                self.open_selected_btn.setEnabled(has_songs)
                self.add_to_group_1_btn.setEnabled(has_songs)
                self.add_to_group_2_btn.setEnabled(has_songs)
                self.upload_btn.setEnabled(True)
        except Exception as e:
            self.status_label.setText(f"Error fetching library: {str(e)}")

    def _add_to_libraries(self, yt_id, display_name):
        item1 = QListWidgetItem(display_name)
        item1.setData(Qt.ItemDataRole.UserRole, yt_id)
        self.song_library_list.addItem(item1)
        
    def _add_to_temp_library(self, yt_id, display_name):
        item = QListWidgetItem(display_name)
        item.setData(Qt.ItemDataRole.UserRole, yt_id)
        self.temp_library_list.addItem(item)

    def filter_song_library(self, text):
        search_term = text.lower()
        for i in range(self.song_library_list.count()):
            item = self.song_library_list.item(i)
            item.setHidden(search_term not in item.text().lower())

    def get_group_song_names(self, group_index):
        list_widget = self.song_group_list_1 if group_index == 1 else self.song_group_list_2
        return [list_widget.item(i).data(Qt.ItemDataRole.UserRole) for i in range(list_widget.count())]

    def add_selected_song_to_group(self, group_index):
        selected_items = self.song_library_list.selectedItems()
        existing = set(self.get_group_song_names(group_index))
        list_widget = self.song_group_list_1 if group_index == 1 else self.song_group_list_2
        
        for item in selected_items:
            yt_id = item.data(Qt.ItemDataRole.UserRole)
            display_name = item.text()
            if yt_id and yt_id not in existing:
                group_item = QListWidgetItem(display_name)
                group_item.setData(Qt.ItemDataRole.UserRole, yt_id)
                list_widget.addItem(group_item)
                existing.add(yt_id)

    def remove_group_song(self, group_index):
        list_widget = self.song_group_list_1 if group_index == 1 else self.song_group_list_2
        row = list_widget.currentRow()
        if row >= 0:
            list_widget.takeItem(row)

    def clear_group_songs(self, group_index):
        list_widget = self.song_group_list_1 if group_index == 1 else self.song_group_list_2
        list_widget.clear()

    def add_temp_to_group(self):
        selected_items = self.temp_library_list.selectedItems()
        existing = set(self.temp_group_list.item(i).data(Qt.ItemDataRole.UserRole) for i in range(self.temp_group_list.count()))
        
        for item in selected_items:
            yt_id = item.data(Qt.ItemDataRole.UserRole)
            display_name = item.text()
            if yt_id and yt_id not in existing:
                group_item = QListWidgetItem(display_name)
                group_item.setData(Qt.ItemDataRole.UserRole, yt_id)
                self.temp_group_list.addItem(group_item)

    def remove_temp_group_song(self):
        row = self.temp_group_list.currentRow()
        if row >= 0:
            self.temp_group_list.takeItem(row)

    def clear_temp_group_songs(self):
        self.temp_group_list.clear()

    def load_results(self, results):
        self.results_list.clear()
        for res in results:
            sim = res["similarity"]
            name = res["display_name"]
            yt_id = res["yt_id"]
            
            item = QListWidgetItem(f"{name} (Similarity: {sim:.4f})")
            item.setData(Qt.ItemDataRole.UserRole, yt_id)
            self.results_list.addItem(item)

        has_results = self.results_list.count() > 0
        self.open_result_btn.setEnabled(has_results)
        if has_results:
            self.results_list.setCurrentRow(0)

    def find_similar_by_song(self):
        group1_songs = self.get_group_song_names(1)
        group2_songs = self.get_group_song_names(2)
        
        if not group1_songs and not group2_songs:
            selected_items = self.song_library_list.selectedItems()
            group1_songs = [item.data(Qt.ItemDataRole.UserRole) for item in selected_items if item.data(Qt.ItemDataRole.UserRole)]

        if not group1_songs and not group2_songs:
            self.status_label.setText("Select at least one song.")
            return

        self.status_label.setText("Searching...")
        QApplication.processEvents()
        
        try:
            req = {
                "group1": group1_songs,
                "group2": group2_songs,
                "algo": self.algo_combo.currentText(),
                "use_temp": False
            }
            resp = requests.post(f"{API_BASE_URL}/search/song", json=req)
            resp.raise_for_status()
            
            data = resp.json()
            self.load_results(data.get("results", []))
            self.status_label.setText("Ready!")
        except Exception as e:
            self.status_label.setText(f"Search failed: {str(e)}")

    def find_similar_from_temp(self):
        group_songs = [self.temp_group_list.item(i).data(Qt.ItemDataRole.UserRole) for i in range(self.temp_group_list.count())]
        if not group_songs:
            selected_items = self.temp_library_list.selectedItems()
            group_songs = [item.data(Qt.ItemDataRole.UserRole) for item in selected_items if item.data(Qt.ItemDataRole.UserRole)]

        if not group_songs:
            self.status_label.setText("Select at least one temp song.")
            return

        self.status_label.setText("Searching...")
        QApplication.processEvents()
        
        try:
            req = {
                "group1": group_songs,
                "group2": [],
                "algo": self.algo_combo.currentText(),
                "use_temp": True
            }
            resp = requests.post(f"{API_BASE_URL}/search/song", json=req)
            resp.raise_for_status()
            
            data = resp.json()
            self.load_results(data.get("results", []))
            self.status_label.setText("Ready!")
        except Exception as e:
            self.status_label.setText(f"Temp search failed: {str(e)}")

    def find_similar_by_text(self):
        text = self.text_input.text().strip()
        if not text:
            return
            
        self.status_label.setText("Searching text...")
        QApplication.processEvents()
        
        try:
            resp = requests.post(f"{API_BASE_URL}/search/text", json={"text": text})
            resp.raise_for_status()
            
            data = resp.json()
            self.load_results(data.get("results", []))
            self.status_label.setText("Ready!")
        except Exception as e:
            self.status_label.setText(f"Text search failed: {str(e)}")

    def upload_and_search(self):
        text = self.YouTube_id_input.text().strip()
        if not text:
            return
            
        self.status_label.setText(f"Extracting embedding for {text} (this may take a while)...")
        self.upload_btn.setEnabled(False)
        QApplication.processEvents()
        
        self.upload_thread = UploadThread(text)
        self.upload_thread.finished.connect(self.on_upload_finished)
        self.upload_thread.error.connect(self.on_upload_error)
        self.upload_thread.start()

    def on_upload_finished(self, data):
        self.upload_btn.setEnabled(True)
        count = data.get("processed", 0)
        extracted = data.get("extracted", [])
        
        for item in extracted:
            yt_id = item["yt_id"]
            display_name = item["display_name"]
            self._add_to_temp_library(yt_id, display_name)
            self.temp_song_names[yt_id] = display_name
            
        self.status_label.setText(f"Added {count} song(s) to temp library.")

    def on_upload_error(self, err_msg):
        self.upload_btn.setEnabled(True)
        self.status_label.setText(f"Upload failed: {err_msg}")

    def open_youtube_link(self, yt_id):
        if yt_id:
            import webbrowser
            webbrowser.open(f'https://www.youtube.com/watch?v={yt_id}')
            display_name = self.song_names.get(yt_id, yt_id)
            self.status_label.setText(f"Opened in YouTube: {display_name}")

    def open_selected_song_youtube(self):
        selected_items = self.song_library_list.selectedItems()
        if selected_items:
            yt_id = selected_items[0].data(Qt.ItemDataRole.UserRole)
            self.open_youtube_link(yt_id)

    def open_selected_result_youtube(self):
        item = self.results_list.currentItem()
        if item is None:
            return
        yt_id = item.data(Qt.ItemDataRole.UserRole)
        self.open_youtube_link(yt_id)

    def open_result_item_youtube(self, item):
        if item is None:
            return
        yt_id = item.data(Qt.ItemDataRole.UserRole)
        self.open_youtube_link(yt_id)

if __name__ == '__main__':
    import sys
    app = QApplication(sys.argv)
    window = MusicAppClient()
    window.show()
    sys.exit(app.exec())
