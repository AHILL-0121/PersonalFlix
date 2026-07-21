require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { spawn, execFile } = require('child_process');
const { google } = require('googleapis');
const ffmpegStatic = require('ffmpeg-static');
const ffprobeStatic = require('ffprobe-static');

const app = express();
app.use(cors());

// Google Drive Auth helper
let _driveToken = null;
let _tokenExpiry = 0;

async function getDriveToken() {
    if (_driveToken && Date.now() < _tokenExpiry) {
        return _driveToken;
    }

    const keyJson = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
    if (!keyJson) {
        throw new Error("Missing GOOGLE_SERVICE_ACCOUNT_KEY env var");
    }

    const { client_email, private_key } = JSON.parse(keyJson);

    const auth = new google.auth.JWT(
        client_email,
        null,
        private_key,
        ['https://www.googleapis.com/auth/drive.readonly']
    );

    const drive = google.drive({ version: 'v3', auth });
    _driveClient = drive;
    _tokenExpiry = Date.now() + 3500000; // Refresh roughly every hour
    return _driveClient;
}

// Health check for Render
app.get('/', (req, res) => {
    res.send('Personal Netflix Transcoder is running!');
});

// Middleware for incoming requests
app.use((req, res, next) => {
    console.log(`[REQUEST] ${req.method} ${req.url}`);
    next();
});

// Get Audio Tracks
app.get('/api/tracks/:fileId', async (req, res) => {
    const { fileId } = req.params;
    console.log(`[tracks] Starting extraction for ${fileId}...`);

    try {
        const drive = await getDriveToken();
        const driveRes = await drive.files.get(
            { fileId, alt: 'media', supportsAllDrives: true },
            { responseType: 'stream', headers: { Range: "bytes=0-10485760" } } // first 10MB
        );
        console.log(`[tracks] Google Drive stream connected for ${fileId}`);

        const args = [
            "-v", "error",
            "-print_format", "json",
            "-show_streams",
            "pipe:0"
        ];
        console.log(`[tracks] Spawning ffprobe with args: ${args.join(" ")}`);

        const ffprobe = spawn(ffprobeStatic.path, args);
        let stdout = "";
        let stderr = "";

        ffprobe.stdout.on('data', chunk => stdout += chunk);
        ffprobe.stderr.on('data', chunk => stderr += chunk);

        ffprobe.on('close', (code) => {
            console.log(`[tracks] ffprobe exited with code ${code} for ${fileId}`);
            try {
                if (stdout.trim().length === 0) {
                    throw new Error("ffprobe stdout was empty");
                }
                const data = JSON.parse(stdout);
                const audioStreams = data.streams?.filter((s) => s.codec_type === "audio") || [];
                const formattedTracks = audioStreams.map((s, idx) => ({
                    index: idx,
                    absoluteIndex: s.index,
                    label: s.tags?.title || s.tags?.language || `Audio Track ${idx + 1}`,
                    language: s.tags?.language || "und",
                    codec: s.codec_name,
                    default: s.disposition?.default === 1
                }));
                console.log(`[tracks] Success: Found ${formattedTracks.length} tracks for ${fileId}`);
                res.json({ audioTracks: formattedTracks });
            } catch (e) {
                console.error(`[tracks] ffprobe failed. Code: ${code}. Err: ${e.message}. Stdout: ${stdout.substring(0, 100)}. Stderr: ${stderr}`);
                return res.status(500).send("FFprobe failed: " + e.message);
            }
        });

        ffprobe.stdin.on('error', (err) => {
            if (err.code !== 'EPIPE') console.error(`[tracks] ffprobe stdin error for ${fileId}:`, err);
        });

        driveRes.data.pipe(ffprobe.stdin);
        driveRes.data.on('error', (err) => {
            console.error(`[tracks] Google Drive stream error for ${fileId}:`, err);
            ffprobe.kill();
        });
    } catch (err) {
        console.error(`[tracks] Outer error for ${fileId}:`, err.message);
        res.status(500).send(err.message);
    }
});

// Get Duration
app.get('/api/duration/:fileId', async (req, res) => {
    const { fileId } = req.params;
    console.log(`[duration] Starting extraction for ${fileId}...`);

    try {
        const drive = await getDriveToken();
        const driveRes = await drive.files.get(
            { fileId, alt: 'media', supportsAllDrives: true },
            { responseType: 'stream', headers: { Range: "bytes=0-10485760" } }
        );
        console.log(`[duration] Google Drive stream connected for ${fileId}`);

        const args = [
            "-v", "error",
            "-print_format", "json",
            "-show_format",
            "pipe:0"
        ];
        console.log(`[duration] Spawning ffprobe with args: ${args.join(" ")}`);

        const ffprobe = spawn(ffprobeStatic.path, args);
        let stdout = "";
        let stderr = "";

        ffprobe.stdout.on('data', chunk => stdout += chunk);
        ffprobe.stderr.on('data', chunk => stderr += chunk);

        ffprobe.on('close', (code) => {
            console.log(`[duration] ffprobe exited with code ${code} for ${fileId}`);
            try {
                if (stdout.trim().length === 0) {
                    throw new Error("ffprobe stdout was empty");
                }
                const data = JSON.parse(stdout);
                const durationSec = data.format?.duration ? parseFloat(data.format.duration) : 0;
                console.log(`[duration] Success: Duration is ${durationSec}s for ${fileId}`);
                res.json({ durationSec });
            } catch (e) {
                console.error(`[duration] ffprobe failed. Code: ${code}. Err: ${e.message}. Stdout: ${stdout.substring(0, 100)}. Stderr: ${stderr}`);
                res.json({ durationSec: 0 });
            }
        });

        ffprobe.stdin.on('error', (err) => {
            if (err.code !== 'EPIPE') console.error(`[duration] ffprobe stdin error for ${fileId}:`, err);
        });

        driveRes.data.pipe(ffprobe.stdin);
        driveRes.data.on('error', (err) => {
            console.error(`[duration] Google Drive stream error for ${fileId}:`, err);
            ffprobe.kill();
        });
    } catch (err) {
        console.error(`[duration] Outer error for ${fileId}:`, err.message);
        res.json({ durationSec: 0 });
    }
});

// Stream Remuxing
app.get('/api/stream/:fileId', async (req, res) => {
    const { fileId } = req.params;
    const audioTrackIdx = req.query.audioTrack;
    const startOffset = req.query.start ? parseFloat(req.query.start) : 0;

    console.log(`[stream] Processing ${fileId} | start: ${startOffset} | audioTrack: ${audioTrackIdx}`);

    if (!audioTrackIdx) {
        try {
            console.log(`[stream] No audioTrack specified for ${fileId}, redirecting to native Google Drive stream.`);
            const drive = await getDriveToken();
            const token = (await drive.context._options.auth.getAccessToken()).token;
            const directUrl = `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media&supportsAllDrives=true&acknowledgeAbuse=true&access_token=${token}`;
            return res.redirect(302, directUrl);
        } catch (err) {
            console.error(`[stream] Native stream redirect failed for ${fileId}:`, err.message);
            return res.status(500).send("Drive token error");
        }
    }

    try {
        const drive = await getDriveToken();
        const token = (await drive.context._options.auth.getAccessToken()).token;
        const fileUrl = `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media&supportsAllDrives=true&acknowledgeAbuse=true`;
        console.log(`[stream] Generated Google Drive Media URL for ffmpeg extraction.`);

        const args = [
            "-nostdin",
            "-v", "error",
            "-probesize", "5000000",
            "-analyzeduration", "3000000",
            "-fflags", "+genpts+nobuffer+discardcorrupt",
        ];

        args.push(
            "-user_agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            "-headers", `Authorization: Bearer ${token}\r\n`
        );

        if (startOffset > 0) {
            args.push("-ss", String(startOffset), "-noaccurate_seek");
        }

        args.push(
            "-i", fileUrl,
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
        console.log(`[stream] Spawning ffmpeg transcoder with args: ${args.join(" ")}`);

        res.setHeader('Content-Type', 'video/mp4');
        res.setHeader('Cache-Control', 'no-store');
        res.setHeader('X-Audio-Track', String(audioTrackIdx));

        const ffmpeg = spawn(ffmpegStatic, args, { stdio: ["pipe", "pipe", "pipe"] });

        ffmpeg.stdout.pipe(res);

        ffmpeg.stderr.on('data', (chunk) => {
            console.error(`[ffmpeg-error:${fileId}] ${chunk.toString()}`);
        });

        ffmpeg.on('close', (code) => {
            console.log(`[stream] ffmpeg transcoder exited with code ${code} for ${fileId}`);
            res.end();
        });

        req.on('close', () => {
            console.log(`[stream] Client closed connection for ${fileId}, killing ffmpeg.`);
            ffmpeg.kill('SIGKILL');
        });

    } catch (err) {
        console.error(`[stream] Outer error for ${fileId}:`, err.message);
        res.status(500).send(err.message);
    }
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
    console.log(`Transcoder service started on port ${PORT}`);
});
