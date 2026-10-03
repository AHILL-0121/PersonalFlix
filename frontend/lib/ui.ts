/** Shapes the server hands to the UI, plus pure helpers shared by home and player. */

export interface Ep {
    id: string;
    s: number; // season (0 for movies)
    e: number; // episode (1 for movies)
    name: string;
    overview: string | null;
    thumb: string | null;
    dur: number; // seconds, 0 if unknown
    pos: number; // saved position, seconds
    at: number; // when progress was saved (ms), 0 = never
}

export interface TitleLite {
    id: string;
    type: "movie" | "series";
    name: string;
    year: number | null;
    rating: number | null;
    overview: string | null;
    poster: string | null;
    backdrop: string | null;
    added: number; // ms
    height: number | null; // tallest converted video
    eps: Ep[]; // sorted by season, episode
    seasons: number[];
}

export interface UpNextItem {
    t: TitleLite;
    ep: Ep;
    pos: number;
    kicker: "Continue" | "Up next" | "New in your library";
}

export const NEW_DAYS = 14;

export const fmt = (sec: number) => {
    sec = Math.max(0, Math.floor(sec || 0));
    const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
    return h ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}` : `${m}:${String(s).padStart(2, "0")}`;
};

export const left = (pos: number, dur: number) => {
    const m = Math.max(0, Math.round((dur - pos) / 60));
    return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m left` : `${m}m left`;
};

export const code = (ep: Pick<Ep, "s" | "e">) => `S${ep.s}·E${ep.e}`;

export const runtime = (sec: number) => {
    const m = Math.round(sec / 60);
    return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}m`;
};

/** Finished = within the last 30 s (or past the end). */
export const isDone = (ep: Ep, pos = ep.pos) => ep.dur > 0 && pos >= ep.dur - 30;

export const isNew = (t: TitleLite, now = Date.now()) => now - t.added < NEW_DAYS * 86400e3;

export const epLabel = (t: TitleLite, ep: Ep) => (t.type === "series" ? `${code(ep)} · ${ep.name}` : t.name);

export function nextEp(t: TitleLite, ep: Ep): Ep | null {
    const i = t.eps.findIndex((x) => x.id === ep.id);
    return i >= 0 && i < t.eps.length - 1 ? t.eps[i + 1] : null;
}

export function prevEp(t: TitleLite, ep: Ep): Ep | null {
    const i = t.eps.findIndex((x) => x.id === ep.id);
    return i > 0 ? t.eps[i - 1] : null;
}

/** Latest progress per title, most recent first; a finished episode is replaced by the next one. */
export function computeUpNext(titles: TitleLite[]): UpNextItem[] {
    const out: (UpNextItem & { at: number })[] = [];
    for (const t of titles) {
        let latest: Ep | null = null;
        for (const ep of t.eps) if (ep.at && (!latest || ep.at > latest.at)) latest = ep;
        if (!latest) continue;
        if (isDone(latest)) {
            const nx = nextEp(t, latest);
            if (nx && !isDone(nx)) out.push({ t, ep: nx, pos: nx.pos > 3 ? nx.pos : 0, kicker: "Up next", at: latest.at });
        } else if (latest.pos > 3) {
            out.push({ t, ep: latest, pos: latest.pos, kicker: "Continue", at: latest.at });
        }
    }
    return out.sort((a, b) => b.at - a.at);
}

/** 0–1 for the poster bar: movie position, or share of episodes finished; null = never started. */
export function titleProgress(t: TitleLite): number | null {
    const started = t.eps.filter((e) => e.at);
    if (!started.length) return null;
    if (t.type === "movie") return t.eps[0].dur ? Math.min(1, t.eps[0].pos / t.eps[0].dur) : 0.04;
    return Math.max(0.04, t.eps.filter((e) => isDone(e)).length / t.eps.length);
}

/** Which episode a title's Play button starts. */
export function resumeTarget(t: TitleLite, upNext: UpNextItem[]): Ep {
    return upNext.find((u) => u.t.id === t.id)?.ep ?? t.eps.find((e) => !isDone(e)) ?? t.eps[0];
}

/** Deterministic colours per title for generated art, glow and the ambient re-grade. */
export function palette(key: string) {
    let h = 0;
    for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
    const hue = h % 360;
    return {
        a: `hsl(${hue} 45% 17%)`,
        b: `hsl(${(hue + 30) % 360} 50% 5%)`,
        c: `hsl(${(hue + 20) % 360} 85% 66%)`,
        glow: `hsl(${(hue + 20) % 360} 85% 60% / .35)`,
        // page background tint: kept dark and muted so it never fights the red accent
        amb: `hsl(${hue} 28% 11%)`,
        motif: ["m-sun", "m-rings", "m-stripes", "m-grid", "m-wave", "m-slash"][h % 6],
    };
}

export function regrade(key: string | null) {
    if (typeof document === "undefined") return;
    const root = document.documentElement.style;
    if (!key) {
        root.removeProperty("--amb-a");
        root.removeProperty("--amb-b");
        return;
    }
    const p = palette(key);
    root.setProperty("--amb-a", p.amb);
    root.setProperty("--amb-b", "#111111");
}

export const playHref = (epId: string, opts: { resume?: boolean; start?: boolean } = {}) =>
    `/player/${epId}${opts.resume ? "?resume=1" : opts.start ? "?start=0" : ""}`;
