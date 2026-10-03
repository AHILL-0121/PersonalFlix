/** Client-side helper for /api/progress. keepalive lets the save survive leaving the page. */
export async function saveProgress(episodeId: string, positionSec: number): Promise<void> {
    try {
        await fetch("/api/progress", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ episodeId, positionSec }),
            keepalive: true,
        });
    } catch {
        // best effort
    }
}
