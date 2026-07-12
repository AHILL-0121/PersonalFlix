"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import EpisodeRow from "@/components/ui/EpisodeRow";
import type {
    Title,
    Season,
    Episode,
    WatchProgress,
} from "@prisma/client";

type EpisodeWithProgress = Episode & { watchProgress: WatchProgress | null };
type SeasonWithEpisodes = Season & { episodes: EpisodeWithProgress[] };
type TitleWithSeasons = Title & { seasons: SeasonWithEpisodes[] };

interface TitleDetailProps {
    title: TitleWithSeasons;
}

export default function TitleDetail({ title }: TitleDetailProps) {
    const router = useRouter();
    const [activeSeason, setActiveSeason] = useState<number>(
        title.seasons[0]?.number ?? 1
    );

    const currentSeason = title.seasons.find((s) => s.number === activeSeason);

    return (
        <div className="min-h-screen bg-background">
            {/* ── Banner ───────────────────────────────────────────────────────────── */}
            <div className="relative h-48 sm:h-64 bg-surface-2 overflow-hidden flex flex-col justify-end">
                {title.posterUrl && (
                    <img
                        src={title.posterUrl}
                        alt=""
                        aria-hidden
                        className="absolute inset-0 w-full h-full object-cover opacity-30 blur-sm scale-110"
                    />
                )}
                {/* Gradient fade to background color */}
                <div className="absolute inset-0 bg-gradient-to-t from-background via-background/60 to-transparent" />

                {/* Back button */}
                <button
                    id="btn-back-to-home"
                    onClick={() => router.back()}
                    className="absolute top-4 left-4 btn-icon glass z-20"
                    aria-label="Go back"
                >
                    <ArrowLeft className="w-5 h-5" />
                </button>

                {/* Title overlay in banner */}
                <div className="relative z-10 max-w-screen-lg w-full mx-auto px-4 sm:px-6 pb-6">
                    <h1 className="text-4xl sm:text-5xl font-extrabold text-white tracking-tight drop-shadow-md pb-2">
                        {title.name}
                    </h1>
                </div>
            </div>

            {/* ── Header ───────────────────────────────────────────────────────────── */}
            <div className="max-w-screen-lg mx-auto px-4 sm:px-6 relative z-10 mt-6">
                {/* Header Row: Title & Season Dropdown */}
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
                    <h1 className="text-2xl sm:text-3xl font-bold text-white tracking-tight">
                        Episodes
                    </h1>

                    {title.seasons.length > 0 && (
                        <div className="relative">
                            <select
                                value={activeSeason}
                                onChange={(e) => setActiveSeason(Number(e.target.value))}
                                className="appearance-none bg-surface-2 hover:bg-surface-3 transition-colors text-white font-medium py-2 pl-4 pr-10 rounded-md border border-surface-3 focus:outline-none focus:ring-2 focus:ring-accent cursor-pointer"
                                aria-label="Season selector"
                            >
                                {title.seasons.map((s) => (
                                    <option key={s.id} value={s.number}>
                                        Season {s.number}
                                    </option>
                                ))}
                            </select>
                            {/* Custom dropdown arrow */}
                            <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-3 text-text-muted">
                                <svg className="w-4 h-4 fill-current" viewBox="0 0 20 20">
                                    <path d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" />
                                </svg>
                            </div>
                        </div>
                    )}
                </div>

                {/* Season Metadata text (Optional, matching Netflix style) */}
                {currentSeason && (
                    <div className="mb-4 flex items-center gap-2 text-sm text-text-muted">
                        <span className="font-semibold text-text-primary">
                            Season {currentSeason.number}:
                        </span>
                        <span>
                            {currentSeason.episodes.length} Episodes
                        </span>
                    </div>
                )}

                {/* Episode list */}
                <div
                    className="divide-y divide-surface-2"
                    role="tabpanel"
                    aria-label={`Season ${activeSeason} episodes`}
                >
                    {currentSeason?.episodes.map((ep) => (
                        <EpisodeRow
                            key={ep.id}
                            episodeId={ep.id}
                            order={ep.order}
                            name={ep.name}
                            durationSec={ep.durationSec}
                            progressSec={ep.watchProgress?.positionSec}
                            thumbnailUrl={ep.thumbnailUrl}
                            overview={ep.overview}
                        />
                    ))}

                    {!currentSeason && (
                        <p className="py-8 text-center text-text-muted text-sm">
                            No episodes found for this season.
                        </p>
                    )}
                </div>
            </div>
        </div>
    );
}
