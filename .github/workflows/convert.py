import os
import subprocess
import json
from google.oauth2 import service_account
from googleapiclient.discovery import build
from googleapiclient.http import MediaIoBaseDownload, MediaFileUpload
import io

SCOPES = ["https://www.googleapis.com/auth/drive"]
FILE_ID = os.environ["FILE_ID"]
FILE_NAME = os.environ["FILE_NAME"]
PARENT_ID = os.environ["PARENT_ID"]

creds = service_account.Credentials.from_service_account_file("sa_key.json", scopes=SCOPES)
drive = build("drive", "v3", credentials=creds)

local_mkv = "input.mkv"
local_mp4 = "output.mp4"
base_name = os.path.splitext(FILE_NAME)[0]

# 1. Download the mkv
print(f"Downloading {FILE_NAME} ({FILE_ID})")
request = drive.files().get_media(fileId=FILE_ID)
with io.FileIO(local_mkv, "wb") as fh:
    downloader = MediaIoBaseDownload(fh, request)
    done = False
    while not done:
        status, done = downloader.next_chunk()
        if status:
            print(f"  {int(status.progress() * 100)}%")

# 2. Inspect streams to decide subtitle handling
probe = subprocess.run(
    ["ffprobe", "-v", "quiet", "-print_format", "json", "-show_streams", local_mkv],
    capture_output=True, text=True
)
streams = json.loads(probe.stdout).get("streams", [])
sub_streams = [s for s in streams if s.get("codec_type") == "subtitle"]
sub_codecs = {s.get("codec_name") for s in sub_streams}

print(f"Subtitle codecs found: {sub_codecs}")

# mp4 supports mov_text (converted srt) natively. ass/ssa/pgs need special handling.
mp4_incompatible = sub_codecs & {"ass", "ssa", "hdmv_pgs_subtitle", "dvd_subtitle"}

sidecar_srt_files = []  # list of (local_path, drive_name) to upload alongside the mp4

if not sub_streams:
    # No subtitles, straightforward remux/convert
    cmd = [
        "ffmpeg", "-i", local_mkv,
        "-map", "0:v", "-map", "0:a",
        "-c:v", "copy", "-c:a", "aac", "-b:a", "192k",
        "-movflags", "+faststart",
        local_mp4
    ]
elif mp4_incompatible:
    # Extract each subtitle track as a standalone sidecar srt instead of burning in,
    # so subtitles stay toggleable in any player that supports external srt.
    print("Incompatible subtitle format detected, extracting sidecar srt files instead of burning in")
    for idx, s in enumerate(sub_streams):
        stream_index = s["index"]
        lang = s.get("tags", {}).get("language", f"track{idx}")
        srt_name = f"{base_name}.{lang}.srt" if len(sub_streams) > 1 else f"{base_name}.srt"
        local_srt = f"sub_{idx}.srt"
        extract_cmd = [
            "ffmpeg", "-i", local_mkv,
            "-map", f"0:{stream_index}",
            local_srt
        ]
        res = subprocess.run(extract_cmd, capture_output=True, text=True)
        if res.returncode == 0 and os.path.exists(local_srt):
            sidecar_srt_files.append((local_srt, srt_name))
        else:
            print(f"  Could not extract track {stream_index} ({s.get('codec_name')}) as srt, skipping")

    # Video/audio only, no embedded subtitle track in the mp4 itself
    cmd = [
        "ffmpeg", "-i", local_mkv,
        "-map", "0:v", "-map", "0:a",
        "-c:v", "copy", "-c:a", "aac", "-b:a", "192k",
        "-movflags", "+faststart",
        local_mp4
    ]
else:
    # SRT-compatible subs, mux as soft subtitle track (mov_text)
    cmd = [
        "ffmpeg", "-i", local_mkv,
        "-map", "0:v", "-map", "0:a", "-map", "0:s?",
        "-c:v", "copy", "-c:a", "aac", "-b:a", "192k",
        "-c:s", "mov_text",
        "-movflags", "+faststart",
        local_mp4
    ]

print("Running:", " ".join(cmd))
result = subprocess.run(cmd, capture_output=True, text=True)
if result.returncode != 0:
    print(result.stderr)
    # Fallback: if video copy fails (some HEVC/container quirks), re-encode video too
    print("Copy failed, retrying with video re-encode")
    cmd = [
        "ffmpeg", "-i", local_mkv,
        "-map", "0:v", "-map", "0:a",
        "-c:v", "libx264", "-preset", "medium", "-crf", "20",
        "-c:a", "aac", "-b:a", "192k",
        "-movflags", "+faststart",
        local_mp4
    ]
    subprocess.run(cmd, check=True)

# 3. Upload the mp4 to the same parent folder
print("Uploading converted file")
file_metadata = {"name": f"{base_name}.mp4", "parents": [PARENT_ID]}
media = MediaFileUpload(local_mp4, mimetype="video/mp4", resumable=True)
uploaded = drive.files().create(body=file_metadata, media_body=media, fields="id").execute()
print(f"Uploaded as {uploaded['id']}")

# 3b. Upload any sidecar srt files alongside it
for local_srt, drive_name in sidecar_srt_files:
    srt_metadata = {"name": drive_name, "parents": [PARENT_ID]}
    srt_media = MediaFileUpload(local_srt, mimetype="application/x-subrip", resumable=False)
    srt_uploaded = drive.files().create(body=srt_metadata, media_body=srt_media, fields="id").execute()
    print(f"Uploaded sidecar {drive_name} as {srt_uploaded['id']}")

# 4. Delete the original mkv
drive.files().delete(fileId=FILE_ID).execute()
print(f"Deleted original {FILE_ID}")
