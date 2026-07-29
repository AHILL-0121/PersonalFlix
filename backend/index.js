require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { spawn } = require('child_process');
const { google } = require('googleapis');
const ffmpegStatic = require('ffmpeg-static');
const ffprobeStatic = require('ffprobe-static');

const app = express();

// Allow requests from the Vercel frontend explicitly
app.use(cors({
    origin: [
        'https://sa-personal-flix.vercel.app',
        /\.vercel\.app$/,
        'http://localhost:3000'
    ],
    methods: ['GET', 'HEAD', 'OPTIONS'],
    allowedHeaders: ['Range', 'Content-Type', 'Authorization'],
    exposedHeaders: ['Content-Range', 'Content-Length', 'Accept-Ranges', 'Content-Type'],
    credentials: false,
}));

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

// ── Video Codec Detection Cache ───────────────────────────────────────────────
// Stores { codec: string, ts: number } keyed by fileId.
// Avoids re-probing on every seek restart. TTL: 2 hours.
const _codecCache = new Map();
const CODEC_CACHE_TTL = 2 * 60 * 60 * 1000;

// Probes the first 500KB of a Drive file to detect the primary video codec.
// Returns 'hevc', 'h264', 'vp9', etc. Falls back to 'h264' on error.
async function detectVideoCodec(drive, fileId) {
    const cached = _codecCache.get(fileId);
    if (cached && Date.now() - cached.ts < CODEC_CACHE_TTL) {
        return cached.codec;
    }

    try {
        const driveRes = await drive.files.get(
            { fileId, alt: 'media', supportsAllDrives: true },
            { responseType: 'stream', headers: { Range: 'bytes=0-524287' } } // 512KB probe
        );

        const codec = await new Promise((resolve) => {
            const probe = spawn(ffprobeStatic.path, [
                '-v', 'quiet',
                '-print_format', 'json',
                '-show_streams',
                '-select_streams', 'v:0',
                'pipe:0'
            ]);

            let stdout = '';
            probe.stdout.on('data', c => stdout += c);
            probe.stderr.on('data', () => { });
            probe.on('close', () => {
                try {
                    const data = JSON.parse(stdout);
                    resolve(data.streams?.[0]?.codec_name ?? 'h264');
                } catch { resolve('h264'); }
            });
            probe.on('error', () => resolve('h264'));

            probe.stdin.on('error', err => { if (err.code !== 'EPIPE') console.error('[probe stdin]', err.message); });
            driveRes.data.pipe(probe.stdin);
            driveRes.data.on('error', () => probe.kill());
        });

        console.log(`[codec] ${fileId.slice(0, 8)} → ${codec}`);
        _codecCache.set(fileId, { codec, ts: Date.now() });
        return codec;
    } catch (err) {
        console.error('[codec detect]', err.message);
        return 'h264'; // safe fallback
    }
}

// ── Health check / Wakeup ─────────────────────────────────────────────────────
// The frontend calls this on player load to warm up the Render instance
// so that by the time the user actually plays a MKV, the cold-start delay
// has already been absorbed.
app.get('/', (req, res) => res.send('Personal Netflix Transcoder is running!'));
app.get('/wakeup', (req, res) => res.json({ status: 'awake', ts: Date.now() }));

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
        ffprobe.stderr.on('data', () => { });
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
    // CRITICAL: audioTrack=0 is a valid value. Use explicit null/undefined check,
    // NOT a falsy check (!audioTrackIdx), because "0" is falsy in JavaScript.
    const audioTrackRaw = req.query.audioTrack;
    const audioTrackIdx = (audioTrackRaw !== undefined && audioTrackRaw !== null && audioTrackRaw !== '' && audioTrackRaw !== 'null' && audioTrackRaw !== 'undefined')
        ? audioTrackRaw
        : null;
    const startOffset = req.query.start ? parseFloat(req.query.start) : 0;

    // ── Pure Proxy mode (for MP4s blocked by mobile cross-site tracking) ──────
    if (req.query.proxy === '1') {
        try {
            const drive = await getDriveClient();
            const range = req.headers.range || '';
            const driveOptions = { responseType: 'stream' };
            if (range) {
                driveOptions.headers = { Range: range };
            }

            const driveRes = await drive.files.get(
                { fileId, alt: 'media', supportsAllDrives: true },
                driveOptions
            );

            // Pass headers from Google Drive to the client to support proper HTML5 video streaming
            const headers = driveRes.headers;
            for (const key in headers) {
                res.setHeader(key, headers[key]);
            }
            // Override content-type for proper browser sniffing
            if (headers['content-type']?.includes('octet-stream')) {
                res.setHeader('content-type', 'video/mp4');
            }
            res.setHeader('Access-Control-Allow-Origin', req.headers.origin || '*');
            res.setHeader('Access-Control-Expose-Headers', 'Content-Range, Content-Length, Accept-Ranges');

            // Must use the same status code Google returned (usually 206 for range requests)
            res.status(driveRes.status);

            driveRes.data.pipe(res);
            req.on('close', () => driveRes.data.destroy && driveRes.data.destroy());
            return;
        } catch (err) {
            return res.status(500).send("Proxy error: " + err.message);
        }
    }

    // ── Native mode: redirect to signed Google Drive URL ─────────────────────
    if (audioTrackIdx === null) {
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

        // ── Step 1: Detect video codec (cached after first probe) ─────────────
        // Firefox & most browsers DO NOT support HEVC (H.265) or VP9 in an MP4
        // container. We must re-encode those to H.264. However, H.264 source
        // files can be stream-copied (zero CPU) which is much faster.
        const videoCodec = await detectVideoCodec(drive, fileId);
        const needsRecode = ['hevc', 'h265', 'vp9', 'av1', 'mpeg2video'].includes(videoCodec);

        if (needsRecode) {
            console.log(`[stream] ${fileId.slice(0, 8)} codec=${videoCodec} → re-encoding to H.264`);
        } else {
            console.log(`[stream] ${fileId.slice(0, 8)} codec=${videoCodec} → copy (no re-encode)`);
        }

        // ── Step 2: Open the raw Drive stream from byte 0 ─────────────────────
        // MKV/EBML containers MUST be read from byte 0; mid-file byte-ranges
        // corrupt the header and crash FFmpeg.
        const driveRes = await drive.files.get(
            { fileId, alt: 'media', supportsAllDrives: true },
            { responseType: 'stream' }
        );

        // ── Step 3: Build FFmpeg args ─────────────────────────────────────────
        const args = [
            "-nostdin",
            "-probesize", "500000",       // 500KB — cuts ~1.5s of startup latency
            "-analyzeduration", "250000",  // 250ms — cuts ~0.75s of startup latency
            "-fflags", "+genpts+nobuffer+discardcorrupt",
        ];

        if (startOffset > 0) {
            // Input-level -ss: demuxer discards packets without decoding them.
            // Fast and accurate. Must come BEFORE -i for MKV containers.
            args.push("-ss", String(startOffset));
        }

        args.push("-i", "pipe:0");
        args.push("-map", "0:v:0");
        // Optional audio map: the '?' prevents FFmpeg crashing on silent videos
        args.push("-map", `0:a:${audioTrackIdx}?`);

        if (needsRecode) {
            // HEVC/VP9/AV1 → H.264 transcode.
            // -preset ultrafast: skips heavy compression math, maximises speed on
            //   Render's 0.1 vCPU shared instance.
            // -crf 28: good quality/size tradeoff for web.
            // -vf scale=-2:720: downscale to 720p — cuts pixel load by ~60%,
            //   returning transcode speed from 0.3x → ~1.0x realtime.
            // -pix_fmt yuv420p: forces 8-bit colour; without this, 10-bit HEVC
            //   produces yuv420p10le which many browsers reject.
            // -profile:v high: required by some clients for H.264 High profile.
            args.push(
                "-c:v", "libx264",
                "-preset", "ultrafast",
                "-crf", "28",
                "-vf", "scale=-2:720",
                "-pix_fmt", "yuv420p",
                "-profile:v", "high"
            );
        } else {
            // H.264 source: stream-copy the video — zero CPU, no quality loss.
            args.push("-c:v", "copy");
        }

        args.push(
            "-c:a", "aac",
            "-b:a", "128k",
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