import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getDriveClient } from "@/lib/drive";

async function fetchTmdbInfo(titleName: string, type: "movie" | "series") {
    const apiKey = process.env.TMDB_API_KEY;
    if (!apiKey) return null;
    try {
        const cleanName = titleName.replace(/\(\d{4}\)/, "").trim();
        const searchType = type === "movie" ? "movie" : "tv";
        const res = await fetch(`https://api.themoviedb.org/3/search/${searchType}?api_key=${apiKey}&query=${encodeURIComponent(cleanName)}`);
        const data = await res.json();

        if (data.results && data.results.length > 0) {
            const result = data.results[0];
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
        const cleanName = titleName.replace(/\(\d{4}\)/, "").trim(); // Remove year like (2010) strictly for search
        const res = await fetch(`http://www.omdbapi.com/?apikey=${apiKey}&t=${encodeURIComponent(cleanName)}&type=${type}`);
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
 * POST /api/library/refresh
 *
 * Walks the Drive MAIN folder, syncs the folder tree into Postgres:
 *  - Top-level sub-folders → Title (type determined by parent folder name, or simple heuristic)
 *  - Second-level "Season X" sub-folders → Season
 *  - Video files → Episode
 *
 * This is called by the "Refresh Library" button in the UI.
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

        const isFolder = (f: { mimeType?: string | null }) => {
            return f.mimeType === FOLDER_MIME;
        };
        const isVideo = (f: { mimeType?: string | null; name?: string | null }) => {
            const hasVideoMime = VIDEO_MIMES.has(f.mimeType ?? "");
            const hasVideoExt = VIDEO_EXTS.some(ext => f.name?.toLowerCase().endsWith(ext));
            return hasVideoMime || hasVideoExt;
        };

        // Natural sort for season/folder ordering (extracts first number, e.g. "Season 08" → 8)
        const naturalOrder = (name: string): number => {
            const m = name.match(/(\d+)/);
            return m ? parseInt(m[1], 10) : 0;
        };

        // Locale-aware numeric sort for episode filenames
        // e.g. "therookie-S08E09.mkv" < "therookie-S08E18.mkv"
        const episodeSort = (a: string, b: string): number => {
            return a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });
        };

        // ── Purge stale category-level titles from the old (wrong) scan logic ───
        // Old code treated the MOVIE/SERIES folders themselves as Titles.
        // Delete them before rescanning so they don't linger.
        await db.title.deleteMany({
            where: {
                name: { in: ["MOVIE", "MOVIES", "SERIES", "movie", "movies", "series"] },
            },
        });

        // ── Walk root ────────────────────────────────────────────────────────────
        // Drive structure: MAIN → MOVIE|SERIES (category, defines type)
        //                       → Title folders (e.g. "The Rookie")
        //                       → Season folders (e.g. "Season 08")
        //                       → Episode video files
        const categoryFolders = await listFolder(rootFolderId);
        let processed = 0;

        for (const categoryFolder of categoryFolders) {
            if (!isFolder(categoryFolder)) continue;
            if (!categoryFolder.id || !categoryFolder.name) continue;

            // Category folder name determines type: "MOVIE" / "MOVIES" → movie, everything else → series
            const lowerName = categoryFolder.name.toLowerCase();
            const titleType: "movie" | "series" =
                lowerName === "movie" || lowerName === "movies" ? "movie" : "series";

            // One level deeper: these are the actual Titles (e.g. "The Rookie")
            const titleFolders = await listFolder(categoryFolder.id);

            for (const titleFolder of titleFolders) {
                if (!isFolder(titleFolder)) continue;
                if (!titleFolder.id || !titleFolder.name) continue;

                // Fetch Metadata Info
                const metadataInfo = await fetchMetadataInfo(titleFolder.name, titleType);

                // Upsert Title
                const title = await db.title.upsert({
                    where: { driveFolderId: titleFolder.id },
                    update: {
                        name: titleFolder.name, type: titleType,
                        ...(metadataInfo || {})
                    },
                    create: {
                        driveFolderId: titleFolder.id,
                        name: titleFolder.name,
                        type: titleType,
                        ...(metadataInfo || {})
                    },
                });

                const titleChildren = await listFolder(titleFolder.id);

                if (titleType === "movie") {
                    // Movie: find the single video file directly inside the title folder
                    const videoFiles = titleChildren
                        .filter(isVideo)
                        .sort((a, b) => episodeSort(a.name ?? "", b.name ?? ""));

                    for (let i = 0; i < videoFiles.length; i++) {
                        const f = videoFiles[i];
                        if (!f.id || !f.name) continue;

                        const metadataEp = await fetchMetadataInfo(f.name, "movie");

                        await db.episode.upsert({
                            where: { driveFileId: f.id },
                            update: { name: title.name, order: i + 1, titleId: title.id, ...(metadataEp || {}) },
                            create: {
                                driveFileId: f.id,
                                name: title.name,
                                order: i + 1,
                                titleId: title.id,
                                ...(metadataEp || {})
                            },
                        });
                        processed++;
                    }
                } else {
                    // Series: iterate season sub-folders sorted numerically
                    const seasonFolders = titleChildren
                        .filter(isFolder)
                        .sort((a, b) => naturalOrder(a.name ?? "") - naturalOrder(b.name ?? ""));

                    for (const sf of seasonFolders) {
                        if (!sf.id || !sf.name) continue;

                        // Parse "Season 08" → 8, fallback to 0
                        const seasonNumber = parseInt(
                            sf.name.match(/\d+/)?.[0] ?? "0",
                            10
                        );

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

                            const metadataEp = await fetchMetadataEpisode(title.name, title.tmdbId, seasonNumber, ei + 1);

                            // If OMDb fails or doesn't find the episode, use a clean fallback instead of the raw .mkv filename
                            const fallbackName = `Episode ${ei + 1}`;

                            await db.episode.upsert({
                                where: { driveFileId: ef.id },
                                update: {
                                    name: fallbackName,
                                    order: ei + 1,
                                    seasonId: season.id,
                                    titleId: title.id,
                                    ...(metadataEp || {})
                                },
                                create: {
                                    driveFileId: ef.id,
                                    name: fallbackName,
                                    order: ei + 1,
                                    seasonId: season.id,
                                    titleId: title.id,
                                    ...(metadataEp || {})
                                },
                            });
                            processed++;
                        }
                    }
                }
            }
        }

        return NextResponse.json({ ok: true, processed });
    } catch (err: unknown) {
        const message = err instanceof Error ? err.message : "Refresh error";
        console.error("[library/refresh]", message);
        return NextResponse.json({ error: message }, { status: 500 });
    }
}
