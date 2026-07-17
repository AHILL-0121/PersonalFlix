import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { spawn } from "child_process";
import { db } from "@/lib/db";
import { getDriveClient, getDriveWriteClient } from "@/lib/drive";
import { Readable } from "stream";

export const runtime = "nodejs";
// Transcoding is long-running — disable the 60 s default timeout
export const maxDuration = 3600; // 1 hour hard limit

function getFfmpegPath(): string {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const p = require("ffmpeg-static") as string | null;
    if (!p) throw new Error("ffmpeg-static binary not found");
    return p;
}

/**
 * Parse "Duration: HH:MM:SS.ms" from FFmpeg stderr.
 */
function parseDuration(stderr: string): number | null {
    const m = stderr.match(/Duration:\s*(\d+):(\d+):(\d+\.?\d*)/);
    if (!m) return null;
    return parseInt(m[1], 10) * 3600 + parseInt(m[2], 10) * 60 + parseFloat(m[3]);
}

/**
 * Stream-transcode a single MKV episode:
 *  Drive MKV  →  FFmpeg (libx264 + AAC fMP4)  →  Drive resumable upload
 *
 * Returns the new Drive file ID and duration in seconds.
 */
async function transcodeEpisode(
    episodeId: string,
    mkvFileId: string,
    outputName: string,  // desired filename without extension
    parentFolderId: string,
): Promise<{ newFileId: string; durationSec: number }> {

    const drive = getDriveClient();           // read-only — for MKV download
    const driveWrite = getDriveWriteClient(); // read-write — for MP4 upload + delete
    const ffmpegPath = getFfmpegPath();

    // ── 1. Start Drive download stream (full file) ─────────────────────────────
    const driveResp = await drive.files.get(
        { fileId: mkvFileId, alt: "media", supportsAllDrives: true },
        { responseType: "stream" }
    );
    const driveReadStream = driveResp.data as NodeJS.ReadableStream;

    // ── 2. Spawn FFmpeg: stdin → fMP4 stdout ──────────────────────────────────
    const ffmpeg = spawn(ffmpegPath, [
        "-probesize", "10000000",       // 10 MB probe for HDR/complex files
        "-analyzeduration", "5000000",  // 5 s analysis
        "-fflags", "+genpts+discardcorrupt",
        "-i", "pipe:0",

        "-map", "0:v:0",
        "-map", "0:a:0",

        // Video: H.264, high quality, 8-bit for browser compatibility
        "-c:v", "libx264",
        "-pix_fmt", "yuv420p",
        "-preset", "fast",
        "-crf", "18",
        "-g", "48",
        "-keyint_min", "24",
        "-sc_threshold", "0",

        // Audio: AAC 192kbps (handles AC3/DTS/EAC3/TrueHD)
        "-c:a", "aac",
        "-b:a", "192k",

        // Output: standard MP4 (NOT fragmented) so Drive serves byte-ranges
        // and the browser gets a real duration / fully seekable file.
        "-movflags", "+faststart",
        "-f", "mp4",
        "pipe:1",
    ], { stdio: ["pipe", "pipe", "pipe"] });

    // Pipe Drive → FFmpeg stdin
    driveReadStream.pipe(ffmpeg.stdin);
    ffmpeg.stdin.on("error", () => ffmpeg.kill("SIGKILL"));
    driveReadStream.on("error", () => ffmpeg.kill("SIGKILL"));

    // Collect stderr for duration parsing + error reporting
    let stderrBuf = "";
    ffmpeg.stderr.on("data", (chunk: Buffer) => {
        stderrBuf += chunk.toString();
    });

    // ── 3. Initiate Google Drive resumable upload ─────────────────────────────
    // We use the googleapis stream upload so we can pipe FFmpeg stdout → Drive
    // without buffering the entire file in memory.
    const uploadResp = await driveWrite.files.create(
        {
            requestBody: {
                name: `${outputName}.mp4`,
                mimeType: "video/mp4",
                parents: [parentFolderId],
            },
            media: {
                mimeType: "video/mp4",
                body: Readable.from(
                    // Wrap ffmpeg.stdout (a Node Readable) as an async iterable
                    // so googleapis can stream it. This bridges Node streams and
                    // the googleapis upload body type.
                    (async function* () {
                        for await (const chunk of ffmpeg.stdout) {
                            yield chunk;
                        }
                    })()
                ),
            },
            supportsAllDrives: true,
            fields: "id,name,size",
        },
        {
            // Use resumable upload for large files
            onUploadProgress: () => { /* could log progress here */ },
        }
    );

    // ── 4. Wait for FFmpeg to exit ─────────────────────────────────────────────
    await new Promise<void>((resolve, reject) => {
        ffmpeg.on("close", (code) => {
            if (code === 0 || code === null) resolve();
            else reject(new Error(`FFmpeg exited with code ${code}:\n${stderrBuf.slice(-2000)}`));
        });
        ffmpeg.on("error", reject);
    });

    const newFileId = uploadResp.data.id;
    if (!newFileId) throw new Error("Drive upload returned no file ID");

    const durationSec = Math.round(parseDuration(stderrBuf) ?? 0);
    return { newFileId, durationSec };
}

/**
 * GET /api/library/transcode
 *
 * Returns a JSON summary of pending/done/error episodes.
 * Also migrates any legacy MKV episodes (mkvFileId set but transcodeStatus null)
 * to "pending" so they get picked up on the next POST.
 */
export async function GET() {
    const { userId } = auth();
    if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    // ── Migrate legacy rows ──────────────────────────────────────────────────
    // Case 1: mkvFileId is set but transcodeStatus is null (schema added after first scan)
    const migrated1 = await db.episode.updateMany({
        where: { mkvFileId: { not: null }, transcodeStatus: null },
        data: { transcodeStatus: "pending" },
    });

    // Case 2: Both mkvFileId AND transcodeStatus are null but the episode driveFileId
    // was the original MKV Drive ID (we can detect this by the episode name ending in .mkv,
    // since Drive file names are stored in episode.name for movies, or in the title for series).
    // Back-fill: set mkvFileId = driveFileId + status = pending.
    // We use a raw query because Prisma doesn't support ILIKE in updateMany.
    const legacyMkvEpisodes = await db.episode.findMany({
        where: {
            mkvFileId: null,
            transcodeStatus: null,
            name: { contains: ".mkv", mode: "insensitive" },
        },
        select: { id: true, driveFileId: true },
    });
    if (legacyMkvEpisodes.length > 0) {
        await Promise.all(legacyMkvEpisodes.map(ep =>
            db.episode.update({
                where: { id: ep.id },
                data: { mkvFileId: ep.driveFileId, transcodeStatus: "pending" },
            })
        ));
    }

    const totalMigrated = migrated1.count + legacyMkvEpisodes.length;
    if (totalMigrated > 0) {
        console.log(`[transcode] Migrated ${totalMigrated} legacy MKV episode(s) → pending`);
    }

    const episodes = await db.episode.findMany({
        where: { transcodeStatus: { not: null } },
        select: {
            id: true,
            name: true,
            transcodeStatus: true,
            durationSec: true,
            title: { select: { name: true } },
        },
        orderBy: { transcodeStatus: "asc" },
    });

    const counts = { pending: 0, processing: 0, done: 0, error: 0 };
    for (const ep of episodes) {
        if (ep.transcodeStatus) counts[ep.transcodeStatus]++;
    }

    return NextResponse.json({ counts, episodes });
}

/**
 * POST /api/library/transcode
 *
 * Picks up all episodes with transcodeStatus = "pending" and transcodes them
 * sequentially (one at a time to avoid OOM on the server).
 *
 * Streams NDJSON progress events so the client can show live status.
 * Each line is a JSON object:
 *   { type: "start",    episodeId, name }
 *   { type: "done",     episodeId, name, durationSec, newFileId }
 *   { type: "error",    episodeId, name, error }
 *   { type: "summary",  total, done, errors }
 */
export async function POST() {
    const { userId } = auth();
    if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const drive = getDriveClient();
    const driveWrite = getDriveWriteClient();

    // Reset any previously-failed episodes so they get retried
    await db.episode.updateMany({
        where: { transcodeStatus: "error" },
        data: { transcodeStatus: "pending" },
    });

    // Find all pending episodes
    const pending = await db.episode.findMany({
        where: { transcodeStatus: "pending" },
        select: {
            id: true,
            mkvFileId: true,
            name: true,
            title: { select: { name: true, driveFolderId: true } },
        },
        orderBy: { id: "asc" },
    });

    let doneCount = 0;
    let errorCount = 0;

    const encoder = new TextEncoder();

    const stream = new ReadableStream({
        async start(controller) {
            const send = (obj: object) => {
                try {
                    controller.enqueue(encoder.encode(JSON.stringify(obj) + "\n"));
                } catch { /* controller already closed */ }
            };

            for (const ep of pending) {
                if (!ep.mkvFileId) {
                    send({ type: "error", episodeId: ep.id, name: ep.name, error: "No mkvFileId stored" });
                    errorCount++;
                    continue;
                }

                send({ type: "start", episodeId: ep.id, name: `${ep.title.name} — ${ep.name}` });

                // Mark as processing
                await db.episode.update({
                    where: { id: ep.id },
                    data: { transcodeStatus: "processing" },
                });

                try {
                    const { newFileId, durationSec } = await transcodeEpisode(
                        ep.id,
                        ep.mkvFileId,
                        ep.name.replace(/\.mkv$/i, ""),
                        ep.title.driveFolderId,
                    );

                    // Update the episode: point driveFileId to the new MP4,
                    // store duration, mark done. Keep mkvFileId for reference.
                    // Delete the MKV from Drive to free space.
                    await db.episode.update({
                        where: { id: ep.id },
                        data: {
                            driveFileId: newFileId,
                            durationSec,
                            transcodeStatus: "done",
                            processed: true,
                        },
                    });

                    // Delete the original MKV from Drive to free space
                    try {
                        await driveWrite.files.delete({
                            fileId: ep.mkvFileId,
                            supportsAllDrives: true,
                        });
                    } catch {
                        console.warn(`[transcode] Could not delete MKV ${ep.mkvFileId}`);
                    }

                    doneCount++;
                    send({
                        type: "done",
                        episodeId: ep.id,
                        name: `${ep.title.name} — ${ep.name}`,
                        durationSec,
                        newFileId,
                    });
                } catch (err: unknown) {
                    const error = err instanceof Error ? err.message : String(err);
                    console.error(`[transcode] Failed ${ep.id}:`, error);

                    await db.episode.update({
                        where: { id: ep.id },
                        data: { transcodeStatus: "error" },
                    }).catch(() => { });

                    errorCount++;
                    send({ type: "error", episodeId: ep.id, name: ep.name, error: error.slice(0, 500) });
                }
            }

            send({ type: "summary", total: pending.length, done: doneCount, errors: errorCount });
            controller.close();
        },
    });

    return new Response(stream, {
        headers: {
            "Content-Type": "application/x-ndjson",
            "Transfer-Encoding": "chunked",
            "Cache-Control": "no-store",
            "X-Transcode-Total": String(pending.length),
        },
    });
}
