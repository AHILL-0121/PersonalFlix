import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getDriveClient } from "@/lib/drive";

/**
 * Parse a folder name like "Aadukalam-2011" or "Movie Name 2-2022" into
 * { cleanName: "Aadukalam", year: 2011 }.  Falls back gracefully if the
 * trailing dash-year pattern is not found.
 */
function parseFolderName(raw: string): { cleanName: string; year: number | null } {
    // Match a trailing dash followed by exactly 4 digits (e.g. "-2011")
    const match = raw.match(/^(.+)-(\d{4})$/);
    if (match) {
        return { cleanName: match[1].trim(), year: parseInt(match[2], 10) };
    }
    // Also handle parenthesised years like "Movie Name (2011)"
    const parenMatch = raw.match(/^(.+?)\s*\((\d{4})\)\s*$/);
    if (parenMatch) {
        return { cleanName: parenMatch[1].trim(), year: parseInt(parenMatch[2], 10) };
    }
    return { cleanName: raw.trim(), year: null };
}

async function fetchTmdbInfo(titleName: string, type: "movie" | "series") {
    const apiKey = process.env.TMDB_API_KEY;
    if (!apiKey) return null;
    try {
        const { cleanName, year } = parseFolderName(titleName);
        const searchType = type === "movie" ? "movie" : "tv";
        // Include year filter when available — greatly improves accuracy
        const yearParam = year ? `&${type === "movie" ? "primary_release_year" : "first_air_date_year"}=${year}` : "";
        const res = await fetch(
            `https://api.themoviedb.org/3/search/${searchType}?api_key=${apiKey}&query=${encodeURIComponent(cleanName)}${yearParam}`
        );
        const data = await res.json();

        // If no results with year filter, retry without it
        let results = data.results ?? [];
        if (results.length === 0 && year) {
            const fallback = await fetch(
                `https://api.themoviedb.org/3/search/${searchType}?api_key=${apiKey}&query=${encodeURIComponent(cleanName)}`
            );
            const fallbackData = await fallback.json();
            results = fallbackData.results ?? [];
        }

        if (results.length > 0) {
            const result = results[0];
            return {
                tmdbId: result.id,
                name: result.title || result.name || undefined,
                overview: result.overview || null,
                posterUrl: result.poster_path ? `https://image.tmdb.org/t/p/w500${result.poster_path}` : null,
                backdropUrl: result.backdrop_path ? `https://image.tmdb.org/t/p/w1280${result.backdrop_path}` : null,
                rating: result.vote_average || null,
                year: result.release_date ? parseInt(result.release_date) : (result.first_air_date ? parseInt(result.first_air_date) : null),
            };
        }
    } catch (e) { }
    return null;
}

async function fetchTmdbEpisode(tmdbId: number, seasonNumber: number, episodeNumber: number) {
    const apiKey = process.env.TMDB_API_KEY;
    if (!apiKey || !tmdbId) return null;
    try {
        // Fetch specific episode details using TMDB ID
        const res = await fetch(`https://api.themoviedb.org/3/tv/${tmdbId}/season/${seasonNumber}/episode/${episodeNumber}?api_key=${apiKey}`);
        const data = await res.json();

        if (data.id) {
            return {
                name: data.name || undefined,
                thumbnailUrl: data.still_path ? `https://image.tmdb.org/t/p/w500${data.still_path}` : null,
                overview: data.overview || null,
            };
        }
    } catch (e) { }
    return null;
}

async function fetchOmdbInfo(titleName: string, type: "movie" | "series") {
    const apiKey = process.env.OMDB_API_KEY;
    if (!apiKey) return null;
    try {
        const { cleanName, year } = parseFolderName(titleName);
        const yearParam = year ? `&y=${year}` : "";
        const res = await fetch(
            `http://www.omdbapi.com/?apikey=${apiKey}&t=${encodeURIComponent(cleanName)}&type=${type}${yearParam}`
        );
        const data = await res.json();
        if (data.Response === "True") {
            return {
                name: data.Title !== "N/A" ? data.Title : undefined,
                imdbId: data.imdbID !== "N/A" ? data.imdbID : undefined,
                posterUrl: data.Poster !== "N/A" ? data.Poster : null,
                overview: data.Plot !== "N/A" ? data.Plot : null,
                rating: data.imdbRating && data.imdbRating !== "N/A" ? parseFloat(data.imdbRating) : null,
                year: data.Year && data.Year !== "N/A" ? parseInt(data.Year) : null,
                backdropUrl: data.Poster !== "N/A" ? data.Poster : null, // OMDB has no backdrops, fallback to poster
            };
        }
    } catch (e) { }
    return null;
}

async function fetchOmdbEpisode(titleName: string, seasonNumber: number, episodeNumber: number) {
    const apiKey = process.env.OMDB_API_KEY;
    if (!apiKey) return null;
    try {
        const cleanName = titleName.replace(/\(\d{4}\)/, "").trim();
        const res = await fetch(`http://www.omdbapi.com/?apikey=${apiKey}&t=${encodeURIComponent(cleanName)}&Season=${seasonNumber}&Episode=${episodeNumber}`);
        const data = await res.json();
        if (data.Response === "True") {
            return {
                name: data.Title !== "N/A" ? data.Title : undefined,
                imdbId: data.imdbID !== "N/A" ? data.imdbID : undefined,
                thumbnailUrl: data.Poster !== "N/A" ? data.Poster : null,
                overview: data.Plot !== "N/A" ? data.Plot : null,
            };
        }
    } catch (e) { }
    return null;
}

async function fetchMetadataInfo(titleName: string, type: "movie" | "series") {
    const tmdb = await fetchTmdbInfo(titleName, type);
    const omdb = await fetchOmdbInfo(titleName, type);
    return { ...(omdb || {}), ...(tmdb || {}) }; // TMDB takes priority if exists
}

async function fetchMetadataEpisode(titleName: string, tmdbId: number | null | undefined, seasonNumber: number, episodeNumber: number) {
    const tmdb = tmdbId ? await fetchTmdbEpisode(tmdbId, seasonNumber, episodeNumber) : null;
    const omdb = await fetchOmdbEpisode(titleName, seasonNumber, episodeNumber);
    return { ...(omdb || {}), ...(tmdb || {}) }; // TMDB takes priority
}

/**
 * DELETE /api/library/refresh
 *
 * Clears all cached metadata (posterUrl, tmdbId, overview, rating, etc.) from
 * every Title and Episode in the DB so the next POST refresh re-fetches
 * everything from TMDb/OMDb from scratch.
 *
 * Useful when previous scans stored incorrect posters/names.
 */
export async function DELETE() {
    const { userId } = auth();
    if (!userId)
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    try {
        const [titleCount, episodeCount] = await Promise.all([
            db.title.updateMany({
                data: {
                    posterUrl: null,
                    backdropUrl: null,
                    tmdbId: null,
                    imdbId: null,
                    overview: null,
                    rating: null,
                    year: null,
                },
            }),
            db.episode.updateMany({
                data: {
                    thumbnailUrl: null,
                    overview: null,
                },
            }),
        ]);

        console.log(`[library/refresh] Cleared metadata: ${titleCount.count} titles, ${episodeCount.count} episodes`);
        return NextResponse.json({ ok: true, titlesCleared: titleCount.count, episodesCleared: episodeCount.count });
    } catch (err: unknown) {
        const message = err instanceof Error ? err.message : "Clear error";
        console.error("[library/refresh DELETE]", message);
        return NextResponse.json({ error: message }, { status: 500 });
    }
}

/**
 * Run `tasks` with at most `limit` in-flight at once.
 * Returns results in the same order as the input array.
 */
async function withConcurrency<T>(
    tasks: (() => Promise<T>)[],
    limit: number
): Promise<T[]> {
    const results: T[] = new Array(tasks.length);
    let nextIdx = 0;

    const worker = async () => {
        while (nextIdx < tasks.length) {
            const idx = nextIdx++;
            results[idx] = await tasks[idx]();
        }
    };

    const workers = Array.from({ length: Math.min(limit, tasks.length) }, worker);
    await Promise.all(workers);
    return results;
}

/**
 * POST /api/library/refresh
 *
 * Walks the Drive MAIN folder, syncs the folder tree into Postgres.
 * Optimised: skips metadata API calls for titles already in the DB with a
 * poster, and processes up to CONCURRENCY titles in parallel.
 */
export async function POST() {
    const { userId } = auth();
    if (!userId)
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const rootFolderId = process.env.DRIVE_ROOT_FOLDER_ID;
    if (!rootFolderId) {
        return NextResponse.json(
            { error: "DRIVE_ROOT_FOLDER_ID not configured" },
            { status: 500 }
        );
    }

    try {
        const drive = getDriveClient();

        // ── Helpers ─────────────────────────────────────────────────────────────
        const listFolder = async (folderId: string) => {
            const res = await drive.files.list({
                q: `'${folderId}' in parents and trashed = false`,
                fields: "files(id,name,mimeType,size)",
                supportsAllDrives: true,
                includeItemsFromAllDrives: true,
                pageSize: 1000,
            });
            return res.data.files ?? [];
        };

        const FOLDER_MIME = "application/vnd.google-apps.folder";
        const VIDEO_MIMES = new Set(["video/mp4", "video/x-matroska", "video/webm"]);
        const VIDEO_EXTS = [".mp4", ".mkv", ".webm", ".avi", ".mov", ".flv", ".wmv"];

        const isFolder = (f: { mimeType?: string | null }) =>
            f.mimeType === FOLDER_MIME;

        const isVideo = (f: { mimeType?: string | null; name?: string | null }) =>
            VIDEO_MIMES.has(f.mimeType ?? "") ||
            VIDEO_EXTS.some(ext => f.name?.toLowerCase().endsWith(ext));

        const naturalOrder = (name: string) => {
            const m = name.match(/(\d+)/);
            return m ? parseInt(m[1], 10) : 0;
        };

        const episodeSort = (a: string, b: string) =>
            a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });


        // ── Purge legacy category-level stubs ────────────────────────────────────
        await db.title.deleteMany({
            where: {
                name: { in: ["MOVIE", "MOVIES", "SERIES", "movie", "movies", "series"] },
            },
        });

        // ── Pre-load existing titles so we can skip metadata for known entries ──
        // Key: driveFolderId → existing Title row
        const existingTitles = await db.title.findMany({
            select: { id: true, driveFolderId: true, posterUrl: true, tmdbId: true, name: true },
        });
        const existingMap = new Map(existingTitles.map(t => [t.driveFolderId, t]));

        // ── Pre-load existing episodes for the same reason ───────────────────────
        const existingEpisodes = await db.episode.findMany({
            select: { driveFileId: true, thumbnailUrl: true, transcodeStatus: true },
        });
        const existingEpMap = new Map(existingEpisodes.map(e => [e.driveFileId, e]));

        // ── Walk root ────────────────────────────────────────────────────────────
        const categoryFolders = await listFolder(rootFolderId);
        let processed = 0;
        const seenDriveFolderIds = new Set<string>();
        const CONCURRENCY = 6; // parallel title-processing slots

        for (const categoryFolder of categoryFolders) {
            if (!isFolder(categoryFolder)) continue;
            if (!categoryFolder.id || !categoryFolder.name) continue;

            const lowerName = categoryFolder.name.toLowerCase();
            const titleType: "movie" | "series" =
                lowerName === "movie" || lowerName === "movies" ? "movie" : "series";

            const titleFolders = await listFolder(categoryFolder.id);

            // Build one task per title folder, then run them in parallel batches
            const tasks = titleFolders
                .filter(tf => isFolder(tf) && tf.id && tf.name)
                .map(titleFolder => async () => {
                    const folderId = titleFolder.id!;
                    const folderName = titleFolder.name!;
                    seenDriveFolderIds.add(folderId);

                    const existing = existingMap.get(folderId);

                    // Only call TMDb/OMDb if this title has no poster yet
                    const needsMeta = !existing?.posterUrl;
                    const metadataInfo = needsMeta
                        ? await fetchMetadataInfo(folderName, titleType)
                        : null;

                    // Upsert Title
                    const title = await db.title.upsert({
                        where: { driveFolderId: folderId },
                        update: {
                            name: folderName,
                            type: titleType,
                            ...(metadataInfo || {}),
                        },
                        create: {
                            driveFolderId: folderId,
                            name: folderName,
                            type: titleType,
                            ...(metadataInfo || {}),
                        },
                    });

                    const titleChildren = await listFolder(folderId);
                    let localProcessed = 0;

                    if (titleType === "movie") {
                        const videoFiles = titleChildren
                            .filter(isVideo)
                            .sort((a, b) => episodeSort(a.name ?? "", b.name ?? ""));

                        for (let i = 0; i < videoFiles.length; i++) {
                            const f = videoFiles[i];
                            if (!f.id || !f.name) continue;

                            const isMkv = (f.mimeType?.includes("matroska") || f.mimeType?.includes("mkv") || f.name?.toLowerCase().endsWith(".mkv")) ?? false;
                            // Only stamp pending for NEW rows or rows that haven't been
                            // queued yet (transcodeStatus = null). Never downgrade done→pending.
                            const existingStatus = existingEpMap.get(f.id) as any;
                            const shouldSetPending = isMkv && !existingStatus?.transcodeStatus;

                            await db.episode.upsert({
                                where: { driveFileId: f.id },
                                update: {
                                    name: title.name,
                                    order: i + 1,
                                    titleId: title.id,
                                    ...(shouldSetPending ? { mkvFileId: f.id, transcodeStatus: "pending" } : {}),
                                },
                                create: {
                                    driveFileId: f.id,
                                    name: title.name,
                                    order: i + 1,
                                    titleId: title.id,
                                    ...(isMkv ? { mkvFileId: f.id, transcodeStatus: "pending" } : {}),
                                },
                            });
                            localProcessed++;
                        }
                    } else {
                        // Series
                        const seasonFolders = titleChildren
                            .filter(isFolder)
                            .sort((a, b) => naturalOrder(a.name ?? "") - naturalOrder(b.name ?? ""));

                        for (const sf of seasonFolders) {
                            if (!sf.id || !sf.name) continue;

                            const seasonNumber = parseInt(sf.name.match(/\d+/)?.[0] ?? "0", 10);

                            const season = await db.season.upsert({
                                where: { titleId_number: { titleId: title.id, number: seasonNumber } },
                                update: {},
                                create: { titleId: title.id, number: seasonNumber },
                            });

                            const episodeFiles = (await listFolder(sf.id))
                                .filter(isVideo)
                                .sort((a, b) => episodeSort(a.name ?? "", b.name ?? ""));

                            for (let ei = 0; ei < episodeFiles.length; ei++) {
                                const ef = episodeFiles[ei];
                                if (!ef.id || !ef.name) continue;

                                // Only fetch episode metadata if the episode has no thumbnail yet
                                const existingEp = existingEpMap.get(ef.id);
                                const needsEpMeta = !existingEp?.thumbnailUrl;
                                const metadataEp = needsEpMeta
                                    ? await fetchMetadataEpisode(title.name, title.tmdbId, seasonNumber, ei + 1)
                                    : null;

                                const isMkv = (ef.mimeType?.includes("matroska") || ef.mimeType?.includes("mkv") || ef.name?.toLowerCase().endsWith(".mkv")) ?? false;
                                const existingStatus = existingEpMap.get(ef.id) as any;
                                const shouldSetPending = isMkv && !existingStatus?.transcodeStatus;

                                const fallbackName = `Episode ${ei + 1}`;
                                await db.episode.upsert({
                                    where: { driveFileId: ef.id },
                                    update: {
                                        name: metadataEp?.name ?? fallbackName,
                                        order: ei + 1,
                                        seasonId: season.id,
                                        titleId: title.id,
                                        ...(metadataEp || {}),
                                        ...(shouldSetPending && { mkvFileId: ef.id, transcodeStatus: "pending" }),
                                    },
                                    create: {
                                        driveFileId: ef.id,
                                        name: metadataEp?.name ?? fallbackName,
                                        order: ei + 1,
                                        seasonId: season.id,
                                        titleId: title.id,
                                        ...(metadataEp || {}),
                                        ...(isMkv && { mkvFileId: ef.id, transcodeStatus: "pending" }),
                                    },
                                });
                                localProcessed++;
                            }
                        }
                    }

                    return localProcessed;
                });

            const counts = await withConcurrency(tasks, CONCURRENCY);
            processed += counts.reduce((a, b) => a + b, 0);
        }

        // ── Prune stale titles ────────────────────────────────────────────────────
        const stale = await db.title.findMany({
            where: { driveFolderId: { notIn: Array.from(seenDriveFolderIds) } },
            select: { id: true, name: true },
        });
        if (stale.length > 0) {
            const staleIds = stale.map(t => t.id);
            console.log(`[library/refresh] Pruning ${stale.length} stale title(s):`, stale.map(t => t.name));
            await db.watchProgress.deleteMany({ where: { episode: { titleId: { in: staleIds } } } });
            await db.episode.deleteMany({ where: { titleId: { in: staleIds } } });
            await db.season.deleteMany({ where: { titleId: { in: staleIds } } });
            await db.title.deleteMany({ where: { id: { in: staleIds } } });
        }

        return NextResponse.json({ ok: true, processed, pruned: stale.length });
    } catch (err: unknown) {
        const message = err instanceof Error ? err.message : "Refresh error";
        console.error("[library/refresh]", message);
        return NextResponse.json({ error: message }, { status: 500 });
    }
}

