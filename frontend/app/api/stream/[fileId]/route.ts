import { auth } from "@clerk/nextjs/server";
import { spawn } from "child_process";
import { getDriveClient, getDriveToken } from "@/lib/drive";

export const runtime = "nodejs";

function getFfmpegPath(): string {
    const { join } = require("path");
    const p = join(process.cwd(), "node_modules", "ffmpeg-static", "ffmpeg.exe");
    return p;
}

interface RouteParams {
    params: { fileId: string };
}

function getBrowserMime(rawMime: string, fileName: string): string {
    const name = fileName.toLowerCase();
    if (name.endsWith(".mkv") || rawMime.includes("matroska") || rawMime.includes("mkv"))
        return "video/x-matroska";
    if (name.endsWith(".webm") || rawMime.includes("webm")) return "video/webm";
    return "video/mp4";
}

export async function GET(req: Request, { params }: RouteParams) {
    const { userId } = auth();
    if (!userId) return new Response("Unauthorized", { status: 401 });

    const url = new URL(req.url);
    const rangeHeader = req.headers.get("range");
    // ?audioTrack=N selects a specific audio stream index (0-based among audio streams)
    const audioTrackParam = url.searchParams.get("audioTrack");
    const audioTrackIdx = audioTrackParam !== null && audioTrackParam !== "undefined" && audioTrackParam !== "null" && audioTrackParam.trim() !== "" ? parseInt(audioTrackParam, 10) : null;
    const startParam = url.searchParams.get("start");
    const startOffset = startParam !== null && startParam !== "undefined" && startParam !== "null" && startParam.trim() !== "" ? parseFloat(startParam) : 0;

    try {
        const drive = getDriveClient();

        // ── Step 1: Fetch metadata ────────────────────────────────────────────
        const meta = await drive.files.get({
            fileId: params.fileId,
            fields: "size,mimeType,name",
            supportsAllDrives: true,
        });

        const rawMime = meta.data.mimeType ?? "video/mp4";
        const fileName = meta.data.name ?? "video";
        const fileSize = parseInt(meta.data.size ?? "0", 10);

        // ── Step 2: Audio-track remux path (FFmpeg) ───────────────────────────
        // When a specific audio track is requested we must remux through FFmpeg
        // because the browser can't natively switch embedded tracks for MKV.
        // We copy video bit-for-bit (-c:v copy) and transcode only the selected
        // audio track to AAC (-c:a aac) to ensure browser compatibility.
        if (audioTrackIdx !== null) {
            const transcoderUrl = process.env.TRANSCODER_URL;
            if (transcoderUrl) {
                return Response.redirect(`${transcoderUrl}/api/stream/${params.fileId}?start=${startOffset}&audioTrack=${audioTrackIdx}`, 302);
            }

            const ffmpegPath = getFfmpegPath();
            const token = await getDriveToken();
            const fileUrl =
                `https://www.googleapis.com/drive/v3/files/${params.fileId}` +
                `?alt=media&supportsAllDrives=true&acknowledgeAbuse=true`;

            const args = [
                "-nostdin",
                "-probesize", "5000000",
                "-analyzeduration", "3000000",
                "-fflags", "+genpts+nobuffer+discardcorrupt",
                "-headers", `Authorization: Bearer ${token}\r\n`,
            ];

            if (startOffset > 0) {
                // Use -noaccurate_seek to force audio to start at the exact same nearest 
                // keyframe time as the copied video track to guarantee tight A/V sync.
                args.push("-ss", String(startOffset), "-noaccurate_seek");
            }

            args.push(
                "-i", fileUrl,
                "-map", "0:v:0",               // first video track (copy)
                "-map", `0:a:${audioTrackIdx}`, // selected audio track
                "-c:v", "copy",
                "-c:a", "aac",
                "-b:a", "192k",
                "-af", "aresample=async=1",
                "-avoid_negative_ts", "make_zero",
                "-movflags", "frag_keyframe+empty_moov+default_base_moof",
                "-f", "mp4",
                "pipe:1"
            );

            const ffmpeg = spawn(ffmpegPath, args, { stdio: ["pipe", "pipe", "pipe"] });

            ffmpeg.stderr.on("data", (chunk: Buffer) => {
                console.log(`[stream-remux:${params.fileId}] ${chunk.toString()}`);
            });

            const webStream = new ReadableStream({
                start(controller) {
                    let closed = false;
                    ffmpeg.stdout.on("data", (c: Buffer) => { if (!closed) try { controller.enqueue(c); } catch { closed = true; } });
                    ffmpeg.stdout.on("end", () => { if (!closed) { closed = true; try { controller.close(); } catch { } } });
                    ffmpeg.stdout.on("error", (e: Error) => { if (!closed) { closed = true; try { controller.error(e); } catch { } } });
                },
                cancel() { ffmpeg.kill("SIGKILL"); },
            });

            return new Response(webStream, {
                status: 200,
                headers: {
                    "Content-Type": "video/mp4",
                    "Content-Disposition": `inline; filename = "${fileName}"`,
                    "Cache-Control": "no-store",
                    "X-Audio-Track": String(audioTrackIdx),
                },
            });
        }

        const token = await getDriveToken();
        const directUrl =
            `https://www.googleapis.com/drive/v3/files/${params.fileId}` +
            `?alt=media&supportsAllDrives=true&acknowledgeAbuse=true&access_token=${token}`;

        return Response.redirect(directUrl, 302);

    } catch (err: unknown) {
        const message = err instanceof Error ? err.message : "Stream error";
        console.error("[stream]", params.fileId, message);
        return new Response(message, { status: 500 });
    }
}
