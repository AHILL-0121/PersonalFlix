import os
import subprocess
import json
import io
from google.oauth2 import service_account
from googleapiclient.discovery import build
from googleapiclient.http import MediaIoBaseDownload, MediaFileUpload

SCOPES = ["https://www.googleapis.com/auth/drive"]
FILE_ID = os.environ["FILE_ID"]
FILE_NAME = os.environ["FILE_NAME"]
# ID of the empty placeholder file created by Apps Script (owned by the user).
# The SA updates this file's content — quota is charged to the file owner (user), not the SA.
PLACEHOLDER_ID = os.environ.get("PLACEHOLDER_ID", "").strip()

if not PLACEHOLDER_ID:
    raise SystemExit(
        "\n\nERROR: PLACEHOLDER_ID is empty.\n"
        "This job was dispatched by an OLD version of the Poller.\n\n"
        "ACTION REQUIRED:\n"
        "  1. Open your Google Apps Script project (script.google.com)\n"
        "  2. Replace the script with the latest Poller.gs from .github/workflows/Poller.gs\n"
        "  3. Save — the next poll will dispatch with a valid PLACEHOLDER_ID\n"
    )

creds = service_account.Credentials.from_service_account_file("sa_key.json", scopes=SCOPES)
drive = build("drive", "v3", credentials=creds)

local_mkv = "input.mkv"
local_mp4 = "output.mp4"
base_name = os.path.splitext(FILE_NAME)[0]

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
sidecar_srt_files = []  # list of local srt paths (SA can't upload these, so just log)

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
        local_srt = f"sub_{idx}.srt"
        res = subprocess.run(
            ["ffmpeg", "-i", local_mkv, "-map", f"0:{stream_index}", local_srt],
            capture_output=True, text=True,
        )
        if res.returncode == 0 and os.path.exists(local_srt):
            sidecar_srt_files.append(local_srt)
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

# ── 4. Upload: UPDATE the placeholder file (owned by user → user's quota) ────
#
# Key insight: drive.files().update() replaces the CONTENT of an existing file.
# Google charges storage to the FILE OWNER (the user who created the placeholder
# in Apps Script). The SA has zero personal quota but can still write *content*
# to a file it has editor access to — it just can't own storage.
#
print(f"Uploading MP4 by updating placeholder {PLACEHOLDER_ID}…")
media = MediaFileUpload(local_mp4, mimetype="video/mp4", resumable=True)
drive.files().update(
    fileId=PLACEHOLDER_ID,
    media_body=media,
    supportsAllDrives=True,
    fields="id,name,size",
).execute()
print(f"✓ MP4 uploaded to file ID: {PLACEHOLDER_ID}")

if sidecar_srt_files:
    print(
        f"NOTE: {len(sidecar_srt_files)} SRT sidecar file(s) were extracted but cannot be "
        "uploaded via the SA. Re-upload them manually or extend the Poller to create SRT placeholders."
    )

# ── 5. Delete the original MKV (metadata op — no quota needed) ───────────────
drive.files().delete(fileId=FILE_ID, supportsAllDrives=True).execute()
print(f"Deleted original MKV {FILE_ID}")
