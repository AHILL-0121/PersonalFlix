import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { getDriveToken } from "@/lib/driveToken";

export const dynamic = "force-dynamic";

// GET /api/token[?force=1] → { token, expiresAt } — a drive.readonly token for the player's Drive requests
export async function GET(req: Request) {
    const { userId } = auth();
    if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    try {
        const force = new URL(req.url).searchParams.get("force") === "1";
        return NextResponse.json(await getDriveToken(force), { headers: { "Cache-Control": "no-store" } });
    } catch (err) {
        const message = err instanceof Error ? err.message : "Token error";
        return NextResponse.json({ error: message }, { status: 502 });
    }
}
