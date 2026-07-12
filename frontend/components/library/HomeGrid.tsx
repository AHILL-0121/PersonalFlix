"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw, LogOut } from "lucide-react";
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

export default function HomeGrid({ movies, series, continueWatching }: HomeGridProps) {
    const router = useRouter();
    const { signOut } = useClerk();
    const [refreshing, startRefresh] = useTransition();
    const [refreshStatus, setRefreshStatus] = useState<null | "ok" | "error">(null);

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

    return (
        <div className="max-w-screen-2xl mx-auto px-4 sm:px-6 lg:px-10 py-6 space-y-10">
            {/* ── Top bar ─────────────────────────────────────────────────────────── */}
            <header className="flex items-center justify-between">
                <h1 className="text-2xl font-bold tracking-tight select-none">
                    Personal<span className="text-accent">Flix</span>
                </h1>

                <div className="flex items-center gap-2">
                    {/* Refresh library */}
                    <button
                        id="btn-refresh-library"
                        onClick={handleRefreshLibrary}
                        disabled={refreshing}
                        className="btn-ghost"
                        aria-label="Refresh library from Google Drive"
                    >
                        <RefreshCw
                            className={`w-4 h-4 ${refreshing ? "animate-spin" : ""}`}
                        />
                        <span className="hidden sm:inline">
                            {refreshing
                                ? "Refreshing…"
                                : refreshStatus === "ok"
                                    ? "Done!"
                                    : refreshStatus === "error"
                                        ? "Error"
                                        : "Refresh Library"}
                        </span>
                    </button>

                    {/* Sign out */}
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

            {/* ── Continue Watching ────────────────────────────────────────────────── */}
            {continueWatching.length > 0 && (
                <section aria-labelledby="section-continue">
                    <h2 id="section-continue" className="section-title">
                        Continue Watching
                    </h2>
                    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-7 gap-3">
                        {continueWatching.map((item) => {
                            const { episode, positionSec } = item;
                            const prog = episode.durationSec
                                ? (positionSec ?? 0) / episode.durationSec
                                : 0;
                            return (
                                <PosterCard
                                    key={episode.id}
                                    id={episode.id}
                                    name={`${episode.title.name}${episode.season ? ` - S${String(episode.season.number).padStart(2, '0')} EP${String(episode.order).padStart(2, '0')}` : ""}`}
                                    type={episode.title.type as "movie" | "series"}
                                    posterUrl={episode.title.posterUrl}
                                    progress={prog}
                                    targetHref={`/player/${episode.id}`}
                                />
                            );
                        })}
                    </div>
                </section>
            )}

            {/* ── Movies ───────────────────────────────────────────────────────────── */}
            {movies.length > 0 && (
                <section aria-labelledby="section-movies">
                    <h2 id="section-movies" className="section-title">
                        Movies
                    </h2>
                    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-7 gap-3">
                        {movies.map((m) => (
                            <PosterCard
                                key={m.id}
                                id={m.id}
                                name={m.name}
                                type="movie"
                                posterUrl={m.posterUrl}
                            />
                        ))}
                    </div>
                </section>
            )}

            {/* ── Series ──────────────────────────────────────────────────────────── */}
            {series.length > 0 && (
                <section aria-labelledby="section-series">
                    <h2 id="section-series" className="section-title">
                        Series
                    </h2>
                    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-7 gap-3">
                        {series.map((s) => (
                            <PosterCard
                                key={s.id}
                                id={s.id}
                                name={s.name}
                                type="series"
                                posterUrl={s.posterUrl}
                            />
                        ))}
                    </div>
                </section>
            )}

            {/* Empty state */}
            {movies.length === 0 && series.length === 0 && (
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
