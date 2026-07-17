import os
import subprocess
import json
import math
import requests
import io
from google.oauth2 import service_account
from googleapiclient.discovery import build
from googleapiclient.http import MediaIoBaseDownload

SCOPES = ["https://www.googleapis.com/auth/drive.readonly"]  # SA only needs read to download
FILE_ID = os.environ["FILE_ID"]
FILE_NAME = os.environ["FILE_NAME"]
# Pre-authorized resumable upload URL created by Apps Script (runs as the user,
# so the upload lands in the user's Drive quota — not the SA's).
MP4_UPLOAD_URL = os.environ.get("MP4_UPLOAD_URL", "").strip()
# Optional comma-separated list of pre-authorized SRT upload URLs (index = track index)
SRT_UPLOAD_URLS = [u for u in os.environ.get("SRT_UPLOAD_URLS", "").split(",") if u.strip()]

if not MP4_UPLOAD_URL:
    raise SystemExit(
        "\n\nERROR: MP4_UPLOAD_URL is empty.\n"
        "This job was dispatched by an OLD version of the Poller that does not\n"
        "generate pre-authorized upload URLs.\n\n"
        "ACTION REQUIRED:\n"
        "  1. Open your Google Apps Script project (script.google.com)\n"
        "  2. Replace Poller.gs with the new version from .github/workflows/Poller.gs\n"
        "  3. Save and re-deploy the Apps Script\n"
        "  4. The next poll will dispatch with a valid MP4_UPLOAD_URL\n"
    )

# SA credentials — used ONLY for downloading the source MKV and deleting it afterwards.
# We use a separate key with write scope just for the delete call.
_sa_creds_ro = service_account.Credentials.from_service_account_file(
    "sa_key.json", scopes=["https://www.googleapis.com/auth/drive"]
)
drive = build("drive", "v3", credentials=_sa_creds_ro)

local_mkv = "input.mkv"
local_mp4 = "output.mp4"
base_name = os.path.splitext(FILE_NAME)[0]

CHUNK = 50 * 1024 * 1024  # 50 MB upload chunks


def upload_via_resumable_url(upload_url: str, file_path: str, label: str = "file") -> None:
    """
    Upload a local file to a Google Drive resumable upload URL.
    The session was initiated by the user's Apps Script, so quota is charged
    to the user's Google account — not the service account.
    """
    size = os.path.getsize(file_path)
    print(f"  Uploading {label} ({size / (1024 ** 2):.1f} MB) in {math.ceil(size / CHUNK)} chunk(s)")
    uploaded = 0
    with open(file_path, "rb") as f:
        while uploaded < size:
            chunk = f.read(CHUNK)
            chunk_len = len(chunk)
            end = uploaded + chunk_len - 1
            headers = {
                "Content-Length": str(chunk_len),
                "Content-Range": f"bytes {uploaded}-{end}/{size}",
            }
            resp = requests.put(upload_url, headers=headers, data=chunk, timeout=600)
            if resp.status_code in (200, 201):
                file_id = resp.json().get("id", "?")
                print(f"  ✓ {label} uploaded. Drive file ID: {file_id}")
                return
            elif resp.status_code == 308:
                # Resume Incomplete — server ACKed up to some byte
                rng = resp.headers.get("Range", "")
                uploaded = int(rng.split("-")[1]) + 1 if rng else end + 1
                print(f"  {uploaded / size * 100:.1f}% uploaded…")
            else:
                raise RuntimeError(
                    f"Upload of {label} failed: HTTP {resp.status_code}\n{resp.text[:500]}"
                )
    raise RuntimeError(f"Upload loop for {label} ended without 200/201")


# ── 1. Download the MKV ───────────────────────────────────────────────────────
print(f"Downloading {FILE_NAME} ({FILE_ID})")
request = drive.files().get_media(fileId=FILE_ID, supportsAllDrives=True)
with io.FileIO(local_mkv, "wb") as fh:
    downloader = MediaIoBaseDownload(fh, request)
    done = False
    while not done:
        status, done = downloader.next_chunk()
        if status:
            print(f"  {int(status.progress() * 100)}%")

# ── 2. Probe streams ──────────────────────────────────────────────────────────
probe = subprocess.run(
    ["ffprobe", "-v", "quiet", "-print_format", "json", "-show_streams", local_mkv],
    capture_output=True, text=True,
)
streams = json.loads(probe.stdout).get("streams", [])
sub_streams = [s for s in streams if s.get("codec_type") == "subtitle"]
sub_codecs = {s.get("codec_name") for s in sub_streams}

print(f"Subtitle codecs found: {sub_codecs}")

mp4_incompatible = sub_codecs & {"ass", "ssa", "hdmv_pgs_subtitle", "dvd_subtitle"}
sidecar_srt_files = []  # list of (local_path, upload_url_index)

if not sub_streams:
    cmd = [
        "ffmpeg", "-i", local_mkv,
        "-map", "0:v", "-map", "0:a",
        "-c:v", "copy", "-c:a", "aac", "-b:a", "192k",
        "-movflags", "+faststart",
        local_mp4,
    ]
elif mp4_incompatible:
    print("Incompatible subtitle format — extracting sidecar SRT files")
    for idx, s in enumerate(sub_streams):
        stream_index = s["index"]
        lang = s.get("tags", {}).get("language", f"track{idx}")
        local_srt = f"sub_{idx}.srt"
        res = subprocess.run(
            ["ffmpeg", "-i", local_mkv, "-map", f"0:{stream_index}", local_srt],
            capture_output=True, text=True,
        )
        if res.returncode == 0 and os.path.exists(local_srt):
            sidecar_srt_files.append((local_srt, idx))
        else:
            print(f"  Could not extract track {stream_index} ({s.get('codec_name')}), skipping")

    cmd = [
        "ffmpeg", "-i", local_mkv,
        "-map", "0:v", "-map", "0:a",
        "-c:v", "copy", "-c:a", "aac", "-b:a", "192k",
        "-movflags", "+faststart",
        local_mp4,
    ]
else:
    # SRT-compatible: mux as soft subtitle track (mov_text)
    cmd = [
        "ffmpeg", "-i", local_mkv,
        "-map", "0:v", "-map", "0:a", "-map", "0:s?",
        "-c:v", "copy", "-c:a", "aac", "-b:a", "192k",
        "-c:s", "mov_text",
        "-movflags", "+faststart",
        local_mp4,
    ]

# ── 3. Convert ───────────────────────────────────────────────────────────────
print("Running:", " ".join(cmd))
result = subprocess.run(cmd, capture_output=True, text=True)
if result.returncode != 0:
    print(result.stderr)
    print("Copy failed, retrying with video re-encode")
    cmd = [
        "ffmpeg", "-i", local_mkv,
        "-map", "0:v", "-map", "0:a",
        "-c:v", "libx264", "-preset", "medium", "-crf", "20",
        "-c:a", "aac", "-b:a", "192k",
        "-movflags", "+faststart",
        local_mp4,
    ]
    subprocess.run(cmd, check=True)

# ── 4. Upload MP4 via pre-signed user URL (no SA quota used) ─────────────────
print("Uploading converted MP4…")
upload_via_resumable_url(MP4_UPLOAD_URL, local_mp4, label=f"{base_name}.mp4")

# ── 4b. Upload sidecar SRT files (if upload URLs were provided) ───────────────
for local_srt, url_idx in sidecar_srt_files:
    if url_idx < len(SRT_UPLOAD_URLS):
        upload_via_resumable_url(SRT_UPLOAD_URLS[url_idx], local_srt, label=local_srt)
    else:
        print(f"  WARNING: no upload URL for sidecar {local_srt} (url_idx={url_idx}), skipping")

# ── 5. Delete the original MKV using the SA (delete = metadata op, no quota) ─
drive.files().delete(fileId=FILE_ID, supportsAllDrives=True).execute()
print(f"Deleted original MKV {FILE_ID}")
