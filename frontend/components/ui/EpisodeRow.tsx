"use client";

import { useRouter } from "next/navigation";
import { Play } from "lucide-react";

interface EpisodeRowProps {
    episodeId: string;
    order: number;
    name: string;
    durationSec?: number | null;
    progressSec?: number;
    thumbnailUrl?: string | null;
    overview?: string | null;
}

export default function EpisodeRow({
    episodeId,
    order,
    name,
    durationSec,
    progressSec,
    thumbnailUrl,
    overview,
}: EpisodeRowProps) {
    const router = useRouter();

    const progress =
        durationSec && progressSec ? progressSec / durationSec : undefined;

    return (
        <div
            className="flex items-start gap-4 p-4 border-b border-surface-2 hover:bg-surface-2 transition-colors cursor-pointer group"
            role="button"
            tabIndex={0}
            aria-label={`Play episode: ${name}`}
            onClick={() => router.push(`/player/${episodeId}`)}
            onKeyDown={(e) => e.key === "Enter" && router.push(`/player/${episodeId}`)}
        >
            {/* Sequence Number */}
            <div className="text-xl sm:text-2xl text-text-muted font-light pt-2 w-4 sm:w-8 text-center select-none flex-shrink-0">
                {order}
            </div>

            {/* Thumbnail */}
            <div className="relative w-32 sm:w-40 aspect-[16/9] flex-shrink-0 bg-surface-3 rounded-md overflow-hidden">
                {thumbnailUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                        src={thumbnailUrl}
                        alt={name}
                        className="absolute inset-0 w-full h-full object-cover"
                    />
                ) : (
                    <div className="absolute inset-0 flex items-center justify-center text-text-muted">
                        <Play className="w-8 h-8 opacity-20" />
                    </div>
                )}

                {/* Play hover overlay */}
                <div className="absolute inset-0 bg-black/40 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                    <div className="w-10 h-10 rounded-full border-2 border-white flex items-center justify-center bg-black/50 backdrop-blur-sm">
                        <Play className="w-5 h-5 text-white fill-white ml-0.5" />
                    </div>
                </div>

                {/* Watch Progress (Red bar at bottom of thumbnail) */}
                {progress !== undefined && progress > 0 && (
                    <div className="absolute bottom-0 left-0 right-0 h-1 bg-surface-1">
                        <div className="h-full bg-accent" style={{ width: `${Math.min(progress * 100, 100)}%` }} />
                    </div>
                )}
            </div>

            {/* Episode Info */}
            <div className="flex-1 min-w-0 pr-4">
                <div className="flex justify-between items-start pt-1">
                    <h3 className="text-sm sm:text-base font-semibold text-white tracking-tight">{name}</h3>
                    {durationSec && <span className="text-sm text-text-muted select-none">{Math.round(durationSec / 60)}m</span>}
                </div>
                <p className="mt-2 text-xs sm:text-sm text-text-secondary line-clamp-3 leading-relaxed">
                    {overview || "No description available."}
                </p>
            </div>
        </div>
    );
}
