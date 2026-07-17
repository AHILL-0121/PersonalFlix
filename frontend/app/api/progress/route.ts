import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { db } from "@/lib/db";

// GET /api/progress?episodeId=...
export async function GET(req: Request) {
    const { userId } = auth();
    if (!userId)
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { searchParams } = new URL(req.url);
    const episodeId = searchParams.get("episodeId");
    if (!episodeId)
        return NextResponse.json({ error: "episodeId required" }, { status: 400 });

    const progress = await db.watchProgress.findUnique({ where: { episodeId } });
    return NextResponse.json({ episodeId, positionSec: progress?.positionSec ?? 0 });
}

// POST /api/progress  body: { episodeId, positionSec }
export async function POST(req: Request) {
    const { userId } = auth();
    if (!userId)
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const body = (await req.json()) as { episodeId?: string; positionSec?: number };
    const { episodeId, positionSec } = body;

    if (!episodeId || positionSec === undefined)
        return NextResponse.json(
            { error: "episodeId and positionSec required" },
            { status: 400 }
        );

    const record = await db.watchProgress.upsert({
        where: { episodeId },
        update: { positionSec },
        create: { episodeId, positionSec },
    });

    return NextResponse.json(record);
}

// DELETE /api/progress?episodeId=...
export async function DELETE(req: Request) {
    const { userId } = auth();
    if (!userId)
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { searchParams } = new URL(req.url);
    const episodeId = searchParams.get("episodeId");
    if (!episodeId)
        return NextResponse.json({ error: "episodeId required" }, { status: 400 });

    try {
        await db.watchProgress.delete({ where: { episodeId } });
    } catch { }

    return NextResponse.json({ success: true });
}
