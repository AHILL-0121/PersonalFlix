/**
 * The convert notebook calls POST /api/library/refresh when it finishes, so new titles show up without pressing
 * Sync. It has no Clerk session; it sends `Authorization: Bearer <SYNC_SECRET>` instead. Edge-safe (middleware).
 */
export function isSyncCall(req: Request): boolean {
    const secret = process.env.SYNC_SECRET;
    if (!secret || secret.length < 16) return false;
    if (new URL(req.url).pathname !== "/api/library/refresh" || req.method !== "POST") return false;
    const given = req.headers.get("authorization") ?? "";
    const want = `Bearer ${secret}`;
    if (given.length !== want.length) return false;
    let diff = 0;
    for (let i = 0; i < want.length; i++) diff |= given.charCodeAt(i) ^ want.charCodeAt(i);
    return diff === 0;
}
