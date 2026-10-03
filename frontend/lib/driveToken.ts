/**
 * Server-only: short-lived tokens for the org account, from the Apps Script web apps in apps-script/.
 * The passphrases never leave the server.
 *   - "PersonalFlix Read"  (drive.readonly) — handed to the signed-in browser by /api/token so Shaka can
 *     stream straight from Drive
 *   - "PersonalFlix Write" (drive) — used only here, by /api/upload/session, to create folders and open
 *     upload sessions; the browser only ever gets a single-file upload URL
 */

const TOKEN_TTL_MS = 55 * 60 * 1000; // Apps Script tokens last ~60 min
const REUSE_MS = 40 * 60 * 1000;

type TokenGetter = (force?: boolean) => Promise<{ token: string; expiresAt: number }>;

function tokenSource(urlVar: string, passVar: string): TokenGetter {
    let cached: { token: string; issuedAt: number } | null = null;
    return async (force = false) => {
        if (!force && cached && Date.now() - cached.issuedAt < REUSE_MS) {
            return { token: cached.token, expiresAt: cached.issuedAt + TOKEN_TTL_MS };
        }
        const url = process.env[urlVar];
        const pass = process.env[passVar];
        if (!url || !pass) throw new Error(`${urlVar} / ${passVar} are not configured`);

        const res = await fetch(url, { method: "POST", body: pass, cache: "no-store", redirect: "follow" });
        const data = (await res.json().catch(() => ({}))) as { token?: string; issuedAt?: number; error?: string };
        if (!data.token) throw new Error(`Apps Script token request failed (${urlVar}): ${data.error ?? `HTTP ${res.status}`}`);

        cached = { token: data.token, issuedAt: data.issuedAt ?? Date.now() };
        return { token: cached.token, expiresAt: cached.issuedAt + TOKEN_TTL_MS };
    };
}

export const getDriveToken = tokenSource("DRIVE_TOKEN_URL", "DRIVE_TOKEN_PASSPHRASE");
export const getDriveWriteToken = tokenSource("DRIVE_WRITE_URL", "DRIVE_WRITE_PASSPHRASE");

export const DRIVE_API = "https://www.googleapis.com/drive/v3";

export interface LibraryEntry {
    type: "movie" | "series";
    title: string;
    year: number | null;
    season?: number;
    episode?: number;
    epName?: string;
    pack?: number;
    srcId: string;
    srcPath: string;
    duration: number;
    height: number | null;
    audio: { lang: string; label: string }[];
    files: string[];
    mpd: string;
    convertedAt: string;
}

export interface LibraryJson {
    version: number;
    updatedAt?: string;
    entries: Record<string, LibraryEntry>;
}

/** Download STREAM/library.json (written by the convert notebook). */
export async function fetchLibraryJson(): Promise<LibraryJson> {
    const fileId = process.env.LIBRARY_FILE_ID;
    if (!fileId) throw new Error("LIBRARY_FILE_ID is not configured");
    const get = async (token: string) =>
        fetch(`${DRIVE_API}/files/${fileId}?alt=media&supportsAllDrives=true`, {
            headers: { Authorization: `Bearer ${token}` },
            cache: "no-store",
        });
    let res = await get((await getDriveToken()).token);
    if (res.status === 401) res = await get((await getDriveToken(true)).token);
    if (!res.ok) throw new Error(`library.json: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
    return (await res.json()) as LibraryJson;
}
