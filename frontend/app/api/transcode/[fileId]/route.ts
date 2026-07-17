import { auth } from "@clerk/nextjs/server";
import { spawn } from "child_process";
import { getDriveClient } from "@/lib/drive";

export const runtime = "nodejs";

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

    // Transcode routes never support byte-range — output size is unknown until
    // FFmpeg finishes. Range requests fall back to the normal /api/stream route.
    if (req.headers.get("range")) {
        return new Response("Range Not Satisfiable", {
            status: 416,
            headers: { "Content-Type": "text/plain" },
        });
    }

    try {
        const drive = getDriveClient();

        // Fetch file metadata (name only — we don't need size here)
        const meta = await drive.files.get({
            fileId: params.fileId,
            fields: "name",
            supportsAllDrives: true,
        });

        const fileName = meta.data.name ?? "video";

        // Stream raw bytes from Drive
        const driveResponse = await drive.files.get(
            { fileId: params.fileId, alt: "media", supportsAllDrives: true },
            { responseType: "stream" }
        );
        const driveStream = driveResponse.data as NodeJS.ReadableStream;

        // ── FFmpeg remux ──────────────────────────────────────────────────────
        // -i pipe:0          : read from stdin
        // -c:v copy          : copy video stream bit-for-bit (no quality loss)
        // -c:a aac           : transcode audio to AAC (handles DTS, AC3, TrueHD…)
        // -b:a 192k          : target audio bitrate — transparent quality
        // -movflags …        : produce a streamable fragmented MP4 (fMP4) on stdout
        //                      frag_keyframe  → new fragment at every keyframe
        //                      empty_moov     → required for pipe output (no seek)
        //                      default_base_moof → conform to ISO BMFF spec
        // -f mp4             : force MP4 container output
        // pipe:1             : write to stdout
        const ffmpegPath = getFfmpegPath();

        const ffmpeg = spawn(ffmpegPath, [
            "-i", "pipe:0",
            "-map", "0:v:0",          // first video stream
            "-map", "0:a:0",          // first audio stream
            "-c:v", "copy",
            "-c:a", "aac",
            "-b:a", "192k",
            "-movflags", "frag_keyframe+empty_moov+default_base_moof",
            "-f", "mp4",
            "pipe:1",
        ], {
            stdio: ["pipe", "pipe", "pipe"],
        });

        // Pipe Drive → FFmpeg stdin
        driveStream.pipe(ffmpeg.stdin);

        // Log FFmpeg stderr in dev (codec info, progress, errors)
        ffmpeg.stderr.on("data", (chunk: Buffer) => {
            process.stdout.write(`[transcode:${params.fileId}] ${chunk.toString()}`);
        });

        // Destroy Drive stream if FFmpeg exits early (client disconnect, error)
        ffmpeg.on("close", () => {
            (driveStream as any).destroy?.();
        });

        // Convert FFmpeg stdout (Node stream) → Web ReadableStream for Next.js response
        const webStream = new ReadableStream({
            start(controller) {
                ffmpeg.stdout.on("data", (chunk: Buffer) => controller.enqueue(chunk));
                ffmpeg.stdout.on("end", () => controller.close());
                ffmpeg.stdout.on("error", (err: Error) => controller.error(err));
            },
            cancel() {
                ffmpeg.kill("SIGKILL");
                (driveStream as any).destroy?.();
            },
        });

        return new Response(webStream, {
            status: 200,
            headers: {
                "Content-Type": "video/mp4",
                "Content-Disposition": `inline; filename="${fileName.replace(/\.mkv$/i, ".mp4")}"`,
                // No Content-Length — size is unknown until remux completes
                // No Accept-Ranges — seeking not supported on remuxed streams
                "Cache-Control": "no-store",
                "X-Transcode": "ffmpeg-remux",  // useful for debugging in DevTools
            },
        });
    } catch (err: unknown) {
        const message = err instanceof Error ? err.message : "Transcode error";
        console.error("[transcode]", params.fileId, message);
        return new Response(message, { status: 500 });
    }
}
