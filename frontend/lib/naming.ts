/**
 * Library naming rules, shared by the upload page (to guess names from messy release files and preview
 * where each file goes) and /api/upload/session (which applies them for real). They match what the convert
 * notebook's describe() reads:
 *   MOVIE/Aladdin-2019/Aladdin-2019.mkv
 *   SERIES/Ben 10 - 2005/Season 01/Ben 10 - S01E05.mkv
 */

export type Kind = "movie" | "series";

export const VIDEO_EXTS = [".mkv", ".mp4", ".m4v", ".avi", ".mov", ".webm", ".ts", ".m2ts", ".wmv", ".flv", ".mpg", ".mpeg"];

const MIME: Record<string, string> = {
    ".mkv": "video/x-matroska", ".mp4": "video/mp4", ".m4v": "video/mp4", ".avi": "video/x-msvideo",
    ".mov": "video/quicktime", ".webm": "video/webm", ".ts": "video/mp2t", ".m2ts": "video/mp2t",
    ".wmv": "video/x-ms-wmv", ".flv": "video/x-flv", ".mpg": "video/mpeg", ".mpeg": "video/mpeg",
};

export const extOf = (name: string) => (name.match(/\.[a-z0-9]{1,5}$/i)?.[0] ?? "").toLowerCase();
export const stripExt = (name: string) => name.replace(/\.[a-z0-9]{1,5}$/i, "");
export const isVideoName = (name: string) => VIDEO_EXTS.includes(extOf(name));
/** Always video/*: the notebook treats any video/* file as a source, whatever its extension. */
export const mimeFor = (ext: string) => MIME[ext.toLowerCase()] ?? "video/mp4";

const MAX_YEAR = new Date().getFullYear() + 2;
const isYear = (y: number) => y >= 1900 && y <= MAX_YEAR;

/** Lower-case, no punctuation or articles' spacing differences — for matching folder names to titles. */
export const normTitle = (s: string) =>
    s.toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9À-￿]+/g, " ").trim();

/** Same rule as the sync route and the notebook: "Aadukalam-2011", "Ben 10 - 2005", "Movie (2011)". */
export function parseFolderName(raw: string): { title: string; year: number | null } {
    const m = raw.match(/^(.*?)\s*-\s*(\d{4})$/) ?? raw.match(/^(.+?)\s*\((\d{4})\)\s*$/);
    return m ? { title: m[1].trim(), year: parseInt(m[2], 10) } : { title: raw.trim(), year: null };
}

// Where a release name stops being the title: quality, source, codec, audio and language tags.
const CUT = new RegExp(
    "\\b(?:" +
        [
            "2160p", "1080p", "1080i", "720p", "576p", "480p", "360p", "4k", "uhd", "hdr(?:10)?", "sdr",
            "web[-. ]?dl", "web[-. ]?rip", "webrip", "bluray", "blu[-. ]?ray", "brrip", "bdrip", "dvdrip", "dvdscr",
            "hdrip", "hdtv", "hdcam", "camrip", "pre[-. ]?dvd", "predvd", "x264", "x265", "h[-. ]?26[45]", "hevc",
            "avc", "10[-. ]?bit", "8[-. ]?bit", "aac", "ac3", "e?ac-?3", "ddp?\\d", "dts", "atmos", "truehd",
            "dual[-. ]?audio", "multi[-. ]?audio", "esubs?", "msubs?", "proper", "repack", "extended", "unrated",
            "remastered", "imax", "amzn", "nf", "dsnp", "hmax", "zee5", "hq", "true[-. ]?web",
            "tamil", "telugu", "hindi", "malayalam", "kannada", "english", "eng", "tam", "tel", "hin", "mal", "kan",
            "complete", "season[-. ]?\\d{1,2}", "s\\d{1,2}(?:e\\d{1,3})?", "\\d{1,2}x\\d{2,3}",
        ].join("|") +
        ")\\b",
    "i"
);

/**
 * "www.Site.xyz - Leo (2023) Tamil HQ HDRip 1080p x264.mkv" → { title: "Leo", year: 2023 }
 * "The.Matrix.1999.1080p.BluRay.x264-GRP.mkv"               → { title: "The Matrix", year: 1999 }
 * "Blade.Runner.2049.2017.2160p.mkv"                        → { title: "Blade Runner 2049", year: 2017 }
 * "1917 (2019).mp4"                                          → { title: "1917", year: 2019 }
 */
export function parseRelease(raw: string): { title: string; year: number | null } {
    let s = stripExt(raw)
        .replace(/^\s*(?:\[[^\]]*\]|\([^)]*\)|www\.\S+|\S+\.(?:com|net|org|xyz|in|me|co|to|cc|lol|mx|pw|ws|link|tv))\s*[-–_:]*\s*/i, "")
        .replace(/\[[^\]]*\]/g, " ")
        .replace(/[._]+/g, " ")
        .replace(/\s+/g, " ")
        .trim();

    // a year in brackets is the surest sign; otherwise the last plausible year before the tags start
    let year: number | null = null;
    let cutAt = s.length;
    const tag = s.slice(1).search(CUT);
    if (tag >= 0) cutAt = tag + 1;
    const paren = Array.from(s.matchAll(/[([]((?:19|20)\d{2})[)\]]/g)).find((m) => (m.index ?? 0) > 0 && isYear(+m[1]));
    if (paren) {
        year = +paren[1];
        cutAt = Math.min(cutAt, paren.index!);
    } else {
        const years = Array.from(s.slice(0, cutAt).matchAll(/(?<!\d)((?:19|20)\d{2})(?!\d)/g)).filter((m) => (m.index ?? 0) > 0 && isYear(+m[1]));
        const last = years[years.length - 1];
        if (last) {
            year = +last[1];
            cutAt = last.index!;
        }
    }
    const title = s
        .slice(0, cutAt)
        .replace(/[\s\-–:(\[]+$/g, "")
        .replace(/^[\s\-–:]+/, "")
        .trim();
    // folder-style "Aadukalam-2011" is handled by the same rules; fall back to the raw name if nothing's left
    return { title: title || s.trim(), year };
}

/**
 * Season/episode from a file name. Same patterns as the notebook's parse_episode(), plus "Season 1 Episode 2".
 * `before` is the text ahead of the marker (usually the show's name).
 */
export function parseEpisode(raw: string): { season: number | null; episode: number | null; before: string } {
    const base = stripExt(raw);
    const rxs = [
        /[Ss](\d{1,2})\s*[Ee](\d{1,3})/,
        /[Ss](\d{1,2})-(\d{1,3})(?=\D|$)/,
        /(?<!\d)(\d{1,2})x(\d{2,3})(?!\d)/,
        /Season\s*(\d{1,2})\s*[-_. ]*\s*Episode\s*(\d{1,3})/i,
    ];
    for (const rx of rxs) {
        const m = base.match(rx);
        if (m) return { season: +m[1], episode: +m[2], before: base.slice(0, m.index) };
    }
    const m = base.match(/(?:\b[Ee]p?|Episode)\s*(\d{1,3})\b/) ?? base.match(/\s-\s(\d{2,3})(?:\s|$)/);
    return m ? { season: null, episode: +m[1], before: base.slice(0, m.index) } : { season: null, episode: null, before: "" };
}

/** "Season 2", "S02", "Season_02" → 2 */
export function seasonFromDir(dir: string): number | null {
    const m = dir.match(/\bseason[\s._-]*(\d{1,2})\b/i) ?? dir.match(/^\s*s(\d{1,2})\s*$/i) ?? dir.match(/\bs(\d{1,2})\b/i);
    return m ? +m[1] : null;
}

export const pad2 = (n: number) => String(n).padStart(2, "0");

/** File names: drop characters Windows and some Drive clients choke on. */
export const fileSafe = (s: string) => s.replace(/[\\/:*?"<>|]+/g, " ").replace(/\s+/g, " ").trim();
/** Folder names keep ":" (existing folders like "Ben 10: Alien Force - 2008" do). */
export const folderSafe = (s: string) => s.replace(/[\\/]+/g, " ").replace(/\s+/g, " ").trim();

export const movieFolderName = (title: string, year: number | null) => folderSafe(year ? `${title}-${year}` : title);
export const seriesFolderName = (title: string, year: number | null) => folderSafe(year ? `${title} - ${year}` : title);
export const seasonFolderName = (season: number) => `Season ${pad2(season)}`;
export const movieFileName = (title: string, year: number | null, ext: string) =>
    fileSafe(year ? `${title}-${year}` : title) + ext;
export const episodeFileName = (show: string, season: number, episode: number, ext: string) =>
    `${fileSafe(show)} - S${pad2(season)}E${pad2(episode)}${ext}`;

export interface UploadSpec {
    kind: Kind;
    title: string;
    year: number | null;
    season: number | null;
    episode: number | null;
    ext: string;
    size: number;
}

/** Where a file would land if no matching folder exists yet (the server may reuse an existing one). */
export function previewPath(s: UploadSpec): string {
    if (s.kind === "movie") return `MOVIE/${movieFolderName(s.title, s.year)}/${movieFileName(s.title, s.year, s.ext)}`;
    return `SERIES/${seriesFolderName(s.title, s.year)}/${seasonFolderName(s.season ?? 1)}/${episodeFileName(s.title, s.season ?? 1, s.episode ?? 0, s.ext)}`;
}

/** Returns an error message, or null when the spec is complete. */
export function specError(s: UploadSpec): string | null {
    if (!s.title.trim()) return "Title is missing";
    if (s.title.length > 150) return "Title is too long";
    if (s.year !== null && !(Number.isInteger(s.year) && isYear(s.year))) return "Year looks wrong";
    if (!VIDEO_EXTS.includes(s.ext)) return `${s.ext || "This file type"} isn't a supported video`;
    if (!(s.size > 0)) return "File is empty";
    if (s.kind === "series") {
        if (s.season === null || !Number.isInteger(s.season) || s.season < 0 || s.season > 99) return "Season number needed";
        if (s.episode === null || !Number.isInteger(s.episode) || s.episode < 0 || s.episode > 999) return "Episode number needed";
    }
    return null;
}
