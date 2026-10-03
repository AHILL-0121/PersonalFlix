import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { fetchLibraryJson, type LibraryEntry } from "@/lib/driveToken";
import { fetchWithRetry } from "@/lib/fetchWithRetry";
import { isSyncCall } from "@/lib/syncAuth";

// A first sync of a few hundred entries takes a while; later ones skip everything unchanged,
// so a sync that runs out of time can simply be started again.
export const maxDuration = 60;
export const dynamic = "force-dynamic";

/**
 * Parse a Drive folder name into { cleanName, year }.
 *   "Aadukalam-2011" → Aadukalam / 2011 · "Ben 10: Alien Force - 2008" → Ben 10: Alien Force / 2008
 *   "Movie Name (2011)" → Movie Name / 2011
 */
function parseFolderName(raw: string): { cleanName: string; year: number | null } {
    const match = raw.match(/^(.*?)\s*-\s*(\d{4})$/);
    if (match) return { cleanName: match[1].trim(), year: parseInt(match[2], 10) };
    const parenMatch = raw.match(/^(.+?)\s*\((\d{4})\)\s*$/);
    if (parenMatch) return { cleanName: parenMatch[1].trim(), year: parseInt(parenMatch[2], 10) };
    return { cleanName: raw.trim(), year: null };
}

type TitleMeta = {
    tmdbId?: number;
    imdbId?: string;
    name?: string;
    overview?: string | null;
    posterUrl?: string | null;
    backdropUrl?: string | null;
    rating?: number | null;
    year?: number | null;
};

async function fetchTmdbInfo(folderName: string, type: "movie" | "series", explicitTmdbId?: number | null): Promise<TitleMeta | null> {
    const apiKey = process.env.TMDB_API_KEY;
    if (!apiKey) return null;
    try {
        const { cleanName, year } = parseFolderName(folderName);
        const searchType = type === "movie" ? "movie" : "tv";
        const nameField = type === "movie" ? "title" : "name";
        const dateField = type === "movie" ? "release_date" : "first_air_date";
        const yearParam = type === "movie" ? "primary_release_year" : "first_air_date_year";

        let result: any = null;

        // Manual override from /tmdb-config
        if (explicitTmdbId) {
            const res = await fetchWithRetry(`https://api.themoviedb.org/3/${searchType}/${explicitTmdbId}?api_key=${apiKey}`);
            if (res.ok) result = await res.json();
        }

        if (!result) {
            const search = async (withYear: boolean) => {
                const url = new URL(`https://api.themoviedb.org/3/search/${searchType}`);
                url.searchParams.set("api_key", apiKey);
                url.searchParams.set("query", cleanName);
                if (withYear && year) url.searchParams.set(yearParam, String(year));
                const res = await fetchWithRetry(url.toString());
                return res.ok ? (((await res.json()).results ?? []) as any[]) : [];
            };
            let results = await search(true);
            if (!results.length && year) results = await search(false);

            if (results.length) {
                const q = cleanName.trim().toLowerCase();
                const exact = results.filter((r) => (r[nameField] ?? "").trim().toLowerCase() === q);
                results = exact.length ? exact : results;
                if (year) {
                    const sameYear = results.filter((r) => (r[dateField] ?? "").startsWith(String(year)));
                    results = sameYear.length ? sameYear : results;
                }
                result = results[0];
            }
        }
        if (!result) return null;

        return {
            tmdbId: result.id as number,
            name: (result[nameField] as string) || undefined,
            overview: (result.overview as string) || null,
            posterUrl: result.poster_path ? `https://image.tmdb.org/t/p/w500${result.poster_path}` : null,
            backdropUrl: result.backdrop_path ? `https://image.tmdb.org/t/p/w1280${result.backdrop_path}` : null,
            rating: (result.vote_average as number) || null,
            year: result[dateField] ? parseInt((result[dateField] as string).slice(0, 4), 10) : null,
        };
    } catch {
        return null;
    }
}

async function fetchOmdbInfo(folderName: string, type: "movie" | "series"): Promise<TitleMeta | null> {
    const apiKey = process.env.OMDB_API_KEY;
    if (!apiKey) return null;
    try {
        const { cleanName, year } = parseFolderName(folderName);
        const yearParam = year ? `&y=${year}` : "";
        const res = await fetchWithRetry(
            `https://www.omdbapi.com/?apikey=${apiKey}&t=${encodeURIComponent(cleanName)}&type=${type}${yearParam}`
        );
        const data = await res.json();
        if (data.Response !== "True") return null;
        return {
            name: data.Title !== "N/A" ? data.Title : undefined,
            imdbId: data.imdbID !== "N/A" ? data.imdbID : undefined,
            posterUrl: data.Poster !== "N/A" ? data.Poster : null,
            overview: data.Plot !== "N/A" ? data.Plot : null,
            rating: data.imdbRating && data.imdbRating !== "N/A" ? parseFloat(data.imdbRating) : null,
            year: data.Year && data.Year !== "N/A" ? parseInt(data.Year, 10) : null,
            backdropUrl: data.Poster !== "N/A" ? data.Poster : null,
        };
    } catch {
        return null;
    }
}

/** TMDB first; OMDb only when TMDB has no match. */
async function fetchMetadataInfo(folderName: string, type: "movie" | "series", explicitTmdbId?: number | null) {
    return (await fetchTmdbInfo(folderName, type, explicitTmdbId)) ?? (await fetchOmdbInfo(folderName, type));
}

async function fetchTmdbEpisode(tmdbId: number, season: number, episode: number) {
    try {
        const res = await fetchWithRetry(
            `https://api.themoviedb.org/3/tv/${tmdbId}/season/${season}/episode/${episode}?api_key=${process.env.TMDB_API_KEY}`
        );
        if (!res.ok) return null;
        const d = await res.json();
        return {
            name: d.name && !/^episode\s*0?\d+$/i.test(String(d.name).trim()) ? (d.name as string) : null,
            overview: (d.overview as string) || null,
            thumbnailUrl: d.still_path ? `https://image.tmdb.org/t/p/w500${d.still_path}` : null,
        };
    } catch {
        return null;
    }
}

/** Run `tasks` with at most `limit` in flight; results keep input order. */
async function withConcurrency<T>(tasks: (() => Promise<T>)[], limit: number): Promise<T[]> {
    const results: T[] = new Array(tasks.length);
    let next = 0;
    const worker = async () => {
        while (next < tasks.length) {
            const i = next++;
            results[i] = await tasks[i]();
        }
    };
    await Promise.all(Array.from({ length: Math.min(limit, tasks.length) }, worker));
    return results;
}

/** "SERIES/Ben 10 - 2005/S01E05" → "SERIES/Ben 10 - 2005"; movie keys are already title keys. */
const titleKeyOf = (key: string, e: LibraryEntry) => (e.type === "series" ? key.split("/").slice(0, 2).join("/") : key);

/**
 * POST /api/library/refresh
 *
 * Copies STREAM/library.json (written by the convert notebook) into Postgres. Titles and episodes that
 * already exist are matched by library key, or by their source file's Drive ID for rows made by the old
 * folder scanner, so TMDB metadata, manual overrides and watch progress carry over.
 * Called by the Sync button, or by the convert notebook at the end of a run (Bearer SYNC_SECRET).
 */
export async function POST(req: Request) {
    const { userId } = auth();
    if (!userId && !isSyncCall(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    try {
        const library = await fetchLibraryJson();
        const entries = Object.entries(library.entries);

        const groups = new Map<string, [string, LibraryEntry][]>();
        for (const [key, e] of entries) {
            const tk = titleKeyOf(key, e);
            if (!groups.has(tk)) groups.set(tk, []);
            groups.get(tk)!.push([key, e]);
        }

        const titles = await db.title.findMany({
            select: { id: true, libraryKey: true, posterUrl: true, tmdbId: true, tmdbEpisodeSync: true, name: true },
        });
        const titleById = new Map(titles.map((t) => [t.id, t]));
        const titleByKey = new Map(titles.filter((t) => t.libraryKey).map((t) => [t.libraryKey!, t]));

        const episodes = await db.episode.findMany({
            select: {
                id: true, libraryKey: true, driveFileId: true, titleId: true, seasonId: true, convertedAt: true,
                name: true, thumbnailUrl: true, overview: true,
            },
        });
        const epByKey = new Map(episodes.filter((e) => e.libraryKey).map((e) => [e.libraryKey!, e]));
        const epBySrc = new Map(episodes.map((e) => [e.driveFileId, e]));

        let changed = 0, unchanged = 0, newTitles = 0;
        const errors: string[] = [];

        const tasks = Array.from(groups.entries()).map(([titleKey, items]) => async () => {
            try {
                const first = items[0][1];
                const type = first.type;
                const folderName = titleKey.split("/")[1] ?? first.title;

                // an existing title: by key, else via any of its episodes' source files (old scanner rows)
                let existing = titleByKey.get(titleKey);
                if (!existing) {
                    for (const [, e] of items) {
                        const legacy = epBySrc.get(e.srcId);
                        if (legacy && titleById.has(legacy.titleId)) {
                            existing = titleById.get(legacy.titleId);
                            break;
                        }
                    }
                }

                const meta = existing?.posterUrl ? null : await fetchMetadataInfo(folderName, type, existing?.tmdbId);
                const title = existing
                    ? await db.title.update({
                          where: { id: existing.id },
                          data: { libraryKey: titleKey, type, ...(meta ?? {}) },
                      })
                    : await db.title.create({
                          data: {
                              libraryKey: titleKey, type, ...(meta ?? {}),
                              name: meta?.name || first.title, year: meta?.year ?? first.year ?? null,
                          },
                      });
                if (!existing) newTitles++;

                const seasonIds = new Map<number, string>();
                const seasonIdFor = async (n: number) => {
                    if (!seasonIds.has(n)) {
                        const s = await db.season.upsert({
                            where: { titleId_number: { titleId: title.id, number: n } },
                            update: {},
                            create: { titleId: title.id, number: n },
                        });
                        seasonIds.set(n, s.id);
                    }
                    return seasonIds.get(n)!;
                };

                for (const [key, e] of items) {
                    const ex = epByKey.get(key) ?? epBySrc.get(e.srcId);
                    const seasonId = type === "series" ? await seasonIdFor(e.season ?? 1) : null;
                    if (ex && ex.libraryKey === key && ex.convertedAt === e.convertedAt && ex.titleId === title.id
                        && ex.driveFileId === e.srcId && ex.seasonId === seasonId) {
                        unchanged++;
                        continue;
                    }

                    // a different old-scanner row already holds this source ID (e.g. a duplicate file) — it's superseded
                    const clash = epBySrc.get(e.srcId);
                    if (clash && ex && clash.id !== ex.id) {
                        await db.episode.delete({ where: { id: clash.id } }).catch(() => {});
                    }

                    let name = type === "movie" ? title.name : e.epName || ex?.name || `Episode ${e.episode ?? 1}`;
                    let thumbnailUrl = ex?.thumbnailUrl ?? null;
                    let overview = ex?.overview ?? null;
                    if (type === "series" && title.tmdbEpisodeSync && title.tmdbId && !thumbnailUrl) {
                        const tm = await fetchTmdbEpisode(title.tmdbId, e.season ?? 1, e.episode ?? 1);
                        if (tm) {
                            name = tm.name ?? name;
                            overview = tm.overview ?? overview;
                            thumbnailUrl = tm.thumbnailUrl;
                        }
                    }

                    const data = {
                        libraryKey: key,
                        driveFileId: e.srcId,
                        titleId: title.id,
                        seasonId,
                        name,
                        order: type === "series" ? e.episode ?? 1 : 1,
                        durationSec: Math.round(e.duration) || null,
                        mpd: e.mpd,
                        audio: e.audio as unknown as Prisma.InputJsonValue,
                        height: e.height ?? null,
                        convertedAt: e.convertedAt,
                        thumbnailUrl,
                        overview,
                    };
                    if (ex) await db.episode.update({ where: { id: ex.id }, data });
                    else await db.episode.create({ data });
                    changed++;
                }
            } catch (err) {
                errors.push(`${titleKey}: ${err instanceof Error ? err.message : String(err)}`);
            }
        });
        await withConcurrency(tasks, 4);

        // entries removed from library.json. Rows from the old scanner (no libraryKey) are left alone —
        // they're hidden from the UI until the notebook converts them, and keep their watch progress.
        const keys = entries.map(([k]) => k);
        const prunedEpisodes = await db.episode.deleteMany({
            where: { libraryKey: { not: null, notIn: keys } },
        });
        const prunedTitles = await db.title.deleteMany({
            where: { libraryKey: { not: null, notIn: Array.from(groups.keys()) }, episodes: { none: {} } },
        });

        await db.syncState.upsert({
            where: { id: 1 },
            update: { syncedAt: new Date(), libraryUpdatedAt: library.updatedAt ?? null, entries: entries.length },
            create: { id: 1, libraryUpdatedAt: library.updatedAt ?? null, entries: entries.length },
        });

        return NextResponse.json({
            ok: errors.length === 0,
            entries: entries.length,
            changed,
            unchanged,
            newTitles,
            prunedEpisodes: prunedEpisodes.count,
            prunedTitles: prunedTitles.count,
            errors: errors.slice(0, 10),
        });
    } catch (err: unknown) {
        const message = err instanceof Error ? err.message : "Refresh error";
        console.error("[library/refresh]", message);
        return NextResponse.json({ error: message }, { status: 500 });
    }
}
