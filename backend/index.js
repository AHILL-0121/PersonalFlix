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

        // MKV/EBML containers MUST be read from byte 0; mid-file byte-ranges
        // corrupt the header and crash FFmpeg.
        const driveRes = await drive.files.get(
            { fileId, alt: 'media', supportsAllDrives: true },
            { responseType: 'stream' }
        );

        // ── FFmpeg args ───────────────────────────────────────────────────────
        // We always re-encode to H.264 (never copy) for two critical reasons:
        //
        // 1. CODEC COMPATIBILITY: These MKV files are HEVC (H.265) encoded.
        //    Firefox, older Chromium, and many mobile browsers have zero native
        //    HEVC support. Copying HEVC into an MP4 container produces a stream
        //    the browser decodes as error 4 (MEDIA_ERR_SRC_NOT_SUPPORTED).
        //
        // 2. KEYFRAME INTERVAL — THE CRITICAL ONE:
        //    frag_keyframe only flushes an fMP4 fragment at keyframe boundaries.
        //    HEVC encoders use very large GOP sizes (200-400 frames, ~8-17s at
        //    24fps). In copy mode the first flush waits for the first HEVC
        //    keyframe — causing the 10+ second loading spinner.
        //    With -g 48 we force a new H.264 keyframe every 2 seconds,
        //    so the browser receives its first playable fragment in ~2s.
        //
        // Encoding profile:
        //   -preset ultrafast  : skips expensive compression math; maximises
        //                        encoding speed on Render's 0.1 vCPU instance.
        //   -crf 28            : constant quality; balances size vs. quality.
        //   -tune zerolatency  : disables b-frame reference delay; data reaches
        //                        the muxer and browser as soon as it is encoded.
        //   -vf scale=-2:720   : downscale to 720p — reduces pixel load ~60%,
        //                        pushing encode speed from ~0.3x back to ~1x.
        //   -pix_fmt yuv420p   : forces 8-bit colour; HEVC 10-bit (yuv420p10le)
        //                        is rejected by most browser decoders.
        //   -g 48              : keyframe every 48 frames (2s at 24fps).
        //   -keyint_min 48     : prevents shorter keyframe intervals that could
        //                        cause A/V sync drift on fragment boundaries.
        const args = [
            "-nostdin",
            "-probesize", "500000",   // 500KB — fast container sniff
            "-analyzeduration", "250000",   // 250ms — fast stream analysis
            "-fflags", "+genpts+nobuffer+discardcorrupt",
        ];

        if (startOffset > 0) {
            // Input-level -ss: demuxer skips packets without decoding them.
            // This is the fastest seek method for MKV; must come BEFORE -i.
            args.push("-ss", String(startOffset));
        }

        args.push(
            "-i", "pipe:0",
            "-map", "0:v:0",
            "-map", `0:a:${audioTrackIdx}?`,  // '?' = silent-video safe
            // Video: always H.264 with forced 2-second keyframes
            "-c:v", "libx264",
            "-preset", "ultrafast",
            "-tune", "zerolatency",
            "-crf", "28",
            "-vf", "scale=-2:720",
            "-pix_fmt", "yuv420p",
            "-g", "48",           // keyframe every 2s @ 24fps
            "-keyint_min", "48",
            // Audio: always AAC stereo
            "-c:a", "aac",
            "-b:a", "128k",
            "-af", "aresample=async=1",
            "-avoid_negative_ts", "make_zero",
            // fMP4 streaming flags: write tiny moov immediately so the browser
            // can start decoding before the full stream has been received.
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