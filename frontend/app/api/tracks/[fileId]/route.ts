import { auth } from "@clerk/nextjs/server";
import { execFile } from "child_process";
import { getDriveToken } from "@/lib/drive";

export const runtime = "nodejs";

export async function GET(req: Request, { params }: { params: { fileId: string } }) {
    const { userId } = auth();
    if (!userId) return new Response("Unauthorized", { status: 401 });

    try {
        const token = await getDriveToken();
        const driveRes = await fetch(
            `https://www.googleapis.com/drive/v3/files/${params.fileId}?fields=name,mimeType`,
            { headers: { Authorization: `Bearer ${token}` } }
        );
        const meta = await driveRes.json();
        const rawMime = meta.mimeType ?? "";
        const fileName = meta.name ?? "";
        const isMkv = fileName.toLowerCase().endsWith(".mkv") || rawMime.includes("mkv") || rawMime.includes("matroska");

        const transcoderUrl = process.env.TRANSCODER_URL;
        if (transcoderUrl) {
            const proxyRes = await fetch(`${transcoderUrl}/api/tracks/${params.fileId}`);
            if (proxyRes.ok) {
                const proxyData = await proxyRes.json();
                return new Response(JSON.stringify({ ...proxyData, isMkv }), {
                    status: 200,
                    headers: { "Content-Type": "application/json" }
                });
            }
            // If Transcoder fails (500), DONT crash! Return empty tracks but True isMkv so video still streams!
            console.error("[tracks] Transcoder ffprobe failed");
            return new Response(JSON.stringify({ audioTracks: [], isMkv }), {
                status: 200,
                headers: { "Content-Type": "application/json" }
            });
        }

        const fileUrl =
            `https://www.googleapis.com/drive/v3/files/${params.fileId}` +
            `?alt=media&supportsAllDrives=true&acknowledgeAbuse=true`;

        const args = [
            "-v", "quiet",
            "-print_format", "json",
            "-show_streams",
            "-headers", `Authorization: Bearer ${token}\r\n`,
            fileUrl
        ];

        const output = await new Promise<string>((resolve, reject) => {
            execFile("ffprobe", args, { maxBuffer: 1024 * 1024 * 10 }, (error, stdout, stderr) => {
                if (error) {
                    console.error("[ffprobe] Error:", error.message, stderr);
                    reject(error);
                } else {
                    resolve(stdout);
                }
            });
        });

        const data = JSON.parse(output);
        const audioStreams = data.streams?.filter((s: any) => s.codec_type === "audio") || [];

        const formattedTracks = audioStreams.map((s: any, idx: number) => ({
            index: idx,
            absoluteIndex: s.index,
            label: s.tags?.title || s.tags?.language || `Audio Track ${idx + 1}`,
            language: s.tags?.language || "und",
            codec: s.codec_name,
            default: s.disposition?.default === 1
        }));

        return new Response(JSON.stringify({ audioTracks: formattedTracks, isMkv }), {
            status: 200,
            headers: { "Content-Type": "application/json" }
        });
    } catch (err: any) {
        console.error("[tracks]", params.fileId, err.message);
        return new Response(err.message, { status: 500 });
    }
}
