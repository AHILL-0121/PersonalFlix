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

/**
 * GET /api/duration/[fileId]
 *
 * Returns { durationSec: number } by piping the first ~5 MB of the Drive file
 * through "ffmpeg -i pipe:0 -f null -" and parsing the "Duration:" line from
 * stderr. Only the header/metadata portion of the file is needed for this, so
 * we kill the process as soon as we have the answer.
 *
 * This endpoint is called once by the VideoPlayer on mount so the seek bar
 * and time display work correctly for MKV/fMP4 streams (which report
 * Infinity for video.duration in the browser).
 */
export async function GET(_req: Request, { params }: RouteParams) {
    const { userId } = auth();
    if (!userId) return new Response("Unauthorized", { status: 401 });

    try {
        const transcoderUrl = process.env.TRANSCODER_URL;
        if (transcoderUrl) {
            const proxyRes = await fetch(`${transcoderUrl}/api/duration/${params.fileId}`);
            if (proxyRes.ok) {
                const proxyData = await proxyRes.json();
                return Response.json(proxyData);
            }
        }

        const drive = getDriveClient();
        const ffmpegPath = getFfmpegPath();

        // Fetch only the first 5 MB — enough for FFmpeg to read the container
        // header and report duration without downloading the whole file.
        const driveResponse = await drive.files.get(
            { fileId: params.fileId, alt: "media", supportsAllDrives: true },
            {
                responseType: "stream",
                headers: { Range: "bytes=0-5242880" }, // 5 MB
            }
        );
        const driveStream = driveResponse.data as NodeJS.ReadableStream;

        const durationSec = await new Promise<number>((resolve, reject) => {
            const ffmpeg = spawn(ffmpegPath, [
                "-probesize", "5000000",
                "-analyzeduration", "3000000",
                "-i", "pipe:0",
                "-f", "null",
                "-",
            ], { stdio: ["pipe", "pipe", "pipe"] });

            let stderr = "";

            ffmpeg.stderr.on("data", (chunk: Buffer) => {
                stderr += chunk.toString();

                // Try to parse Duration as soon as we see it, then kill ffmpeg
                // so we don't download more data than needed.
                const m = stderr.match(/Duration:\s*(\d+):(\d+):(\d+\.?\d*)/);
                if (m) {
                    const h = parseInt(m[1], 10);
                    const min = parseInt(m[2], 10);
                    const sec = parseFloat(m[3]);
                    const total = h * 3600 + min * 60 + sec;
                    ffmpeg.kill("SIGKILL");
                    (driveStream as any).destroy?.();
                    resolve(total);
                }
            });

            ffmpeg.on("close", () => {
                // If we resolved already, the second resolve is a no-op.
                // If we never found Duration, reject.
                reject(new Error("Duration not found in FFmpeg output"));
            });

            ffmpeg.on("error", reject);
            ffmpeg.stdin.on("error", () => ffmpeg.kill("SIGKILL"));

            driveStream.pipe(ffmpeg.stdin);
            driveStream.on("error", reject);
        }).catch(() => 0); // default to 0 if anything fails

        return Response.json({ durationSec });

    } catch (err: unknown) {
        const message = err instanceof Error ? err.message : "Duration probe error";
        console.error("[duration]", params.fileId, message);
        return Response.json({ durationSec: 0 });
    }
}
