/**
 * Server-only Drive helpers for the upload page. Everything here is metadata (folders, file lists, opening
 * an upload session) — the video bytes go from the browser straight to Drive, never through Vercel.
 */

import { DRIVE_API, getDriveToken, getDriveWriteToken } from "@/lib/driveToken";
import {
    episodeFileName, extOf, isVideoName, mimeFor, movieFileName, movieFolderName, normTitle, parseEpisode,
    parseFolderName, seasonFolderName, seasonFromDir, seriesFolderName, type UploadSpec,
} from "@/lib/naming";

const UPLOAD_API = "https://www.googleapis.com/upload/drive/v3";
const FOLDER = "application/vnd.google-apps.folder";
const ALL_DRIVES = { supportsAllDrives: "true", includeItemsFromAllDrives: "true" };

/** Files this page uploaded carry this property, so the status list can find them with one search. */
export const UPLOAD_PROP = "pfUpload";

export interface DriveFile {
    id: string;
    name: string;
    mimeType: string;
    size?: string;
    createdTime?: string;
    parents?: string[];
    properties?: Record<string, string>;
}

type Getter = typeof getDriveToken;

async function driveFetch(getToken: Getter, url: string, init: RequestInit = {}): Promise<Response> {
    for (let attempt = 0; ; attempt++) {
        const { token } = await getToken(attempt > 0);
        const res = await fetch(url, {
            ...init,
            cache: "no-store",
            headers: { ...(init.headers as Record<string, string>), Authorization: `Bearer ${token}` },
        });
        if (res.status === 401 && attempt === 0) continue; // stale cached token
        if ((res.status === 429 || res.status >= 500) && attempt < 3) {
            await new Promise((r) => setTimeout(r, 500 * 2 ** attempt));
            continue;
        }
        return res;
    }
}

async function json<T>(res: Response, what: string): Promise<T> {
    if (!res.ok) throw new Error(`${what}: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
    return (await res.json()) as T;
}

const q = (s: string) => s.replace(/\\/g, "\\\\").replace(/'/g, "\\'");

export async function listChildren(parent: string, extra = ""): Promise<DriveFile[]> {
    const out: DriveFile[] = [];
    let page: string | undefined;
    do {
        const url = new URL(`${DRIVE_API}/files`);
        url.search = new URLSearchParams({
            ...ALL_DRIVES,
            q: `'${q(parent)}' in parents and trashed = false${extra ? ` and ${extra}` : ""}`,
            fields: "nextPageToken, files(id, name, mimeType, size)",
            pageSize: "1000",
            ...(page ? { pageToken: page } : {}),
        }).toString();
        const d = await json<{ files: DriveFile[]; nextPageToken?: string }>(await driveFetch(getDriveWriteToken, url.toString()), "List folder");
        out.push(...d.files);
        page = d.nextPageToken;
    } while (page);
    return out;
}

async function createFolder(parent: string, name: string): Promise<DriveFile> {
    const res = await driveFetch(getDriveWriteToken, `${DRIVE_API}/files?supportsAllDrives=true&fields=id,name,mimeType`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, mimeType: FOLDER, parents: [parent] }),
    });
    return json<DriveFile>(res, `Create folder ${name}`);
}

async function parentOf(id: string): Promise<string> {
    const res = await driveFetch(getDriveWriteToken, `${DRIVE_API}/files/${id}?supportsAllDrives=true&fields=parents`);
    const d = await json<{ parents?: string[] }>(res, "Find parent folder");
    if (!d.parents?.[0]) throw new Error("Can't see the parent folder — set MEDIA_ROOT_FOLDER_ID");
    return d.parents[0];
}

let rootCache: string | null = null;

/** The folder holding MOVIE/, SERIES/ and STREAM/: MEDIA_ROOT_FOLDER_ID, or library.json's grandparent. */
async function mediaRoot(): Promise<string> {
    if (process.env.MEDIA_ROOT_FOLDER_ID) return process.env.MEDIA_ROOT_FOLDER_ID;
    if (rootCache) return rootCache;
    const lib = process.env.LIBRARY_FILE_ID;
    if (!lib) throw new Error("Set MEDIA_ROOT_FOLDER_ID (or LIBRARY_FILE_ID) so uploads know where the library is");
    rootCache = await parentOf(await parentOf(lib));
    return rootCache;
}

/** MOVIE/ or SERIES/ under the root (any folder whose name starts with it, like the notebook), created if missing. */
async function topFolder(kind: UploadSpec["kind"]): Promise<string> {
    const root = await mediaRoot();
    const prefix = kind === "movie" ? "MOVIE" : "SERIES";
    const found = (await listChildren(root, `mimeType = '${FOLDER}'`)).find((f) => f.name.toUpperCase().startsWith(prefix));
    return (found ?? (await createFolder(root, prefix))).id;
}

/**
 * An existing title folder with the same title (ignoring case and punctuation) and year, so a new season lands
 * next to the old ones even when the typed name differs slightly ("Supergirl" → "SuperGirl - 2015").
 * A folder without a year, or an upload without one, matches on the title alone.
 */
function matchTitleFolder(folders: DriveFile[], title: string, year: number | null): DriveFile | undefined {
    const want = normTitle(title);
    const same = folders.filter((f) => normTitle(parseFolderName(f.name).title) === want);
    return (
        same.find((f) => parseFolderName(f.name).year === year) ??
        (year === null && same.length === 1 ? same[0] : undefined) ??
        same.find((f) => parseFolderName(f.name).year === null)
    );
}

export interface Target {
    folderId: string;
    name: string;
    /** display path, e.g. "SERIES/Ben 10 - 2005/Season 01/Ben 10 - S01E05.mkv" */
    path: string;
    /** the notebook's library.json key for this file */
    key: string;
    /** video files already occupying this slot (same movie, or same episode number) */
    conflicts: DriveFile[];
}

/** Work out (and create, if needed) the folders for an upload, and what's already there. */
export async function resolveTarget(spec: UploadSpec): Promise<Target> {
    const top = await topFolder(spec.kind);
    const titles = await listChildren(top, `mimeType = '${FOLDER}'`);
    const nameFor = spec.kind === "movie" ? movieFolderName : seriesFolderName;
    const titleDir = matchTitleFolder(titles, spec.title, spec.year) ?? (await createFolder(top, nameFor(spec.title, spec.year)));

    if (spec.kind === "movie") {
        const videos = (await listChildren(titleDir.id)).filter((f) => f.mimeType !== FOLDER && isVideoName(f.name));
        const folder = parseFolderName(titleDir.name);
        const name = movieFileName(folder.title, folder.year ?? spec.year, spec.ext);
        return { folderId: titleDir.id, name, path: `MOVIE/${titleDir.name}/${name}`, key: `MOVIE/${titleDir.name}`, conflicts: videos };
    }

    const season = spec.season ?? 1;
    const episode = spec.episode ?? 0;
    const seasons = await listChildren(titleDir.id, `mimeType = '${FOLDER}'`);
    const seasonDir = seasons.find((f) => (seasonFromDir(f.name) ?? Number(f.name.match(/^\D*(\d+)\D*$/)?.[1] ?? NaN)) === season)
        ?? (await createFolder(titleDir.id, seasonFolderName(season)));
    const videos = (await listChildren(seasonDir.id)).filter((f) => f.mimeType !== FOLDER && isVideoName(f.name));
    const conflicts = videos.filter((f) => {
        const p = parseEpisode(f.name);
        return p.episode === episode && (p.season ?? season) === season;
    });
    // the file is named after the folder's title, so it reads the same as the episodes already there
    const show = parseFolderName(titleDir.name).title.replace(/:/g, "");
    const name = episodeFileName(show, season, episode, spec.ext);
    const code = `S${String(season).padStart(2, "0")}E${String(episode).padStart(2, "0")}`;
    return {
        folderId: seasonDir.id, name, path: `SERIES/${titleDir.name}/${seasonDir.name}/${name}`,
        key: `SERIES/${titleDir.name}/${code}`, conflicts,
    };
}

export async function trashFiles(files: DriveFile[]): Promise<void> {
    for (const f of files) {
        const res = await driveFetch(getDriveWriteToken, `${DRIVE_API}/files/${f.id}?supportsAllDrives=true`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ trashed: true }),
        });
        await json(res, `Move ${f.name} to the bin`);
    }
}

/**
 * Open a resumable upload session and return its URL. The browser PUTs the file there directly; the URL only
 * allows uploading this one file. Sending the page's Origin here is what lets the browser use the URL (CORS).
 */
export async function openUploadSession(target: Target, spec: UploadSpec, origin: string): Promise<string> {
    const url = `${UPLOAD_API}/files?uploadType=resumable&supportsAllDrives=true&fields=id,name,size,md5Checksum`;
    const res = await driveFetch(getDriveWriteToken, url, {
        method: "POST",
        headers: {
            "Content-Type": "application/json; charset=UTF-8",
            "X-Upload-Content-Type": mimeFor(extOf(target.name)),
            "X-Upload-Content-Length": String(spec.size),
            Origin: origin,
        },
        body: JSON.stringify({
            name: target.name,
            parents: [target.folderId],
            properties: { [UPLOAD_PROP]: "1", pfKey: target.key.slice(0, 100) },
        }),
    });
    const location = res.headers.get("location");
    if (!res.ok || !location) throw new Error(`Could not start the upload: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
    return location;
}

/** Newest files uploaded through the upload page (read token is enough; `properties` are visible to every app). */
export async function recentUploads(limit = 40): Promise<DriveFile[]> {
    const url = new URL(`${DRIVE_API}/files`);
    url.search = new URLSearchParams({
        ...ALL_DRIVES,
        corpora: "allDrives",
        q: `properties has { key='${UPLOAD_PROP}' and value='1' } and trashed = false`,
        fields: "files(id, name, mimeType, size, createdTime, properties)",
        orderBy: "createdTime desc",
        pageSize: String(limit),
    }).toString();
    const d = await json<{ files: DriveFile[] }>(await driveFetch(getDriveToken, url.toString()), "List uploads");
    return d.files;
}
