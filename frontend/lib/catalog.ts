import { db } from "@/lib/db";
import type { Ep, TitleLite } from "@/lib/ui";

const episodeSelect = {
    id: true,
    name: true,
    order: true,
    durationSec: true,
    thumbnailUrl: true,
    overview: true,
    height: true,
    season: { select: { number: true } },
    watchProgress: { select: { positionSec: true, updatedAt: true } },
} as const;

type EpRow = {
    id: string;
    name: string;
    order: number;
    durationSec: number | null;
    thumbnailUrl: string | null;
    overview: string | null;
    height: number | null;
    season: { number: number } | null;
    watchProgress: { positionSec: number; updatedAt: Date } | null;
};

type TitleRow = {
    id: string;
    type: "movie" | "series";
    name: string;
    year: number | null;
    rating: number | null;
    overview: string | null;
    posterUrl: string | null;
    backdropUrl: string | null;
    createdAt: Date;
    episodes: EpRow[];
};

/** Drops a folder-style year suffix: "Courage the Cowardly Dog - 1999" / "Monster-2019" / "Heat (1995)" → the bare title. */
export function displayName(name: string): string {
    return name.replace(/\s*(?:-\s*\d{4}|\(\d{4}\))\s*$/, "").trim() || name;
}

export function toTitleLite(t: TitleRow): TitleLite {
    const name = displayName(t.name);
    const eps: Ep[] = t.episodes
        .map((e) => ({
            id: e.id,
            s: t.type === "movie" ? 0 : e.season?.number ?? 1,
            e: t.type === "movie" ? 1 : e.order,
            name: t.type === "movie" ? name : e.name,
            overview: e.overview,
            thumb: e.thumbnailUrl,
            dur: e.durationSec ?? 0,
            pos: e.watchProgress?.positionSec ?? 0,
            at: e.watchProgress?.updatedAt.getTime() ?? 0,
        }))
        .sort((a, b) => a.s - b.s || a.e - b.e);
    return {
        id: t.id,
        type: t.type,
        name,
        year: t.year,
        rating: t.rating,
        overview: t.overview,
        poster: t.posterUrl,
        backdrop: t.backdropUrl,
        added: t.createdAt.getTime(),
        height: t.episodes.reduce<number | null>((m, e) => (e.height && e.height > (m ?? 0) ? e.height : m), null),
        eps,
        seasons: Array.from(new Set(eps.map((e) => e.s))),
    };
}

const titleSelect = {
    id: true, type: true, name: true, year: true, rating: true, overview: true,
    posterUrl: true, backdropUrl: true, createdAt: true,
} as const;

/** Every title with at least one converted (playable) episode. Unconverted rows stay hidden. */
export async function loadCatalog(): Promise<TitleLite[]> {
    const rows = await db.title.findMany({
        where: { episodes: { some: { mpd: { not: null } } } },
        orderBy: { name: "asc" },
        select: { ...titleSelect, episodes: { where: { mpd: { not: null } }, select: episodeSelect } },
    });
    return rows.map(toTitleLite);
}

export async function loadTitle(titleId: string): Promise<TitleLite | null> {
    const row = await db.title.findUnique({
        where: { id: titleId },
        select: { ...titleSelect, episodes: { where: { mpd: { not: null } }, select: episodeSelect } },
    });
    return row ? toTitleLite(row) : null;
}

export async function loadSyncState() {
    const [s, episodes] = await Promise.all([
        db.syncState.findUnique({ where: { id: 1 } }),
        db.episode.count({ where: { mpd: { not: null } } }),
    ]);
    return { syncedAt: s?.syncedAt.getTime() ?? null, libraryUpdatedAt: s?.libraryUpdatedAt ?? null, episodes };
}
