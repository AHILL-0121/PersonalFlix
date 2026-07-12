import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { getDriveClient } from "@/lib/drive";

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

        // Get file metadata first to know content length and mime type
        const meta = await drive.files.get(
            {
                fileId: params.fileId,
                fields: "size,mimeType,name",
                supportsAllDrives: true,
            }
        );

        const fileSize = parseInt(meta.data.size ?? "0", 10);
        const mimeType = meta.data.mimeType ?? "video/mp4";

        let start = 0;
        let end = fileSize - 1;
        let status = 200;
        const responseHeaders: Record<string, string> = {
            "Content-Type": mimeType,
            "Accept-Ranges": "bytes",
            "Content-Disposition": `inline; filename="${meta.data.name ?? "video"}"`,
        };

        if (rangeHeader) {
            const match = rangeHeader.match(/bytes=(\d+)-(\d*)/);
            if (match) {
                start = parseInt(match[1], 10);
                end = match[2] ? parseInt(match[2], 10) : fileSize - 1;
                // Clamp end
                if (end >= fileSize) end = fileSize - 1;
                responseHeaders["Content-Range"] = `bytes ${start}-${end}/${fileSize}`;
                responseHeaders["Content-Length"] = String(end - start + 1);
                status = 206;
            }
        } else {
            responseHeaders["Content-Length"] = String(fileSize);
        }

        // Stream the byte range from Drive
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

        // @ts-expect-error — drive stream is a Node.js Readable
        const readable = driveStream.data as NodeJS.ReadableStream;

        // Convert Node.js stream to Web ReadableStream
        const webStream = new ReadableStream({
            start(controller) {
                readable.on("data", (chunk: Buffer) => controller.enqueue(chunk));
                readable.on("end", () => controller.close());
                readable.on("error", (err: Error) => controller.error(err));
            },
            cancel() {
                readable.destroy();
            },
        });

        return new Response(webStream, { status, headers: responseHeaders });
    } catch (err: unknown) {
        const message = err instanceof Error ? err.message : "Stream error";
        console.error("[stream]", params.fileId, message);
        return new Response(message, { status: 500 });
    }
}
