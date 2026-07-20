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

interface AudioTrackInfo {
    index: number;
    audioIndex: number;
    label: string;
    language: string;
}

export async function GET(_req: Request, { params }: RouteParams) {
    const userId = "dev"; // const { userId } = auth();
    if (!userId) return new Response("Unauthorized", { status: 401 });

    try {
        const drive = getDriveClient();
        const ffmpegPath = getFfmpegPath();

        const driveResponse = await drive.files.get(
            { fileId: params.fileId, alt: "media", supportsAllDrives: true },
            {
                responseType: "stream",
                headers: { Range: "bytes=0-5242880" },
            }
        );
        const driveStream = driveResponse.data as NodeJS.ReadableStream;

        const tracks = await new Promise<AudioTrackInfo[]>((resolve, reject) => {
            const ffmpeg = spawn(ffmpegPath, [
                "-probesize", "5000000",
                "-analyzeduration", "3000000",
                "-i", "pipe:0",
                "-f", "null",
                "-"
            ], { stdio: ["pipe", "pipe", "pipe"] });

            let stderr = "";
            let resolved = false;

            ffmpeg.stderr.on("data", (chunk: Buffer) => {
                const text = chunk.toString();
                stderr += text;
                // If we've seen "Output #0", we have all streams
                if (stderr.includes("Output #0") && !resolved) {
                    resolved = true;
                    ffmpeg.kill("SIGKILL");
                    console.log("[DEBUG TRACKS RAW]", stderr);
                    resolve(parseTracks(stderr));
                }
            });

            ffmpeg.on("close", () => {
                if (!resolved) {
                    console.log("[DEBUG TRACKS RAW (CLOSE)]", stderr);
                    resolve(parseTracks(stderr));
                }
            });

            ffmpeg.on("error", () => {
                if (!resolved) resolve([]);
            });

            ffmpeg.stdin.on("error", () => ffmpeg.kill("SIGKILL"));

            driveStream.pipe(ffmpeg.stdin);
            driveStream.on("error", () => {
                if (!resolved) resolve([]);
            });
        });

        // Ensure stream is destroyed
        (driveStream as any).destroy?.();

        return Response.json({ audioTracks: tracks });

    } catch (err: unknown) {
        console.error("[tracks]", params.fileId, err);
        return Response.json({ audioTracks: [] });
    }
}

function parseTracks(stderr: string): AudioTrackInfo[] {
    const tracks: AudioTrackInfo[] = [];

    // Split into lines to extract global stream metadata
    const lines = stderr.split('\n');
    let currentStreamId = -1;
    let currentLang = "";
    let currentTitle = "";

    let audioIndex = 0;

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];

        // Match a stream declaration, e.g. "  Stream #0:1(jpn): Audio: aac..."
        // or "  Stream #0:2: Audio: eac3..."
        const streamMatch = line.match(/\s*Stream #0:(\d+)(?:\(([a-z]{3})\))?: Audio:/i);

        if (streamMatch) {
            const streamIdx = parseInt(streamMatch[1], 10);
            const language = streamMatch[2] ? streamMatch[2].toLowerCase() : "";

            // Extract the codec optionally: "Audio: aac (LC)..." -> "aac"
            let title = "";

            // Backtrack a bit to find tags like "title : English (2.0)" if they were printed before
            // Actually, tags are printed *before* the stream line in newer ffmpegs, or *after*.
            // Wait, usually it looks like:
            //   Stream #0:1: Audio: aac (LC) (m4a / 0x61346D), 44100 Hz, stereo, fltp, 131 kb/s (default)
            //     Metadata:
            //       title           : Japanese Track

            // Let's just do a simple title extraction by checking the next 20 lines for "title : <str>"
            // corresponding to this stream.
            let streamTitle = "";
            for (let j = i + 1; j < Math.min(lines.length, i + 20); j++) {
                if (lines[j].includes("Stream #0:")) break; // next stream started
                const titleMatch = lines[j].match(/\s*title\s*:\s*(.+)/i);
                if (titleMatch) {
                    streamTitle = titleMatch[1].trim();
                    break;
                }
            }

            if (streamTitle) {
                title = streamTitle;
            } else if (language) {
                title = `Track ${audioIndex + 1} · ${language.toUpperCase()}`;
            } else {
                title = `Track ${audioIndex + 1}`;
            }

            tracks.push({
                index: streamIdx,
                audioIndex: audioIndex,
                label: title,
                language: language
            });
            audioIndex++;
        }
    }

    return tracks;
}
