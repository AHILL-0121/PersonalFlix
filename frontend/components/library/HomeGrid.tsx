"use client";

import { useState, useTransition, useRef, useCallback, useEffect } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw, LogOut, Search, X, ChevronLeft, ChevronRight, Trash2 } from "lucide-react";

import { useClerk } from "@clerk/nextjs";
import PosterCard from "@/components/ui/PosterCard";
import type { Title, WatchProgress, Episode, Season } from "@prisma/client";

interface ContinueItem extends WatchProgress {
    episode: Episode & {
        title: Title;
        season: Season | null;
    };
}

interface HomeGridProps {
    movies: Title[];
    series: Title[];
    continueWatching: ContinueItem[];
}

/* ─────────────────────────────────────────────────────────────────────────────
   Single-row horizontal carousel  (Continue Watching)
   Uses plain flexbox — items never wrap
───────────────────────────────────────────────────────────────────────────── */
function RowCarousel({
    sectionId,
    label,
    items,
}: {
    sectionId: string;
    label: string;
    items: React.ReactNode[];
}) {
    const trackRef = useRef<HTMLDivElement>(null);

    const scroll = useCallback((dir: "left" | "right") => {
        const el = trackRef.current;
        if (!el) return;
        el.scrollBy({ left: dir === "right" ? el.clientWidth : -el.clientWidth, behavior: "smooth" });
    }, []);

    if (items.length === 0) return null;

    return (
        <section aria-labelledby={`section-${sectionId}`}>
            <div className="flex items-center justify-between mb-3">
                <h2 id={`section-${sectionId}`} className="section-title mb-0">
                    {label}
                    <span className="ml-2 text-sm font-normal text-text-muted">({items.length})</span>
                </h2>
                <div className="flex gap-1.5">
                    <button onClick={() => scroll("left")} className="carousel-nav-btn" aria-label={`Scroll ${label} left`}>
                        <ChevronLeft className="w-4 h-4" />
                    </button>
                    <button onClick={() => scroll("right")} className="carousel-nav-btn" aria-label={`Scroll ${label} right`}>
                        <ChevronRight className="w-4 h-4" />
                    </button>
                </div>
            </div>

            {/* Single flex-row track */}
            <div
                ref={trackRef}
                role="list"
                className="hide-scrollbar"
                style={{
                    display: "flex",
                    flexDirection: "row",
                    flexWrap: "nowrap",
                    gap: "12px",
                    overflowX: "auto",
                    overflowY: "hidden",
                }}
            >
                {items.map((item, i) => (
                    <div
                        key={i}
                        role="listitem"
                        /* Each card: fixed width respecting the 6-col breakpoint */
                        style={{ flex: "0 0 calc((100% - 60px) / 6)", minWidth: "120px", maxWidth: "220px" }}
                    >
                        {item}
                    </div>
                ))}
            </div>
        </section>
    );
}

/* ─────────────────────────────────────────────────────────────────────────────
   4-row × 6-column horizontal carousel  (Movies / Series)

   Strategy — "page chunking":
   • Items are split into pages of ROWS×COLS = 4×6 = 24.
   • Each page is a standard CSS grid (grid-auto-flow: row = default), so items
     fill LEFT→RIGHT then TOP→BOTTOM inside that page.
   • Pages are placed side-by-side in a flex row that scrolls horizontally.
   • cardWidth is measured from a clip wrapper via ResizeObserver so exactly
     6 columns fill the visible area.
───────────────────────────────────────────────────────────────────────────── */
const GRID_ROWS = 4;
const GRID_COLS = 6;
const PAGE_SIZE = GRID_ROWS * GRID_COLS; // 24 cards per page

function GridCarousel({
    sectionId,
    label,
    items,
}: {
    sectionId: string;
    label: string;
    items: React.ReactNode[];
}) {
    const clipRef = useRef<HTMLDivElement>(null);
    const trackRef = useRef<HTMLDivElement>(null);
    const [cardWidth, setCardWidth] = useState<number>(180);

    // cardWidth = (visibleWidth − (COLS−1)×gap) / COLS
    const updateCardWidth = useCallback(() => {
        if (!clipRef.current) return;
        const w = clipRef.current.offsetWidth;
        setCardWidth(Math.floor((w - (GRID_COLS - 1) * 12) / GRID_COLS));
    }, []);

    useEffect(() => {
        updateCardWidth();
        const ro = new ResizeObserver(updateCardWidth);
        if (clipRef.current) ro.observe(clipRef.current);
        return () => ro.disconnect();
    }, [updateCardWidth]);

    // Scroll exactly one full page (all 6 columns) at a time
    const pageWidth = cardWidth * GRID_COLS + (GRID_COLS - 1) * 12;
    const scroll = useCallback((dir: "left" | "right") => {
        const el = trackRef.current;
        if (!el) return;
        el.scrollBy({ left: dir === "right" ? pageWidth : -pageWidth, behavior: "smooth" });
    }, [pageWidth]);

    if (items.length === 0) return null;

    // Chunk into pages so each page fills L→R, T→B
    const pages: React.ReactNode[][] = [];
    for (let i = 0; i < items.length; i += PAGE_SIZE) {
        pages.push(items.slice(i, i + PAGE_SIZE));
    }

    return (
        <section aria-labelledby={`section-${sectionId}`}>
            <div className="flex items-center justify-between mb-3">
                <h2 id={`section-${sectionId}`} className="section-title mb-0">
                    {label}
                    <span className="ml-2 text-sm font-normal text-text-muted">({items.length})</span>
                </h2>
                <div className="flex gap-1.5">
                    <button onClick={() => scroll("left")} className="carousel-nav-btn" aria-label={`Scroll ${label} left`}>
                        <ChevronLeft className="w-4 h-4" />
                    </button>
                    <button onClick={() => scroll("right")} className="carousel-nav-btn" aria-label={`Scroll ${label} right`}>
                        <ChevronRight className="w-4 h-4" />
                    </button>
                </div>
            </div>

            {/* Clip wrapper — stable measured width, hides the overflow */}
            <div ref={clipRef} style={{ overflow: "hidden" }}>
                {/* Flex row of pages — scrolls horizontally */}
                <div
                    ref={trackRef}
                    role="list"
                    className="hide-scrollbar"
                    style={{
                        display: "flex",
                        flexDirection: "row",
                        flexWrap: "nowrap",
                        gap: "12px",
                        overflowX: "auto",
                        overflowY: "hidden",
                        paddingBottom: "4px",
                    }}
                >
                    {pages.map((page, pageIdx) => (
                        /* Each page: 6-col grid, fills left→right then top→bottom */
                        <div
                            key={pageIdx}
                            style={{
                                display: "grid",
                                gridTemplateColumns: `repeat(${GRID_COLS}, ${cardWidth}px)`,
                                gridTemplateRows: `repeat(${GRID_ROWS}, auto)`,
                                gap: "12px",
                                flexShrink: 0,
                                alignItems: "start",   /* cells don't stretch vertically */
                                alignContent: "start", /* rows pack to top, no stretch */
                            }}
                        >
                            {page.map((item, i) => (
                                <div
                                    key={i}
                                    role="listitem"
                                    style={{ width: `${cardWidth}px`, overflow: "hidden" }}
                                >
                                    {item}
                                </div>
                            ))}
                        </div>
                    ))}

                </div>
            </div>
        </section>
    );
}


/* ─────────────────────────────────────────────────────────────────────────────
   Main HomeGrid
───────────────────────────────────────────────────────────────────────────── */
export default function HomeGrid({ movies, series, continueWatching }: HomeGridProps) {
    const router = useRouter();
    const { signOut } = useClerk();
    const [refreshing, startRefresh] = useTransition();
    const [refreshStatus, setRefreshStatus] = useState<null | "ok" | "error">(null);
    const [query, setQuery] = useState("");

    async function handleRefreshLibrary() {
        startRefresh(async () => {
            try {
                const res = await fetch("/api/library/refresh", { method: "POST" });
                setRefreshStatus(res.ok ? "ok" : "error");
                if (res.ok) router.refresh();
            } catch {
                setRefreshStatus("error");
            }
            setTimeout(() => setRefreshStatus(null), 3000);
        });
    }

    // Force-refresh: clear all cached metadata first, then re-scan
    // Use this when posters/names are wrong from a previous bad scan.
    const [forceRefreshing, setForceRefreshing] = useState(false);
    async function handleForceRefresh() {
        if (!confirm("This will clear all cached posters and re-fetch metadata from scratch. Continue?")) return;
        setForceRefreshing(true);
        try {
            // 1. Clear metadata
            await fetch("/api/library/refresh", { method: "DELETE" });
            // 2. Re-scan
            const res = await fetch("/api/library/refresh", { method: "POST" });
            setRefreshStatus(res.ok ? "ok" : "error");
            if (res.ok) router.refresh();
        } catch {
            setRefreshStatus("error");
        }
        setForceRefreshing(false);
        setTimeout(() => setRefreshStatus(null), 3000);
    }

    const q = query.trim().toLowerCase();
    const filteredMovies = q ? movies.filter((m) => m.name.toLowerCase().includes(q)) : movies;
    const filteredSeries = q ? series.filter((s) => s.name.toLowerCase().includes(q)) : series;
    const filteredContinue = q
        ? continueWatching.filter((p) => p.episode.title.name.toLowerCase().includes(q))
        : continueWatching;

    const isSearching = q.length > 0;
    const noResults =
        isSearching && filteredMovies.length === 0 && filteredSeries.length === 0 && filteredContinue.length === 0;

    return (
        <div className="max-w-screen-2xl mx-auto px-4 sm:px-6 lg:px-10 py-6 space-y-10">
            {/* ── Top bar ────────────────────────────────────────────────────────── */}
            <header className="flex items-center justify-between gap-4 flex-wrap">
                <h1 className="text-2xl font-bold tracking-tight select-none flex-shrink-0">
                    Personal<span className="text-accent">Flix</span>
                </h1>

                {/* Search bar */}
                <div className="relative flex-1 max-w-md">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted pointer-events-none" />
                    <input
                        id="search-library"
                        type="search"
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                        placeholder="Search movies & series…"
                        className="w-full pl-9 pr-9 py-2 rounded-lg bg-surface-2 border border-surface-3 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-accent/50 transition"
                        aria-label="Search library"
                    />
                    {query && (
                        <button
                            onClick={() => setQuery("")}
                            className="absolute right-2.5 top-1/2 -translate-y-1/2 text-text-muted hover:text-text-primary transition"
                            aria-label="Clear search"
                        >
                            <X className="w-4 h-4" />
                        </button>
                    )}
                </div>

                <div className="flex items-center gap-2 flex-shrink-0">
                    {/* Force re-scan (clears metadata first) */}
                    <button
                        id="btn-force-refresh"
                        onClick={handleForceRefresh}
                        disabled={refreshing || forceRefreshing}
                        className="btn-ghost text-text-muted hover:text-red-400"
                        title="Clear all cached metadata and re-fetch from scratch"
                        aria-label="Force re-scan library"
                    >
                        <Trash2 className={`w-4 h-4 ${forceRefreshing ? "animate-pulse" : ""}`} />
                    </button>

                    <button
                        id="btn-refresh-library"
                        onClick={handleRefreshLibrary}
                        disabled={refreshing || forceRefreshing}
                        className="btn-ghost"
                        aria-label="Refresh library from Google Drive"
                    >
                        <RefreshCw className={`w-4 h-4 ${refreshing ? "animate-spin" : ""}`} />
                        <span className="hidden sm:inline">
                            {(refreshing || forceRefreshing)
                                ? "Refreshing…"
                                : refreshStatus === "ok"
                                    ? "Done!"
                                    : refreshStatus === "error"
                                        ? "Error"
                                        : "Refresh Library"}
                        </span>
                    </button>

                    <button
                        id="btn-sign-out"
                        onClick={() => signOut(() => router.push("/sign-in"))}
                        className="btn-icon"
                        aria-label="Sign out"
                    >
                        <LogOut className="w-4 h-4" />
                    </button>
                </div>
            </header>

            {/* ── No results ─────────────────────────────────────────────────────── */}
            {noResults && (
                <div className="flex flex-col items-center justify-center py-16 gap-3 text-text-muted">
                    <Search className="w-8 h-8 opacity-40" />
                    <p className="text-base">No results for &ldquo;{query}&rdquo;</p>
                </div>
            )}

            {/* ── Continue Watching — single row ─────────────────────────────────── */}
            <RowCarousel
                sectionId="continue"
                label="Continue Watching"
                items={filteredContinue.map((item) => {
                    const { episode, positionSec } = item;
                    const prog = episode.durationSec ? (positionSec ?? 0) / episode.durationSec : 0;
                    return (
                        <PosterCard
                            key={episode.id}
                            id={episode.id}
                            name={`${episode.title.name}${episode.season
                                ? ` · S${String(episode.season.number).padStart(2, "0")}E${String(episode.order).padStart(2, "0")}`
                                : ""
                                }`}
                            type={episode.title.type as "movie" | "series"}
                            posterUrl={episode.title.posterUrl}
                            progress={prog}
                            targetHref={`/player/${episode.id}`}
                        />
                    );
                })}
            />

            {/* ── Movies — 4 rows × 6 columns ────────────────────────────────────── */}
            <GridCarousel
                sectionId="movies"
                label="Movies"
                items={filteredMovies.map((m) => (
                    <PosterCard key={m.id} id={m.id} name={m.name} type="movie" posterUrl={m.posterUrl} />
                ))}
            />

            {/* ── Series — 4 rows × 6 columns ────────────────────────────────────── */}
            <GridCarousel
                sectionId="series"
                label="Series"
                items={filteredSeries.map((s) => (
                    <PosterCard key={s.id} id={s.id} name={s.name} type="series" posterUrl={s.posterUrl} />
                ))}
            />

            {/* Empty state */}
            {!isSearching && movies.length === 0 && series.length === 0 && (
                <div className="flex flex-col items-center justify-center py-24 gap-4 text-text-muted">
                    <p className="text-lg">Your library is empty.</p>
                    <p className="text-sm">
                        Add files to your Google Drive and press{" "}
                        <span className="text-accent font-medium">Refresh Library</span>.
                    </p>
                </div>
            )}
        </div>
    );
}
