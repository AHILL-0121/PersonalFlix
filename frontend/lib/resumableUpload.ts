/**
 * Browser-side Drive resumable upload: the file goes from this device straight to Google in chunks, so a
 * multi-GB film never touches Vercel. A dropped connection only costs the current chunk, and an upload URL is
 * remembered (localStorage, ~1 week like Drive keeps it) so re-adding the same file after a reload continues it.
 *
 * XHR rather than fetch: it reports upload progress, and it hands back Drive's "308 Resume Incomplete" as-is.
 */

const CHUNK = 16 * 1024 * 1024; // must be a multiple of 256 KiB
const STORE = "pf-upload-sessions";
const KEEP_MS = 6 * 24 * 3600 * 1000;

export class UploadGone extends Error {}
export class UploadAborted extends Error {}

interface Reply {
    status: number;
    range: string | null;
    body: string;
}

function put(url: string, body: Blob | null, range: string, onProgress?: (sent: number) => void, signal?: AbortSignal): Promise<Reply> {
    return new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open("PUT", url);
        xhr.setRequestHeader("Content-Range", range);
        if (onProgress) xhr.upload.onprogress = (e) => onProgress(e.loaded);
        xhr.onload = () => resolve({ status: xhr.status, range: xhr.getResponseHeader("Range"), body: xhr.responseText });
        xhr.onerror = () => reject(new Error("Network error"));
        xhr.ontimeout = () => reject(new Error("Timed out"));
        xhr.onabort = () => reject(new UploadAborted("Canceled"));
        signal?.addEventListener("abort", () => xhr.abort(), { once: true });
        xhr.send(body);
    });
}

const nextOffset = (range: string | null) => (range ? parseInt(range.split("-")[1], 10) + 1 : 0);

/** Ask Drive how much of the file it already has. */
async function query(url: string, size: number, signal?: AbortSignal): Promise<{ done: boolean; offset: number; body: string }> {
    const r = await put(url, null, `bytes */${size}`, undefined, signal);
    if (r.status === 200 || r.status === 201) return { done: true, offset: size, body: r.body };
    if (r.status === 308) return { done: false, offset: nextOffset(r.range), body: "" };
    if (r.status === 404 || r.status === 410) throw new UploadGone("Upload link expired");
    throw new Error(`Drive said HTTP ${r.status}`);
}

const wait = (ms: number, signal?: AbortSignal) =>
    new Promise<void>((resolve, reject) => {
        const t = setTimeout(resolve, ms);
        signal?.addEventListener("abort", () => { clearTimeout(t); reject(new UploadAborted("Canceled")); }, { once: true });
    });

/**
 * Upload `file` to a Drive resumable session URL. Resolves with Drive's file resource ({ id, name, … }).
 * Throws UploadGone when the session has expired (start a new one), UploadAborted on cancel.
 */
export async function uploadResumable(
    url: string,
    file: File,
    onProgress: (bytes: number) => void,
    signal?: AbortSignal,
    resume = false
): Promise<{ id: string; name: string }> {
    const size = file.size;
    let offset = 0;
    if (resume) {
        const q = await query(url, size, signal);
        if (q.done) return JSON.parse(q.body);
        offset = q.offset;
    }
    let failures = 0;
    while (true) {
        const end = Math.min(offset + CHUNK, size);
        onProgress(offset);
        try {
            const r = await put(url, file.slice(offset, end), `bytes ${offset}-${end - 1}/${size}`, (sent) => onProgress(offset + sent), signal);
            if (r.status === 200 || r.status === 201) {
                onProgress(size);
                return JSON.parse(r.body);
            }
            if (r.status === 308) {
                offset = nextOffset(r.range);
                failures = 0;
                continue;
            }
            if (r.status === 404 || r.status === 410) throw new UploadGone("Upload link expired");
            if (r.status < 500 && r.status !== 429 && r.status !== 408) throw new Error(`Drive said HTTP ${r.status}: ${r.body.slice(0, 160)}`);
            throw new Error(`HTTP ${r.status}`); // retried below
        } catch (e) {
            if (e instanceof UploadAborted || e instanceof UploadGone || (e instanceof Error && e.message.startsWith("Drive said"))) throw e;
            if (++failures > 8) throw e;
            await wait(Math.min(60000, 1000 * 2 ** failures), signal); // phones drop signal; keep trying for ~5 min
            if (!navigator.onLine) await new Promise<void>((r) => window.addEventListener("online", () => r(), { once: true }));
            const q = await query(url, size, signal).catch((err) => {
                if (err instanceof UploadGone || err instanceof UploadAborted) throw err;
                return null; // still offline: retry the same chunk
            });
            if (q?.done) return JSON.parse(q.body);
            if (q) offset = q.offset;
        }
    }
}

// ── remembered sessions ────────────────────────────────────────────────────────

type Saved = Record<string, { url: string; path: string; t: number }>;

function load(): Saved {
    try {
        const all = JSON.parse(localStorage.getItem(STORE) ?? "{}") as Saved;
        const now = Date.now();
        return Object.fromEntries(Object.entries(all).filter(([, v]) => now - v.t < KEEP_MS));
    } catch {
        return {};
    }
}

function save(s: Saved) {
    try {
        localStorage.setItem(STORE, JSON.stringify(s));
    } catch {
        /* private mode: resuming after a reload just won't work */
    }
}

/** Same file, same destination → same upload. */
export const fingerprint = (file: File, dest: string) => `${file.name}|${file.size}|${file.lastModified}|${dest}`;

export const savedSession = (fp: string) => load()[fp] ?? null;
export function rememberSession(fp: string, url: string, path: string) {
    save({ ...load(), [fp]: { url, path, t: Date.now() } });
}
export function forgetSession(fp: string) {
    const s = load();
    delete s[fp];
    save(s);
}
