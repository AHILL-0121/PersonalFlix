"use client";

/**
 * Shaka Player, just the parts we use. Shaka streams the DASH manifest from library.json straight from
 * Drive: every request gets the org account's read token in an Authorization header (Drive rejects
 * tokens in the URL). Video bytes never touch Vercel.
 */

export interface AudioTrack {
    id: number;
    active: boolean;
    language: string;
    label: string | null;
    audioCodec: string | null;
    channelsCount: number | null;
}

interface ShakaRequest { uris: string[]; headers: Record<string, string> }

export interface ShakaPlayer {
    attach(video: HTMLMediaElement): Promise<void>;
    configure(config: object): boolean;
    load(uri: string, startTime?: number | null, mimeType?: string): Promise<void>;
    destroy(): Promise<void>;
    getNetworkingEngine(): { registerRequestFilter(f: (type: number, req: ShakaRequest) => void | Promise<void>): void };
    addEventListener(type: string, listener: (e: any) => void): void;
    getVariantTracks(): AudioTrack[];
    selectVariantTrack(track: AudioTrack, clearBuffer?: boolean, safeMargin?: number): void;
    retryStreaming(): boolean;
}

const DRIVE = "https://www.googleapis.com/";
let token: { token: string; expiresAt: number } | null = null;
let pending: Promise<string> | null = null;

/** The current Drive token, fetched from /api/token when missing, near expiry or forced. */
export function driveToken(force = false): Promise<string> {
    if (!force && token && token.expiresAt - Date.now() > 5 * 60 * 1000) return Promise.resolve(token.token);
    if (pending) return pending;
    pending = (async () => {
        try {
            const res = await fetch(`/api/token${force ? "?force=1" : ""}`, { cache: "no-store" });
            const d = await res.json().catch(() => ({}));
            if (!res.ok || !d.token) throw new Error(d.error || `Token request failed (HTTP ${res.status})`);
            token = { token: d.token, expiresAt: d.expiresAt ?? Date.now() + 50 * 60 * 1000 };
            return token.token;
        } finally {
            pending = null;
        }
    })();
    return pending;
}

export async function createPlayer(video: HTMLVideoElement, preferredAudio: string | null): Promise<ShakaPlayer> {
    // DASH-only build (~530 KB), loaded only on the player page
    const mod: any = await import("shaka-player/dist/shaka-player.dash.js");
    const shaka = mod.default ?? mod;
    shaka.polyfill.installAll();
    if (!shaka.Player.isBrowserSupported()) throw new Error("This browser can't play DASH streams (no Media Source support).");

    const player: ShakaPlayer = new shaka.Player();
    await player.attach(video);
    player.configure({
        streaming: {
            bufferingGoal: 60,
            rebufferingGoal: 2,
            bufferBehind: 30,
            retryParameters: { maxAttempts: 5, baseDelay: 500, backoffFactor: 2, timeout: 30000 },
        },
        manifest: { retryParameters: { maxAttempts: 2 } },
        abr: { enabled: false }, // one rendition per title
        ...(preferredAudio ? { preferredAudioLanguage: preferredAudio } : {}),
    });
    // async filter: refreshes the token first when it's about to expire
    player.getNetworkingEngine().registerRequestFilter(async (_type, req) => {
        if (!req.uris[0]?.startsWith(DRIVE)) return;
        req.headers["Authorization"] = `Bearer ${await driveToken()}`;
    });
    return player;
}

/**
 * The manifest (stored in library.json) as a blob: URL. The DASH-only Shaka build has no data: URI plugin,
 * but its HTTP plugin serves blob: URLs. Revoke it once load() has finished.
 */
export const manifestUri = (mpd: string) => URL.createObjectURL(new Blob([mpd], { type: "application/dash+xml" }));

/** One entry per audio track (Shaka lists one variant per video+audio pair). */
export function audioChoices(player: ShakaPlayer): AudioTrack[] {
    const byKey = new Map<string, AudioTrack>();
    for (const t of player.getVariantTracks()) {
        const key = `${t.language}|${t.label ?? ""}|${t.audioCodec ?? ""}|${t.channelsCount ?? ""}`;
        if (!byKey.has(key) || t.active) byKey.set(key, t);
    }
    return Array.from(byKey.values());
}

/** Human message for a Shaka error. */
export function describeShakaError(err: any): string {
    const code = err?.code;
    const status = code === 1001 ? Number(err?.data?.[1]) : null;
    if (status === 401) return "Drive rejected the access token. Reload to get a new one.";
    if (status === 403) return "Drive refused the file (HTTP 403). It may have hit Drive's download limit for today — try again later.";
    if (status === 404) return "This file is no longer in Drive. Run the convert notebook again, then Sync library.";
    if (code === 1002) return "Couldn't reach Google Drive. Check your connection.";
    if (code === 4000 || code === 4001) return "The stream manifest for this title is damaged. Re-convert it in the notebook.";
    if (code >= 3000 && code < 4000) return "This browser couldn't decode the video.";
    return `Playback failed (Shaka error ${code ?? "unknown"}).`;
}
