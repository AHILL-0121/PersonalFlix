import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { fetchWithRetry } from "@/lib/fetchWithRetry";

/**
 * PATCH /api/library/override
 *
 * Manually updates the TMDB ID for a specific title and fetches its metadata live.
 * Returns the updated title data so the UI can instantly display the new poster.
 * Note: Episode metadata is simply cleared so the next library refresh pulls the new episodes.
 */
export async function PATCH(req: Request) {
    const { userId } = auth();
    if (!userId)
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    try {
        const body = await req.json();
        const { titleId, tmdbId, tmdbEpisodeSync } = body;

        if (!titleId) {
            return NextResponse.json({ error: "Missing titleId" }, { status: 400 });
        }

        const title = await db.title.findUnique({ where: { id: titleId } });
        if (!title) return NextResponse.json({ error: "Title not found" }, { status: 404 });

        let data: any = null;
        if (tmdbId) {
            const searchType = title.type === "movie" ? "movie" : "tv";
            const apiKey = process.env.TMDB_API_KEY;
            if (!apiKey) throw new Error("TMDB_API_KEY not configured");

            const url = `https://api.themoviedb.org/3/${searchType}/${tmdbId}?api_key=${apiKey}`;
            const res = await fetchWithRetry(url);
            if (!res.ok) {
                return NextResponse.json({ error: `Invalid TMDB ID or not found (Status ${res.status})` }, { status: 400 });
            }
            data = await res.json();

            const dateField = searchType === "movie" ? "release_date" : "first_air_date";
            const nameField = searchType === "movie" ? "title" : "name";

            const newMetadata = {
                tmdbId: parseInt(tmdbId, 10),
                name: data[nameField] || title.name,
                overview: data.overview || null,
                posterUrl: data.poster_path ? `https://image.tmdb.org/t/p/w500${data.poster_path}` : null,
                backdropUrl: data.backdrop_path ? `https://image.tmdb.org/t/p/w1280${data.backdrop_path}` : null,
                rating: data.vote_average || null,
                year: data[dateField] ? parseInt(data[dateField].slice(0, 4), 10) : null,
                tmdbEpisodeSync: tmdbEpisodeSync ?? false,
            };

            const updatedTitle = await db.title.update({
                where: { id: titleId },
                data: newMetadata,
            });
            await db.episode.updateMany({
                where: { titleId: titleId },
                data: { thumbnailUrl: null, overview: null },
            });
            return NextResponse.json({ ok: true, updated: updatedTitle });
        } else {
            // Just updated sync flag (e.g. they turned it on/off with existing TMDB ID)
            const updatedTitle = await db.title.update({
                where: { id: titleId },
                data: { tmdbEpisodeSync: tmdbEpisodeSync ?? false },
            });
            return NextResponse.json({ ok: true, updated: updatedTitle });
        }

    } catch (err: unknown) {
        console.error("[library/override PATCH] FULL ERROR:", err);
        const message = err instanceof Error ? err.message : "Error overriding TMDB ID";
        return NextResponse.json({ error: message }, { status: 500 });
    }
}

