require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { spawn, execFile } = require('child_process');
const { google } = require('googleapis');
const ffmpegStatic = require('ffmpeg-static');
const ffprobeStatic = require('ffprobe-static');

const app = express();
app.use(cors());

// ── Google Drive Auth helper ──────────────────────────────────────────────────
let _driveClient = null;
let _tokenExpiry = 0;

async function getDriveClient() {
    if (_driveClient && Date.now() < _tokenExpiry) {
        return _driveClient;
    }

    const keyJson = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
    if (!keyJson) throw new Error("Missing GOOGLE_SERVICE_ACCOUNT_KEY env var");

    const { client_email, private_key } = JSON.parse(keyJson);
    const auth = new google.auth.JWT(
        client_email, null, private_key,
        ['https://www.googleapis.com/auth/drive.readonly']
    );

    const drive = google.drive({ version: 'v3', auth });
    _driveClient = drive;
    _tokenExpiry = Date.now() + 3_500_000; // ~58 min
    return _driveClient;
}

// ── Health check ──────────────────────────────────────────────────────────────
app.get('/', (req, res) => res.send('Personal Netflix Transcoder is running!'));

// ── Get Audio Tracks ──────────────────────────────────────────────────────────
app.get('/api/tracks/:fileId', async (req, res) => {
    const { fileId } = req.params;
    try {
        const drive = await getDriveClient();
        const driveRes = await drive.files.get(
            { fileId, alt: 'media', supportsAllDrives: true },
            { responseType: 'stream', headers: { Range: "bytes=0-10485760" } }
        );

        const ffprobe = spawn(ffprobeStatic.path, [
            "-v", "quiet", "-print_format", "json", "-show_streams", "pipe:0"
        ]);

        let stdout = "";
        ffprobe.stdout.on('data', chunk => stdout += chunk);
        ffprobe.stderr.on('data', () => { }); // suppress stderr
        ffprobe.on('close', () => {
            try {
                const data = JSON.parse(stdout);
                const audioStreams = data.streams?.filter(s => s.codec_type === "audio") || [];
                res.json({
                    audioTracks: audioStreams.map((s, idx) => ({
                        index: idx,
                        absoluteIndex: s.index,
                        label: s.tags?.title || s.tags?.language || `Audio Track ${idx + 1}`,
                        language: s.tags?.language || "und",
                        codec: s.codec_name,
                        default: s.disposition?.default === 1
                    }))
                });
            } catch { res.status(500).send("Parse error"); }
        });

        ffprobe.stdin.on('error', err => { if (err.code !== 'EPIPE') console.error(err); });
        driveRes.data.pipe(ffprobe.stdin);
        driveRes.data.on('error', () => ffprobe.kill());
    } catch (err) {
        console.error("[tracks]", fileId, err.message);
        res.status(500).send(err.message);
    }
});

// ── Get Duration ──────────────────────────────────────────────────────────────
app.get('/api/duration/:fileId', async (req, res) => {
    const { fileId } = req.params;
    try {
        const drive = await getDriveClient();
        const driveRes = await drive.files.get(
            { fileId, alt: 'media', supportsAllDrives: true },
            { responseType: 'stream', headers: { Range: "bytes=0-10485760" } }
        );

        const ffprobe = spawn(ffprobeStatic.path, [
            "-v", "quiet", "-print_format", "json", "-show_format", "pipe:0"
        ]);

        let stdout = "";
        ffprobe.stdout.on('data', chunk => stdout += chunk);
        ffprobe.stderr.on('data', () => { });
        ffprobe.on('close', () => {
            try {
                const data = JSON.parse(stdout);
                const durationSec = parseFloat(data.format?.duration ?? "0") || 0;
                res.json({ durationSec });
            } catch { res.json({ durationSec: 0 }); }
        });

        ffprobe.stdin.on('error', err => { if (err.code !== 'EPIPE') console.error(err); });
        driveRes.data.pipe(ffprobe.stdin);
        driveRes.data.on('error', () => ffprobe.kill());
    } catch (err) {
        console.error("[duration]", fileId, err.message);
        res.json({ durationSec: 0 });
    }
});

// ── Stream Remuxing ───────────────────────────────────────────────────────────
// For native (no audioTrack param) → redirect to signed Drive URL.
// For FFmpeg mode → use INPUT-LEVEL SEEKING: pass -ss BEFORE -i.
//
// IMPORTANT: MKV/WebM containers store their EBML header only at byte 0.
// Sending a byte-range starting mid-file gives FFmpeg invalid data and crashes.
// We must ALWAYS fetch from byte 0 and use -ss (before -i) to seek.
// Input-level -ss discards packets at the demuxer layer without decoding them,
// so seeking 17 minutes in takes ~2-4 seconds instead of many minutes.

app.get('/api/stream/:fileId', async (req, res) => {
    const { fileId } = req.params;
    const audioTrackIdx = req.query.audioTrack;
    const startOffset = req.query.start ? parseFloat(req.query.start) : 0;

    // ── Native mode: just redirect to a signed Google Drive URL ──────────────
    if (!audioTrackIdx) {
        try {
            const drive = await getDriveClient();
            const token = (await drive.context._options.auth.getAccessToken()).token;
            const url = `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media&supportsAllDrives=true&acknowledgeAbuse=true&access_token=${token}`;
            return res.redirect(302, url);
        } catch (err) {
            return res.status(500).send("Drive token error: " + err.message);
        }
    }

    // ── FFmpeg transcoding mode ───────────────────────────────────────────────
    try {
        const drive = await getDriveClient();

        // Always fetch from byte 0 — MKV requires the full header at the start.
        // FFmpeg's input-level -ss handle the seek efficiently.
        const driveRes = await drive.files.get(
            { fileId, alt: 'media', supportsAllDrives: true },
            { responseType: 'stream' }
        );

        // ── Build FFmpeg args ─────────────────────────────────────────────────
        // KEY: put -ss BEFORE -i for input-level (decoder) seeking.
        // This skips packets at the demuxer layer — almost instant vs. output-level.
        const args = [
            "-nostdin",
            "-probesize", "2000000",
            "-analyzeduration", "1000000",
            "-fflags", "+genpts+nobuffer+discardcorrupt",
        ];

        // Input-level seek: FFmpeg skips packets at the demuxer layer (no decoding)
        // until it reaches the keyframe just before startOffset. Fast and accurate.
        if (startOffset > 0) {
            args.push("-ss", String(startOffset));
        }

        args.push(
            "-i", "pipe:0",
            "-map", "0:v:0",
            "-map", `0:a:${audioTrackIdx}`,
            "-c:v", "copy",
            "-c:a", "aac",
            "-b:a", "192k",
            "-af", "aresample=async=1",
            "-avoid_negative_ts", "make_zero",
            "-movflags", "frag_keyframe+empty_moov+default_base_moof",
            "-f", "mp4",
            "pipe:1"
        );

        res.setHeader('Content-Type', 'video/mp4');
        res.setHeader('Cache-Control', 'no-store');
        res.setHeader('X-Audio-Track', String(audioTrackIdx));
        res.setHeader('X-Seek-Offset', String(startOffset));

        const ffmpeg = spawn(ffmpegStatic, args, { stdio: ["pipe", "pipe", "pipe"] });

        ffmpeg.stdin.on('error', err => {
            if (err.code !== 'EPIPE') console.error("[ffmpeg stdin]", err.message);
        });
        driveRes.data.pipe(ffmpeg.stdin);
        driveRes.data.on('error', () => ffmpeg.kill());

        ffmpeg.stdout.pipe(res);

        ffmpeg.stderr.on('data', chunk => {
            // Only log the first few lines per request to avoid log spam
            const line = chunk.toString().trim();
            if (line && !line.startsWith('size=')) {
                console.log(`[ffmpeg:${fileId.slice(0, 8)}] ${line}`);
            }
        });

        ffmpeg.on('close', () => {
            res.end();
            driveRes.data.destroy?.();
        });

        req.on('close', () => {
            ffmpeg.kill('SIGKILL');
            driveRes.data.destroy?.();
        });

    } catch (err) {
        console.error("[stream]", fileId, err.message);
        if (!res.headersSent) res.status(500).send(err.message);
    }
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log(`Transcoder service started on port ${PORT}`));
