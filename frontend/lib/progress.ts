/**
 * Client-side helper for the /api/progress endpoint.
 * Used by the VideoPlayer component to read and write watch position.
 */

export async function fetchProgress(episodeId: string): Promise<number> {
    try {
        const res = await fetch(`/api/progress?episodeId=${episodeId}`);
        if (!res.ok) return 0;
        const data = (await res.json()) as { positionSec: number };
        return data.positionSec ?? 0;
    } catch {
        return 0;
    }
}

export async function saveProgress(
    episodeId: string,
    positionSec: number
): Promise<void> {
    try {
        await fetch("/api/progress", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ episodeId, positionSec }),
            // keepalive so the request survives page unload
            keepalive: true,
        });
    } catch {
        // Best-effort; silently ignore network errors
    }
}

/** Format seconds → HH:MM:SS or MM:SS */
export function formatTime(seconds: number): string {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    if (h > 0) {
        return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
    }
    return `${m}:${String(s).padStart(2, "0")}`;
}
