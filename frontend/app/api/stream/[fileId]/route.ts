import { auth } from "@clerk/nextjs/server";
import { spawn } from "child_process";
import { getDriveClient, getDriveToken } from "@/lib/drive";

// Force Node.js runtime — this route uses child_process and native binaries.
// The Edge runtime has neither, and webpack would mangle the ffmpeg path.
export const runtime = "nodejs";

// Use require() at call-time (not import-time) so webpack never resolves or
// bundles the ffmpeg-static path string. Node will look it up in node_modules.
function getFfmpegPath(): string {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const p = require("ffmpeg-static") as string | null;
    if (!p) throw new Error("ffmpeg-static binary not found");
    return p;
}

interface RouteParams {
    params: { fileId: string };
}

export async function GET(req: Request, { params }: RouteParams) {
    const { userId } = auth();
    if (!userId)
        return new Response("Unauthorized", { status: 401 });

    const rangeHeader = req.headers.get("range");

    try {
        const drive = getDriveClient();

        // Fetch file metadata: size, mimeType, name
        const meta = await drive.files.get(
            {
                fileId: params.fileId,
                fields: "size,mimeType,name",
                supportsAllDrives: true,
            }
        );

        const rawMime = meta.data.mimeType ?? "video/mp4";
        const fileName = meta.data.name ?? "video";
        const isMkv = rawMime.includes("matroska") || rawMime.includes("mkv");

        // ══════════════════════════════════════════════════════════════════════
        // MKV PATH — FFmpeg remux to fragmented MP4
        // ══════════════════════════════════════════════════════════════════════
        // We cannot simply remap the MIME type to video/mp4 because browsers
        // silently drop audio codecs they don't support (AC3, DTS, TrueHD…)
        // without firing any error event. Piping through FFmpeg with
        //   -c:v copy      → video is bit-for-bit identical (zero quality loss)
        //   -c:a aac       → audio is transcoded to 192kbps AAC (transparent)
        // guarantees both video AND audio play in every browser.
        //
        // Note: byte-range seeking is not supported on fMP4 output because the
        // total output size is unknown before the remux completes. The browser
        // will buffer the stream and support seeking within the buffered range.
        // ══════════════════════════════════════════════════════════════════════
        if (isMkv) {
            const ffmpegPath = getFfmpegPath();

            // Optional seek offset: ?start=<seconds>
            const url = new URL(req.url);
            const startSec = parseFloat(url.searchParams.get("start") ?? "0");
            const token = await getDriveToken();
            const fileUrl = `https://www.googleapis.com/drive/v3/files/${params.fileId}?alt=media`;

            const ffmpeg = spawn(ffmpegPath, [
                // ── Fast seek BEFORE -i (input seek, very fast for HTTP range) ─
                // Placed before -i so FFmpeg jumps to the nearest keyframe.
                ...(startSec > 0 ? ["-ss", String(startSec)] : []),

                // Limit probe length to prevent startup delays
                "-probesize", "2000000",
                "-analyzeduration", "1000000",
                "-fflags", "+genpts+nobuffer+discardcorrupt",

                // ── Drive Authentication & Input ──────────────────────────────
                "-headers", `Authorization: Bearer ${token}\r\n`,
                "-i", fileUrl,

                // ── Stream selection ──────────────────────────────────────────
                "-map", "0:v:0",    // first video track
                "-map", "0:a:0",    // first audio track

                // ── Video: H.264, good quality ────────────────────────────────
                // • pix_fmt yuv420p  → force 8-bit; browsers can't decode 10-bit H.264
                // • preset fast      → much better quality than ultrafast, still quick
                // • crf 18           → visually near-lossless at 720p
                // • g 48 / keyint 24 → keyframe every ~2 s for fMP4 fragment boundaries
                "-c:v", "libx264",
                "-pix_fmt", "yuv420p",
                "-preset", "fast",
                "-crf", "18",
                "-g", "48",
                "-keyint_min", "24",
                "-sc_threshold", "0",

                // ── Audio: transcode to AAC ───────────────────────────────────
                // Handles EAC3, DTS, AC3, TrueHD — all unsupported in browsers
                "-c:a", "aac",
                "-b:a", "192k",

                // ── Output container: fragmented MP4 ─────────────────────────
                // frag_keyframe     → new fragment at each H.264 keyframe (~1 s)
                // empty_moov        → required for pipe:1 (no seekable file)
                // default_base_moof → ISO BMFF / MSE compliance
                "-movflags", "frag_keyframe+empty_moov+default_base_moof",
                "-f", "mp4",
                "pipe:1",
            ], {
                stdio: ["pipe", "pipe", "pipe"],
            });

            // Log FFmpeg output in dev (shows codec details, progress, errors)
            ffmpeg.stderr.on("data", (chunk: Buffer) =>
                process.stdout.write(`[remux:${params.fileId}] ${chunk.toString()}`)
            );

            const webStream = new ReadableStream({
                start(controller) {
                    let isClosed = false;
                    ffmpeg.stdout.on("data", (chunk: Buffer) => {
                        if (!isClosed) controller.enqueue(chunk);
                    });
                    ffmpeg.stdout.on("end", () => {
                        if (!isClosed) { isClosed = true; controller.close(); }
                    });
                    ffmpeg.stdout.on("error", (err: Error) => {
                        if (!isClosed) { isClosed = true; controller.error(err); }
                    });
                },
                cancel() {
                    ffmpeg.kill("SIGKILL");
                },
            });

            return new Response(webStream, {
                status: 200,
                headers: {
                    "Content-Type": "video/mp4",
                    "Content-Disposition": `inline; filename="${fileName.replace(/\.mkv$/i, ".mp4")}"`,
                    // No Content-Length  — size unknown until remux completes
                    // No Accept-Ranges   — byte-range seeks not possible on live fMP4
                    "Cache-Control": "no-store",
                    "X-Remux": "ffmpeg-mkv",   // visible in DevTools for debugging
                },
            });
        }

        // ══════════════════════════════════════════════════════════════════════
        // NON-MKV PATH — standard byte-range streaming (MP4, WebM, etc.)
        // Full seeking support via HTTP range requests.
        // ══════════════════════════════════════════════════════════════════════
        const fileSize = parseInt(meta.data.size ?? "0", 10);
        const mimeType = rawMime;

        let start = 0;
        let end = fileSize - 1;
        let status = 200;
        const responseHeaders: Record<string, string> = {
            "Content-Type": mimeType,
            "Accept-Ranges": "bytes",
            "Content-Disposition": `inline; filename="${fileName}"`,
        };

        if (rangeHeader) {
            const match = rangeHeader.match(/bytes=(\d+)-(\d*)/);
            if (match) {
                start = parseInt(match[1], 10);
                end = match[2] ? parseInt(match[2], 10) : fileSize - 1;
                if (end >= fileSize) end = fileSize - 1;
                responseHeaders["Content-Range"] = `bytes ${start}-${end}/${fileSize}`;
                responseHeaders["Content-Length"] = String(end - start + 1);
                status = 206;
            }
        } else {
            responseHeaders["Content-Length"] = String(fileSize);
        }

        const driveStream = await drive.files.get(
            {
                fileId: params.fileId,
                alt: "media",
                supportsAllDrives: true,
            },
            {
                responseType: "stream",
                headers: rangeHeader ? { Range: `bytes=${start}-${end}` } : {},
            }
        );

        const readable = driveStream.data as NodeJS.ReadableStream;

        const webStream = new ReadableStream({
            start(controller) {
                let isClosed = false;
                readable.on("data", (chunk: Buffer) => {
                    if (!isClosed) controller.enqueue(chunk);
                });
                readable.on("end", () => {
                    if (!isClosed) { isClosed = true; controller.close(); }
                });
                readable.on("error", (err: Error) => {
                    if (!isClosed) { isClosed = true; controller.error(err); }
                });
            },
            cancel() {
                (readable as any).destroy();
            },
        });

        return new Response(webStream, { status, headers: responseHeaders });

    } catch (err: unknown) {
        const message = err instanceof Error ? err.message : "Stream error";
        console.error("[stream]", params.fileId, message);
        return new Response(message, { status: 500 });
    }
}
