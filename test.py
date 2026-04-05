import os
from typing import Any, Dict, List, Optional

import yt_dlp


# Optional auth env vars (same pattern as backend):
# - YTDLP_COOKIES_FILE
# - YTDLP_COOKIES_FROM_BROWSER (e.g. chrome or chrome,Default)
# - YTDLP_USER_AGENT
YTDLP_COOKIES_FILE = os.getenv("YTDLP_COOKIES_FILE", "").strip()
YTDLP_COOKIES_FROM_BROWSER = os.getenv("YTDLP_COOKIES_FROM_BROWSER", "").strip()
YTDLP_USER_AGENT = os.getenv("YTDLP_USER_AGENT", "").strip()

PERMANENT_YTDLP_ERROR_HINTS = [
	"this video is not available",
	"private video",
	"members-only",
	"video unavailable",
	"has been removed",
]


def with_yt_dlp_auth(base_opts: Dict[str, Any]) -> Dict[str, Any]:
	opts = dict(base_opts)

	if YTDLP_COOKIES_FILE and os.path.exists(YTDLP_COOKIES_FILE):
		opts["cookiefile"] = YTDLP_COOKIES_FILE
	elif YTDLP_COOKIES_FROM_BROWSER:
		browser_parts = [p.strip() for p in YTDLP_COOKIES_FROM_BROWSER.split(",") if p.strip()]
		if browser_parts:
			opts["cookiesfrombrowser"] = tuple(browser_parts)

	if YTDLP_USER_AGENT:
		opts["http_headers"] = {
			**opts.get("http_headers", {}),
			"User-Agent": YTDLP_USER_AGENT,
		}

	return opts


def yt_dlp_extract_info(url: str, base_opts: Dict[str, Any], download: bool):
	"""Run yt-dlp with auth fallbacks similar to the backend."""
	attempts: List[Dict[str, Any]] = []
	attempts.append(with_yt_dlp_auth(base_opts))

	if not YTDLP_COOKIES_FILE and not YTDLP_COOKIES_FROM_BROWSER:
		for browser in ("chrome", "edge", "firefox"):
			alt = dict(base_opts)
			alt["cookiesfrombrowser"] = (browser,)
			if YTDLP_USER_AGENT:
				alt["http_headers"] = {
					**alt.get("http_headers", {}),
					"User-Agent": YTDLP_USER_AGENT,
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
				raise

	if last_error:
		raise last_error
	raise RuntimeError("yt-dlp failed without a captured exception")


def normalize_to_watch_url(input_text: str) -> str:
	text = input_text.strip()
	if "youtube.com/watch" in text or "youtu.be/" in text:
		if "youtu.be/" in text:
			yt_id = text.split("youtu.be/")[1].split("?")[0]
			return f"https://www.youtube.com/watch?v={yt_id}"
		return text

	# Plain 11-char YouTube ID.
	if len(text) == 11 and all(c.isalnum() or c in "_-" for c in text):
		return f"https://www.youtube.com/watch?v={text}"

	# Treat as search query and pick top result.
	info = yt_dlp_extract_info(
		f"ytsearch1:{text}",
		{
			"extract_flat": True,
			"quiet": True,
			"no_warnings": True,
			"ignoreerrors": True,
			"skip_download": True,
		},
		download=False,
	)
	entries = info.get("entries", []) if info else []
	if not entries or not entries[0] or not entries[0].get("id"):
		raise RuntimeError("No YouTube match found for query")
	return f"https://www.youtube.com/watch?v={entries[0]['id']}"


def download_one_song(input_text: str, output_dir: str = "downloads") -> None:
	os.makedirs(output_dir, exist_ok=True)
	watch_url = normalize_to_watch_url(input_text)

	base_opts = {
		"postprocessors": [
			{
				"key": "FFmpegExtractAudio",
				"preferredcodec": "mp3",
				"preferredquality": "128",
			}
		],
		"outtmpl": os.path.join(output_dir, "%(title).120s [%(id)s].%(ext)s"),
		"quiet": False,
		"no_warnings": True,
		"postprocessor_args": ["-ar", "24000", "-ac", "1"],
		"noplaylist": True,
		"retries": 2,
		"fragment_retries": 2,
		"sleep_interval": 1,
		"max_sleep_interval": 3,
	}

	# Same fallback idea as backend for format availability issues.
	format_attempts = [
		"bestaudio[ext=m4a]/bestaudio/best",
		"bestaudio/best",
		"bestaudio*/best",
		"best",
	]

	last_error: Optional[Exception] = None
	for fmt in format_attempts:
		try:
			opts = {**base_opts, "format": fmt}
			info = yt_dlp_extract_info(watch_url, opts, download=True)
			title = info.get("title") if isinstance(info, dict) else None
			print(f"Downloaded: {title or watch_url}")
			return
		except Exception as e:
			last_error = e
			print(f"Format '{fmt}' failed: {e}")

	raise RuntimeError(f"Failed to download song after all format attempts: {last_error}")


if __name__ == "__main__":
	# Examples:
	#   python test.py "https://www.youtube.com/watch?v=dQw4w9WgXcQ"
	#   python test.py "dQw4w9WgXcQ"
	#   python test.py "Daft Punk One More Time"
	import sys

	if len(sys.argv) < 2:
		raise SystemExit("Usage: python test.py <youtube_url|youtube_id|search_query>")

	user_input = " ".join(sys.argv[1:]).strip()
	download_one_song(user_input)
