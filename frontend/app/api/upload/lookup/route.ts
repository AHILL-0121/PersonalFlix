import { auth } from "@clerk/nextjs/server";
import { NextResponse, type NextRequest } from "next/server";
import { fetchWithRetry } from "@/lib/fetchWithRetry";

export const dynamic = "force-dynamic";

export interface LookupResult {
    tmdbId: number;
    title: string;
    year: number | null;
    poster: string | null;
}

/** GET /api/upload/lookup?type=movie|series&q=…&year=… → { results } — TMDB matches to name an upload by */
export async function GET(req: NextRequest) {
    const { userId } = auth();
    if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const apiKey = process.env.TMDB_API_KEY;
    const p = req.nextUrl.searchParams;
    const query = (p.get("q") ?? "").trim();
    if (!apiKey || !query) return NextResponse.json({ results: [] });

    const tv = p.get("type") === "series";
    const year = /^\d{4}$/.test(p.get("year") ?? "") ? p.get("year")! : null;
    const search = async (withYear: boolean) => {
        const url = new URL(`https://api.themoviedb.org/3/search/${tv ? "tv" : "movie"}`);
        url.searchParams.set("api_key", apiKey);
        url.searchParams.set("query", query);
        if (withYear && year) url.searchParams.set(tv ? "first_air_date_year" : "primary_release_year", year);
        const res = await fetchWithRetry(url.toString());
        return res.ok ? (((await res.json()).results ?? []) as Record<string, any>[]) : [];
    };
    try {
        let raw = await search(true);
        if (!raw.length && year) raw = await search(false);
        const results: LookupResult[] = raw.slice(0, 6).map((r) => {
            const date = String((tv ? r.first_air_date : r.release_date) ?? "");
            return {
                tmdbId: r.id,
                title: String((tv ? r.name : r.title) ?? ""),
                year: /^\d{4}/.test(date) ? parseInt(date.slice(0, 4), 10) : null,
                poster: r.poster_path ? `https://image.tmdb.org/t/p/w154${r.poster_path}` : null,
            };
        });
        return NextResponse.json({ results }, { headers: { "Cache-Control": "private, max-age=3600" } });
    } catch {
        return NextResponse.json({ results: [] });
    }
}
