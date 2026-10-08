import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

// GET /api/episode/:id → { mpd } — the manifest for switching episodes inside an open player
export async function GET(_req: Request, { params }: { params: { id: string } }) {
    const { userId } = auth();
    if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const ep = await db.episode.findUnique({ where: { id: params.id }, select: { mpd: true } });
    if (!ep?.mpd) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json({ mpd: ep.mpd }, { headers: { "Cache-Control": "no-store" } });
}
