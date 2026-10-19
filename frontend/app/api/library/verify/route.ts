import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { fetchLibraryJson, type LibraryEntry, type LibraryJson } from "@/lib/driveToken";
import { checkDriveFileExists, writeLibraryJson } from "@/lib/driveWrite";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

/**
 * Extract the first Google Drive file ID embedded in a DASH manifest string.
 * The manifest contains BaseURLs of the form:
 *   https://www.googleapis.com/drive/v3/files/{FILE_ID}?alt=media&supportsAllDrives=true
 */
function mpdFileId(mpd: string): string | null {
    const m = mpd.match(/\/files\/([A-Za-z0-9_-]+)\?/);
    return m?.[1] ?? null;
}

/** "SERIES/Ben 10 - 2005/S01E05" → "SERIES/Ben 10 - 2005"; movies are already title-level keys. */
const titleKeyOf = (key: string, e: LibraryEntry) =>
    e.type === "series" ? key.split("/").slice(0, 2).join("/") : key;

/** Run `tasks` with at most `limit` in flight; results preserve input order. */
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

/**
 * POST /api/library/verify
 *
 * For every entry in library.json:
 *   1. Extracts the first Drive file ID from its DASH manifest (mpd field).
 *   2. Calls Drive files.get — if 404 or trashed, the STREAM file is gone.
 *
 * All missing entries are removed from library.json, which is then written back
 * to Drive. The corresponding Episode and Title rows are pruned from Postgres and
 * SyncState is updated to reflect the new entry count.
 *
 * Entries whose mpd contains no recognisable Drive file ID are left untouched
 * (safe default — we can't verify what we can't parse).
 */
export async function POST(req: Request) {
    const { userId } = auth();
    if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    try {
        const library = await fetchLibraryJson();
        const entries = Object.entries(library.entries);

        // ── 1. Check every entry against Drive ───────────────────────────────
        type CheckResult = { key: string; entry: LibraryEntry; exists: boolean };

        const tasks = entries.map(([key, entry]) => async (): Promise<CheckResult> => {
            const fileId = mpdFileId(entry.mpd ?? "");
            if (!fileId) {
                // Can't determine — leave it in the library (safe)
                return { key, entry, exists: true };
            }
            const exists = await checkDriveFileExists(fileId);
            return { key, entry, exists };
        });

        // 8 concurrent Drive API calls — stays well within quota limits
        const results = await withConcurrency(tasks, 8);

        const missing = results.filter((r) => !r.exists);

        if (missing.length === 0) {
            return NextResponse.json({
                scanned: entries.length,
                removed: [],
                libraryUpdated: false,
                syncResult: null,
            });
        }

        // ── 2. Build updated library.json (entries minus the missing ones) ────
        const missingKeys = new Set(missing.map((r) => r.key));

        const removedSummary = missing.map((r) => ({ key: r.key, title: r.entry.title }));

        const newEntries: Record<string, LibraryEntry> = {};
        for (const [key, entry] of entries) {
            if (!missingKeys.has(key)) newEntries[key] = entry;
        }

        const updatedLibrary: LibraryJson = {
            ...library,
            updatedAt: new Date().toISOString(),
            entries: newEntries,
        };

        // ── 3. Write the cleaned library.json back to Drive ──────────────────
        await writeLibraryJson(updatedLibrary);

        // ── 4. Prune Postgres ────────────────────────────────────────────────
        // Episodes: delete any row whose libraryKey is in the removed set.
        const prunedEpisodes = await db.episode.deleteMany({
            where: { libraryKey: { in: Array.from(missingKeys) } },
        });

        // Titles: delete any title whose libraryKey is in the removed set AND
        // that now has no remaining episodes (partial series deletions are safe).
        const missingTitleKeys = Array.from(
            new Set(missing.map((r) => titleKeyOf(r.key, r.entry)))
        );
        const prunedTitles = await db.title.deleteMany({
            where: {
                libraryKey: { in: missingTitleKeys },
                episodes: { none: {} },
            },
        });

        // ── 5. Update SyncState ──────────────────────────────────────────────
        const newEntryCount = Object.keys(newEntries).length;
        await db.syncState.upsert({
            where: { id: 1 },
            update: {
                syncedAt: new Date(),
                libraryUpdatedAt: updatedLibrary.updatedAt ?? null,
                entries: newEntryCount,
            },
            create: {
                id: 1,
                libraryUpdatedAt: updatedLibrary.updatedAt ?? null,
                entries: newEntryCount,
            },
        });

        return NextResponse.json({
            scanned: entries.length,
            removed: removedSummary,
            libraryUpdated: true,
            syncResult: {
                prunedEpisodes: prunedEpisodes.count,
                prunedTitles: prunedTitles.count,
            },
        });
    } catch (err: unknown) {
        const message = err instanceof Error ? err.message : "Verify error";
        console.error("[library/verify]", message);
        return NextResponse.json({ error: message }, { status: 500 });
    }
}
