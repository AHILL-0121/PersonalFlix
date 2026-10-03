import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { recentUploads } from "@/lib/driveWrite";

export const dynamic = "force-dynamic";

export interface UploadStatusItem {
    id: string;
    name: string;
    key: string | null;
    size: number;
    createdTime: string;
    /** set once the notebook has converted it and the library has synced */
    ready: { episodeId: string; title: string } | null;
}

/** GET /api/upload/status → { items, waiting, syncedAt } — recent uploads and whether each is playable yet */
export async function GET() {
    const { userId } = auth();
    if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    try {
        const files = await recentUploads();
        const [episodes, sync] = await Promise.all([
            db.episode.findMany({
                where: { driveFileId: { in: files.map((f) => f.id) }, mpd: { not: null } },
                select: { id: true, driveFileId: true, title: { select: { name: true } } },
            }),
            db.syncState.findUnique({ where: { id: 1 } }),
        ]);
        const bySrc = new Map(episodes.map((e) => [e.driveFileId, e]));
        const items: UploadStatusItem[] = files.map((f) => {
            const ep = bySrc.get(f.id);
            return {
                id: f.id,
                name: f.name,
                key: f.properties?.pfKey ?? null,
                size: Number(f.size ?? 0),
                createdTime: f.createdTime ?? "",
                ready: ep ? { episodeId: ep.id, title: ep.title.name } : null,
            };
        });
        return NextResponse.json(
            { items, waiting: items.filter((i) => !i.ready).length, syncedAt: sync?.syncedAt ?? null },
            { headers: { "Cache-Control": "no-store" } }
        );
    } catch (err) {
        const message = err instanceof Error ? err.message : "Status error";
        return NextResponse.json({ error: message }, { status: 502 });
    }
}
