/**
 * Turns whatever was dropped or picked (loose files, a movie folder, a series folder with season folders)
 * into titles: one group per movie, one group per series with its episodes.
 */

import { isVideoName, normTitle, parseEpisode, parseRelease, seasonFromDir, type Kind } from "@/lib/naming";

export interface Picked {
    file: File;
    /** path inside what was dropped: "Show/Season 1/ep.mkv", or just "film.mkv" */
    rel: string;
}

export interface DraftGroup {
    key: string;
    kind: Kind;
    title: string;
    year: number | null;
    items: { file: File; rel: string; season: number | null; episode: number | null }[];
}

const isSample = (p: Picked) => /(^|[\W_])sample([\W_]|$)/i.test(p.rel) && p.file.size < 400e6;

/** A series folder's own name, unless it's only "Season 2" / "S02" (then the files' names say more). */
function folderTitle(dir: string) {
    const r = parseRelease(dir);
    return seasonFromDir(dir) !== null && !r.title.replace(/\b(season|s)\s*\d+\b/gi, "").trim() ? { title: "", year: r.year } : r;
}

export function groupFiles(picked: Picked[]): { groups: DraftGroup[]; skipped: number } {
    const videos = picked.filter((p) => isVideoName(p.file.name) && p.file.size > 0 && !isSample(p));
    const groups = new Map<string, DraftGroup>();
    const addEpisode = (title: string, year: number | null, p: Picked, season: number | null, episode: number | null) => {
        const key = `series:${normTitle(title)}`;
        const g = groups.get(key) ?? { key, kind: "series" as const, title, year, items: [] };
        g.year ??= year;
        g.items.push({ file: p.file, rel: p.rel, season, episode });
        groups.set(key, g);
    };
    const addMovie = (p: Picked, parentDir: string | null, alone: boolean) => {
        const fromFile = parseRelease(p.file.name);
        const fromDir = parentDir && alone ? parseRelease(parentDir) : null;
        const best = [fromDir, fromFile].find((r) => r?.year && r.title) ?? (fromDir?.title ? fromDir : fromFile);
        const key = `movie:${p.rel}|${p.file.size}`;
        groups.set(key, { key, kind: "movie", title: best.title, year: best.year, items: [{ file: p.file, rel: p.rel, season: null, episode: null }] });
    };

    // bucket by the top folder that was dropped; loose files each stand alone
    const buckets = new Map<string | null, Picked[]>();
    for (const p of videos) {
        const top = p.rel.includes("/") ? p.rel.split("/")[0] : null;
        buckets.set(top, [...(buckets.get(top) ?? []), p]);
    }

    for (const [top, files] of Array.from(buckets)) {
        const eps = files.map((p) => ({ p, ep: parseEpisode(p.file.name), dirs: p.rel.split("/").slice(0, -1) }));
        const perDir = new Map<string, number>();
        for (const { dirs } of eps) perDir.set(dirs.join("/"), (perDir.get(dirs.join("/")) ?? 0) + 1);

        if (top === null) {
            for (const { p, ep } of eps) {
                const show = parseRelease(ep.before);
                // "S01E02" (or "Show E05") marks an episode; a bare "- 03" in a loose file isn't enough
                if (ep.episode !== null && (ep.season !== null || /\b(?:Ep?|Episode)\s*\d/i.test(p.file.name)) && show.title) {
                    addEpisode(show.title, show.year, p, ep.season ?? 1, ep.episode);
                } else addMovie(p, null, false);
            }
            continue;
        }

        // a dropped folder is a series if any file in it looks like an episode; then every file in it is one
        if (!eps.some((e) => e.ep.episode !== null)) {
            for (const { p, dirs } of eps) addMovie(p, dirs[dirs.length - 1] ?? null, perDir.get(dirs.join("/")) === 1);
            continue;
        }
        const fromFolder = folderTitle(top);
        const prefixes = new Set(eps.map((e) => normTitle(parseRelease(e.ep.before).title)).filter(Boolean));
        for (const { p, ep, dirs } of eps) {
            const season = ep.season ?? [...dirs].reverse().map(seasonFromDir).find((s) => s !== null) ?? 1;
            const own = parseRelease(ep.before);
            // one show per folder unless the files clearly name different shows (a dropped "TV" folder)
            const title = prefixes.size > 1 && own.title ? own.title : fromFolder.title || own.title || top;
            addEpisode(title, fromFolder.year ?? own.year, p, season, ep.episode);
        }
    }

    for (const g of Array.from(groups.values())) {
        g.items.sort((a, b) => (a.season ?? 0) - (b.season ?? 0) || (a.episode ?? 1e4) - (b.episode ?? 1e4) || a.rel.localeCompare(b.rel));
    }
    return { groups: Array.from(groups.values()), skipped: picked.length - videos.length };
}

// ── collecting files ───────────────────────────────────────────────────────────

/** From <input type="file"> (with or without webkitdirectory). */
export const fromInput = (list: FileList): Picked[] =>
    Array.from(list).map((file) => ({ file, rel: (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name }));

/** From a drop: walks dropped folders (FileSystemEntry API, supported by Firefox, Edge and Chrome). */
export async function fromDrop(dt: DataTransfer): Promise<Picked[]> {
    const entries = Array.from(dt.items)
        .map((i) => (i.kind === "file" ? (i.webkitGetAsEntry?.() ?? null) : null))
        .filter((e): e is FileSystemEntry => !!e);
    if (!entries.length) return Array.from(dt.files).map((file) => ({ file, rel: file.name }));

    const out: Picked[] = [];
    const walk = async (entry: FileSystemEntry, path: string): Promise<void> => {
        if (entry.isFile) {
            const file = await new Promise<File>((res, rej) => (entry as FileSystemFileEntry).file(res, rej));
            out.push({ file, rel: path + entry.name });
            return;
        }
        const reader = (entry as FileSystemDirectoryEntry).createReader();
        const children: FileSystemEntry[] = [];
        // readEntries returns at most ~100 at a time; keep reading until it returns none
        for (;;) {
            const batch = await new Promise<FileSystemEntry[]>((res, rej) => reader.readEntries(res, rej));
            if (!batch.length) break;
            children.push(...batch);
        }
        for (const c of children) await walk(c, `${path}${entry.name}/`);
    };
    for (const e of entries) await walk(e, "");
    return out;
}
