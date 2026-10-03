import { auth } from "@clerk/nextjs/server";
import { NextResponse, type NextRequest } from "next/server";
import { openUploadSession, resolveTarget, trashFiles } from "@/lib/driveWrite";
import { specError, type UploadSpec } from "@/lib/naming";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * POST /api/upload/session { kind, title, year, season, episode, ext, size, replace? }
 *   → 200 { uploadUrl, path, key }   the browser PUTs the file to uploadUrl, straight to Drive
 *   → 409 { error, path, existing }  that movie/episode is already there; send replace: true to bin the old file
 *
 * The file name and folders are worked out here from the fields, never taken from the browser.
 */
export async function POST(req: NextRequest) {
    const { userId } = auth();
    if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const b = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const int = (v: unknown) => (v === null || v === undefined || v === "" ? null : Number(v));
    const spec: UploadSpec = {
        kind: b.kind === "series" ? "series" : "movie",
        title: String(b.title ?? "").trim(),
        year: int(b.year),
        season: b.kind === "series" ? int(b.season) : null,
        episode: b.kind === "series" ? int(b.episode) : null,
        ext: String(b.ext ?? "").toLowerCase(),
        size: Number(b.size),
    };
    const bad = specError(spec);
    if (bad) return NextResponse.json({ error: bad }, { status: 400 });

    // the upload URL only works from the origin that asked for it, so it must be this site's own
    const origin = req.headers.get("origin") ?? req.nextUrl.origin;
    if (new URL(origin).host !== (req.headers.get("x-forwarded-host") ?? req.headers.get("host"))) {
        return NextResponse.json({ error: "Bad origin" }, { status: 403 });
    }

    try {
        const target = await resolveTarget(spec);
        if (target.conflicts.length) {
            if (b.replace !== true) {
                return NextResponse.json(
                    { error: "Already in the library", path: target.path, existing: target.conflicts.map((f) => f.name) },
                    { status: 409 }
                );
            }
            await trashFiles(target.conflicts); // recoverable from Drive's bin for 30 days
        }
        const uploadUrl = await openUploadSession(target, spec, origin);
        return NextResponse.json({ uploadUrl, path: target.path, key: target.key }, { headers: { "Cache-Control": "no-store" } });
    } catch (err) {
        const message = err instanceof Error ? err.message : "Upload session error";
        console.error("[upload/session]", message);
        return NextResponse.json({ error: message }, { status: 502 });
    }
}
