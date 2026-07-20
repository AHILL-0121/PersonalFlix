import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getDriveClient } from "@/lib/drive";
import { fetchWithRetry } from "@/lib/fetchWithRetry";

/**
 * Parse a Drive folder name into { cleanName, year }.
 *
 * Handles all formats seen in the user's Drive:
 *   Movies:  "Aadukalam-2011"         → { cleanName: "Aadukalam",          year: 2011 }
 *            "Angels & Demons-2009"   → { cleanName: "Angels & Demons",    year: 2009 }
 *            "Aranmanai 2-2014"       → { cleanName: "Aranmanai 2",        year: 2014 }
 *   Series:  "Ben 10: Alien Force - 2008" → { cleanName: "Ben 10: Alien Force", year: 2008 }
 *            "Courage the Cowardly Dog - 1999"
 *
 * Algorithm: strip the LAST occurrence of an optional space + dash + 4-digit year
 * from the end of the string, which covers both "Name-Year" and "Name - Year".
 */
function parseFolderName(raw: string): { cleanName: string; year: number | null } {
    // Match trailing:  [ " - " | "-" ] followed by exactly 4 digits at end of string
    const match = raw.match(/^(.*?)\s*-\s*(\d{4})$/);
    if (match) {
        return { cleanName: match[1].trim(), year: parseInt(match[2], 10) };
    }
    // Parenthesised year fallback: "Movie Name (2011)"
    const parenMatch = raw.match(/^(.+?)\s*\((\d{4})\)\s*$/);
    if (parenMatch) {
        return { cleanName: parenMatch[1].trim(), year: parseInt(parenMatch[2], 10) };
    }
    return { cleanName: raw.trim(), year: null };
}


/**
 * Normalise combined-episode separators in a filename title portion to " / ".
 */
function normaliseEpisodeName(raw: string): string {
    return raw
        .trim()
        .replace(/\s*\/\s*/g, " / ")
        .replace(/\s+&\s+/g, " / ")
        .replace(/\s+-\s+/g, " / ")
        .replace(/^\s*\/\s*|\s*\/\s*$/g, "")
        .trim();
}

/**
 * Parse episode metadata directly from a filename.
 *
 * Searches for a season+episode code ANYWHERE in the filename (not just at
 * the start) so filenames like:
 *   "Ben 10 Alien Force - S01E01.MP4"
 *   "S01E01 A Night at the Katz Motel-Cajun Granny Stew.mkv"
 *   "Koose Munisamy Veerappan S01-01-First Blood.mp4"
 * are all handled correctly.
 *
 * Returns null if no recognisable pattern is found.
 */
function parseEpisodeFilename(filename: string): {
    seasonNumber: number;
    episodeNumber: number;
    episodeName: string;
} | null {
    const base = filename.replace(/\.[^.]+$/, "");

    // Pattern 1: S01E01 or S1E1 anywhere in the string
    const seMatch = base.match(/[Ss](\d{1,2})[Ee](\d{1,3})/);
    if (seMatch) {
        const afterCode = base.slice(seMatch.index! + seMatch[0].length).replace(/^[\s\-_.]+/, "");
        return {
            seasonNumber: parseInt(seMatch[1], 10),
            episodeNumber: parseInt(seMatch[2], 10),
            episodeName: normaliseEpisodeName(afterCode),
        };
    }

    // Pattern 2: S01-01 style (dash between season and episode number)
    const dashMatch = base.match(/[Ss](\d{1,2})-(\d{1,2})[-\s]/);
    if (dashMatch) {
        const afterCode = base.slice(dashMatch.index! + dashMatch[0].length).replace(/^[\s\-_.]+/, "");
        return {
            seasonNumber: parseInt(dashMatch[1], 10),
            episodeNumber: parseInt(dashMatch[2], 10),
            episodeName: normaliseEpisodeName(afterCode),
        };
    }

    // Pattern 3: 1x01 style anywhere
    const xMatch = base.match(/(\d{1,2})x(\d{1,3})/i);
    if (xMatch) {
        const afterCode = base.slice(xMatch.index! + xMatch[0].length).replace(/^[\s\-_.]+/, "");
        return {
            seasonNumber: parseInt(xMatch[1], 10),
            episodeNumber: parseInt(xMatch[2], 10),
            episodeName: normaliseEpisodeName(afterCode),
        };
    }

    return null;
}

async function fetchTmdbInfo(titleName: string, type: "movie" | "series", explicitTmdbId?: number | null) {
    const apiKey = process.env.TMDB_API_KEY;
    if (!apiKey) return null;
    try {
        const { cleanName, year } = parseFolderName(titleName);
        const searchType = type === "movie" ? "movie" : "tv";
        const nameField = type === "movie" ? "title" : "name";
        const dateField = type === "movie" ? "release_date" : "first_air_date";
        const yearParam = type === "movie" ? "primary_release_year" : "first_air_date_year";

        let result: any = null;

        // ── Direct ID Lookup (Manual Override) ──────────────────────────────────
        if (explicitTmdbId) {
            const url = `https://api.themoviedb.org/3/${searchType}/${explicitTmdbId}?api_key=${apiKey}`;
            const res = await fetchWithRetry(url);
            if (res.ok) {
                result = await res.json();
            }
        }

        // ── Search by Name & Year (Automated matching) ──────────────────────────
        if (!result) {
            const url = new URL(`https://api.themoviedb.org/3/search/${searchType}`);
            url.searchParams.set("api_key", apiKey);
            url.searchParams.set("query", cleanName);
            if (year) url.searchParams.set(yearParam, String(year));

            const res = await fetchWithRetry(url.toString());
            if (res.ok) {
                const data = await res.json();
                let results: any[] = data.results ?? [];

                if (results.length === 0 && year) {
                    const fallbackUrl = new URL(`https://api.themoviedb.org/3/search/${searchType}`);
                    fallbackUrl.searchParams.set("api_key", apiKey);
                    fallbackUrl.searchParams.set("query", cleanName);
                    const fallback = await fetchWithRetry(fallbackUrl.toString());
                    if (fallback.ok) {
                        const fallbackData = await fallback.json();
                        results = fallbackData.results ?? [];
                    }
                }

                if (results.length > 0) {
                    const normalizedQuery = cleanName.trim().toLowerCase();
                    const exactTitle = results.filter(
                        (r: any) => (r[nameField] ?? "").trim().toLowerCase() === normalizedQuery
                    );
                    results = exactTitle.length ? exactTitle : results;

                    if (year) {
                        const withYear = results.filter((r: any) => (r[dateField] ?? "").startsWith(String(year)));
                        const withoutYear = results.filter((r: any) => !(r[dateField] ?? "").startsWith(String(year)));
                        results = withYear.length ? withYear : withoutYear;
                    }

                    result = results[0];
                }
            }
        }
        if (!result) return null;

        return {
            tmdbId: result.id as number,
            name: (result[nameField] as string) || undefined,
            overview: (result.overview as string) || null,
            posterUrl: result.poster_path
                ? `https://image.tmdb.org/t/p/w500${result.poster_path}`
                : null,
            backdropUrl: result.backdrop_path
                ? `https://image.tmdb.org/t/p/w1280${result.backdrop_path}`
                : null,
            rating: (result.vote_average as number) || null,
            year: result[dateField]
                ? parseInt((result[dateField] as string).slice(0, 4), 10)
                : null,
        };
    } catch (e) { }
    return null;
}

// API Episode Scrapers removed per user request. 
// We now strictly use the drive folder filename logic.

async function fetchOmdbInfo(titleName: string, type: "movie" | "series") {
    const apiKey = process.env.OMDB_API_KEY;
    if (!apiKey) return null;
    try {
        const { cleanName, year } = parseFolderName(titleName);
        const yearParam = year ? `&y=${year}` : "";
        const res = await fetchWithRetry(
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
                backdropUrl: data.Poster !== "N/A" ? data.Poster : null,
            };
        }
    } catch (e) { }
    return null;
}

async function fetchMetadataInfo(titleName: string, type: "movie" | "series", explicitTmdbId?: number | null) {
    const tmdb = await fetchTmdbInfo(titleName, type, explicitTmdbId);
    const omdb = await fetchOmdbInfo(titleName, type);
    return { ...(omdb || {}), ...(tmdb || {}) }; // TMDB takes priority
}

/**
 * DELETE /api/library/refresh
 *
 * ⚠️  NUCLEAR WIPE — deletes ALL watch progress, episodes, seasons and titles
 * from the database so the next POST refresh rebuilds everything cleanly
 * from Google Drive.
 *
 * Runs deletes SEQUENTIALLY in FK-safe order to avoid PostgreSQL cascade
 * conflicts that occur when parallel deletes race against each other.
 */
export async function DELETE() {
    const { userId } = auth();
    if (!userId)
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    try {
        // SEQUENTIAL — do NOT use Promise.all; parallel deletes with ON DELETE CASCADE
        // cause FK constraint races in PostgreSQL.
        const wpCount = await db.watchProgress.deleteMany({});
        const epCount = await db.episode.deleteMany({});
        const seCount = await db.season.deleteMany({});
        const tiCount = await db.title.deleteMany({});

        console.log(
            `[library/refresh DELETE] Wiped DB: ${tiCount.count} titles, ` +
            `${seCount.count} seasons, ${epCount.count} episodes, ${wpCount.count} progress records`
        );
        return NextResponse.json({
            ok: true,
            titlesDeleted: tiCount.count,
            seasonsDeleted: seCount.count,
            episodesDeleted: epCount.count,
            progressDeleted: wpCount.count,
        });
    } catch (err: unknown) {
        const message = err instanceof Error ? err.message : "Wipe error";
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
 * Walks the Drive root folder, syncs the folder tree into Postgres.
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
            // Deduplicate by file ID — shared-drive folders can return the same
            // file twice when includeItemsFromAllDrives is enabled.
            const files = res.data.files ?? [];
            const seen = new Set<string>();
            return files.filter(f => {
                if (!f.id || seen.has(f.id)) return false;
                seen.add(f.id);
                return true;
            });
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

        // ── Pre-load existing titles to skip metadata calls for known entries ────
        const existingTitles = await db.title.findMany({
            select: { id: true, driveFolderId: true, posterUrl: true, tmdbId: true, name: true },
        });
        const existingMap = new Map(existingTitles.map(t => [t.driveFolderId, t]));

        // ── Pre-load existing episodes to skip thumbnail refetching ──────────────
        const existingEpisodes = await db.episode.findMany({
            select: { driveFileId: true, thumbnailUrl: true, transcodeStatus: true },
        });
        const existingEpMap = new Map(existingEpisodes.map(e => [e.driveFileId, e]));

        const categoryFolders = await listFolder(rootFolderId);
        let processed = 0;
        const seenDriveFolderIds = new Set<string>();
        const seenDriveFileIds = new Set<string>(); // Used to purge obsolete episodes
        const CONCURRENCY = 6;

        for (const categoryFolder of categoryFolders) {
            if (!isFolder(categoryFolder)) continue;
            if (!categoryFolder.id || !categoryFolder.name) continue;

            const lowerName = categoryFolder.name.toLowerCase();
            const titleType: "movie" | "series" =
                lowerName === "movie" || lowerName === "movies" ? "movie" : "series";

            const titleFolders = await listFolder(categoryFolder.id);

            // Build one task per title folder, then run them in parallel batches.
            // Each task wraps itself in try/catch so one failing title never
            // kills the whole refresh (no Promise.all cascade rejection).
            const tasks = titleFolders
                .filter(tf => isFolder(tf) && tf.id && tf.name)
                // Skip any folder already seen under another category
                .filter(tf => !seenDriveFolderIds.has(tf.id!))
                .map(titleFolder => async (): Promise<number> => {
                    const folderId = titleFolder.id!;
                    const folderName = titleFolder.name!;
                    seenDriveFolderIds.add(folderId);

                    try {
                        const existing = existingMap.get(folderId);

                        // Only call TMDb/OMDb if this title has no poster yet
                        const needsMeta = !existing?.posterUrl;
                        // Use existing tmdbId if present (for manual overrides).
                        // If it's a manual override, posterUrl would be null but tmdbId would exist.
                        const explicitTmdbId = existing?.tmdbId;

                        const metadataInfo = needsMeta
                            ? await fetchMetadataInfo(folderName, titleType, explicitTmdbId)
                            : null;

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
                            // ── Movie ─────────────────────────────────────────────────
                            const videoFiles = titleChildren
                                .filter(isVideo)
                                .sort((a, b) => episodeSort(a.name ?? "", b.name ?? ""));

                            for (let i = 0; i < videoFiles.length; i++) {
                                const f = videoFiles[i];
                                if (!f.id || !f.name) continue;
                                seenDriveFileIds.add(f.id);

                                const isMkv = (f.mimeType?.includes("matroska") || f.mimeType?.includes("mkv") || f.name?.toLowerCase().endsWith(".mkv")) ?? false;
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
                            // ── Series ────────────────────────────────────────────────
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
                                    seenDriveFileIds.add(ef.id);

                                    // ── Determine episode number ───────────────────────────
                                    // parseEpisodeFilename now finds S##E## ANYWHERE in the
                                    // filename (e.g. "Ben 10 Alien Force - S01E01.MP4"), so
                                    // the correct episode number is always extracted.
                                    // Falls back to alphabetical sort index when no code found.
                                    const parsedEp = parseEpisodeFilename(ef.name);
                                    const resolvedOrder = parsedEp?.episodeNumber ?? (ei + 1);

                                    // ── Fetch episode metadata ─────────────────────────────
                                    // TMDB/OMDB lookup intentionally skipped for episodes per user configuration!
                                    // "tmdb is only use for poster URL and Backdrop URL then the no.of season and episodes should follow the format from Gdrive only"

                                    // Name priority:
                                    // 1. Embedded filename title  (from parseEpisodeFilename)
                                    // 2. "Episode N" fallback
                                    const embeddedName = parsedEp?.episodeName ?? "";
                                    let resolvedName = embeddedName.length > 0
                                        ? embeddedName
                                        : `Episode ${resolvedOrder}`;

                                    const isMkv = (ef.mimeType?.includes("matroska") || ef.mimeType?.includes("mkv") || ef.name?.toLowerCase().endsWith(".mkv")) ?? false;
                                    const existingEp = existingEpMap.get(ef.id) as any;
                                    const shouldSetPending = isMkv && !existingEp?.transcodeStatus;

                                    let epThumb = existingEp?.thumbnailUrl ?? null;
                                    let epOverview = existingEp?.overview ?? null;

                                    if (title.tmdbEpisodeSync && title.tmdbId && !epThumb) {
                                        try {
                                            const tz = `https://api.themoviedb.org/3/tv/${title.tmdbId}/season/${seasonNumber}/episode/${resolvedOrder}?api_key=${process.env.TMDB_API_KEY}`;
                                            const epRes = await fetchWithRetry(tz);
                                            if (epRes.ok) {
                                                const epData = await epRes.json();
                                                // Only override episode name if TMDB actually provides one that isn't just "Episode X"
                                                if (epData.name && !/^episode\s*0?\d+$/i.test(epData.name.trim())) {
                                                    resolvedName = epData.name;
                                                }
                                                if (epData.overview) epOverview = epData.overview;
                                                if (epData.still_path) {
                                                    epThumb = `https://image.tmdb.org/t/p/w500${epData.still_path}`;
                                                }
                                            }
                                        } catch (e) {
                                            console.error(`TMDB Episode Fetch Error for ${resolvedName}:`, e);
                                        }
                                    }

                                    await db.episode.upsert({
                                        where: { driveFileId: ef.id },
                                        update: {
                                            name: resolvedName,
                                            order: resolvedOrder,
                                            seasonId: season.id,
                                            titleId: title.id,
                                            thumbnailUrl: epThumb,
                                            overview: epOverview,
                                            ...(shouldSetPending && { mkvFileId: ef.id, transcodeStatus: "pending" }),
                                        },
                                        create: {
                                            driveFileId: ef.id,
                                            name: resolvedName,
                                            order: resolvedOrder,
                                            seasonId: season.id,
                                            titleId: title.id,
                                            thumbnailUrl: epThumb,
                                            overview: epOverview,
                                            ...(isMkv && { mkvFileId: ef.id, transcodeStatus: "pending" }),
                                        },
                                    });
                                    localProcessed++;
                                }
                            }
                        }

                        return localProcessed;
                    } catch (taskErr: unknown) {
                        const msg = taskErr instanceof Error ? taskErr.message : String(taskErr);
                        console.error(`[library / refresh] Error processing "${folderName}": ${msg} `);
                        return 0; // Don't let one bad title abort the whole refresh
                    }
                });

            const counts = await withConcurrency(tasks, CONCURRENCY);
            processed += counts.reduce((a, b) => a + b, 0);
        }

        // ── Prune stale titles (folders deleted from Drive) ──────────────────────
        const stale = await db.title.findMany({
            where: { driveFolderId: { notIn: Array.from(seenDriveFolderIds) } },
            select: { id: true, name: true },
        });
        if (stale.length > 0) {
            const staleIds = stale.map(t => t.id);
            console.log(`[library / refresh] Pruning ${stale.length} stale title(s): `, stale.map(t => t.name));
            await db.watchProgress.deleteMany({ where: { episode: { titleId: { in: staleIds } } } });
            await db.episode.deleteMany({ where: { titleId: { in: staleIds } } });
            await db.season.deleteMany({ where: { titleId: { in: staleIds } } });
            await db.title.deleteMany({ where: { id: { in: staleIds } } });
        }

        // ── Prune stale episodes (files replaced or deleted from Drive) ─────────
        const staleEpisodes = await db.episode.deleteMany({
            where: { driveFileId: { notIn: Array.from(seenDriveFileIds) } }
        });
        if (staleEpisodes.count > 0) {
            console.log(`[library / refresh] Pruned ${staleEpisodes.count} stale episode(s).`);
        }

        return NextResponse.json({ ok: true, processed, prunedTitles: stale.length, prunedEpisodes: staleEpisodes.count });
    } catch (err: unknown) {
        const message = err instanceof Error ? err.message : "Refresh error";
        console.error("[library/refresh]", message);
        return NextResponse.json({ error: message }, { status: 500 });
    }
}
