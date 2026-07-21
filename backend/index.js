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

    const tokenRes = await auth.authorize();
    _driveToken = tokenRes.access_token;
    _tokenExpiry = tokenRes.expiry_date - 60000;
    return _driveToken;
}

// Health check for Render
app.get('/', (req, res) => {
    res.send('Personal Netflix Transcoder is running!');
});

// Get Audio Tracks
app.get('/api/tracks/:fileId', async (req, res) => {
    const { fileId } = req.params;

    try {
        const token = await getDriveToken();
        const fileUrl =
            `https://www.googleapis.com/drive/v3/files/${fileId}` +
            `?alt=media&supportsAllDrives=true&acknowledgeAbuse=true&access_token=${token}`;

        const args = [
            "-v", "quiet",
            "-print_format", "json",
            "-show_streams",
            fileUrl
        ];

        execFile(ffprobeStatic.path, args, { maxBuffer: 1024 * 1024 * 10 }, (error, stdout, stderr) => {
            if (error) {
                console.error("[ffprobe] Error:", error.message, stderr);
                return res.status(500).send("FFprobe execution failed");
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

            res.json({ audioTracks: formattedTracks });
        });
    } catch (err) {
        console.error("[tracks]", fileId, err.message);
        res.status(500).send(err.message);
    }
});

// Get Duration
app.get('/api/duration/:fileId', async (req, res) => {
    const { fileId } = req.params;

    try {
        const token = await getDriveToken();
        const fileUrl =
            `https://www.googleapis.com/drive/v3/files/${fileId}` +
            `?alt=media&supportsAllDrives=true&acknowledgeAbuse=true&access_token=${token}`;

        const args = [
            "-v", "quiet",
            "-print_format", "json",
            "-show_format",
            fileUrl
        ];

        execFile(ffprobeStatic.path, args, { maxBuffer: 1024 * 1024 * 10 }, (error, stdout, stderr) => {
            if (error) {
                console.error("[duration] Error:", error.message, stderr);
                return res.json({ durationSec: 0 });
            }

            const data = JSON.parse(stdout);
            const durationSec = data.format?.duration ? parseFloat(data.format.duration) : 0;
            res.json({ durationSec });
        });
    } catch (err) {
        console.error("[duration]", fileId, err.message);
        res.json({ durationSec: 0 });
    }
});

// Stream Remuxing
app.get('/api/stream/:fileId', async (req, res) => {
    const { fileId } = req.params;
    const audioTrackIdx = req.query.audioTrack;
    const startOffset = req.query.start ? parseFloat(req.query.start) : 0;

    // Normal streaming directly from drive without ffmpeg shouldn't hit this server
    // but just in case, if no audio track is provided, we redirect them to Drive 
    // to save Render's bandwidth too.
    if (!audioTrackIdx) {
        try {
            const token = await getDriveToken();
            const directUrl =
                `https://www.googleapis.com/drive/v3/files/${fileId}` +
                `?alt=media&supportsAllDrives=true&acknowledgeAbuse=true&access_token=${token}`;
            return res.redirect(302, directUrl);
        } catch (err) {
            return res.status(500).send("Drive token error");
        }
    }

    try {
        const token = await getDriveToken();
        const fileUrl =
            `https://www.googleapis.com/drive/v3/files/${fileId}` +
            `?alt=media&supportsAllDrives=true&acknowledgeAbuse=true&access_token=${token}`;

        const args = [
            "-nostdin",
            "-probesize", "5000000",
            "-analyzeduration", "3000000",
            "-fflags", "+genpts+nobuffer+discardcorrupt",
        ];

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

        res.setHeader('Content-Type', 'video/mp4');
        res.setHeader('Cache-Control', 'no-store');
        res.setHeader('X-Audio-Track', String(audioTrackIdx));

        const ffmpeg = spawn(ffmpegStatic, args, { stdio: ["pipe", "pipe", "pipe"] });

        ffmpeg.stdout.pipe(res);

        ffmpeg.stderr.on('data', (chunk) => {
            console.log(`[ffmpeg:${fileId}] ${chunk.toString()}`);
        });

        ffmpeg.on('close', () => {
            res.end();
        });

        // Kill process if client disconnects
        req.on('close', () => {
            ffmpeg.kill('SIGKILL');
        });

    } catch (err) {
        console.error("[stream]", fileId, err.message);
        res.status(500).send(err.message);
    }
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
    console.log(`Transcoder service started on port ${PORT}`);
});
