"use client";

import Image from "next/image";
import { useRouter } from "next/navigation";
import { Play } from "lucide-react";

interface PosterCardProps {
    id: string;
    name: string;
    type: "movie" | "series";
    posterUrl?: string | null;
    /** Progress 0-1 for the continue-watching bar */
    progress?: number;
    targetHref?: string;
    onRemove?: () => void;
}

export default function PosterCard({
    id,
    name,
    type,
    posterUrl,
    progress,
    targetHref,
    onRemove,
}: PosterCardProps) {
    const router = useRouter();
    const href = targetHref ?? `/title/${id}`;

    return (
        <article
            className="group poster-card focus-visible:ring-2 focus-visible:ring-accent"
            role="button"
            tabIndex={0}
            aria-label={`Play ${name}`}
            onClick={() => router.push(href)}
            onKeyDown={(e) => e.key === "Enter" && router.push(href)}
        >
            {/* Poster image */}
            {posterUrl ? (
                <Image
                    src={posterUrl}
                    alt={`${name} poster`}
                    fill
                    sizes="(max-width:640px) 50vw, (max-width:1024px) 25vw, 15vw"
                    className="object-cover"
                    priority={false}
                />
            ) : (
                // Fallback when no poster is available
                <div className="absolute inset-0 bg-surface-2 flex items-end p-3">
                    <span className="text-text-secondary text-xs font-medium line-clamp-2 leading-tight">
                        {name}
                    </span>
                </div>
            )}

            {/* Hover overlay */}
            <div className="poster-card-overlay">
                {/* Remove button (top right) */}
                {onRemove && (
                    <button
                        className="absolute top-2 right-2 p-1.5 opacity-0 group-hover:opacity-100 transition-opacity bg-black/60 rounded-full hover:bg-black/90 pointer-events-auto z-10"
                        onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            onRemove();
                        }}
                        aria-label="Remove from list"
                    >
                        <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
                        </svg>
                    </button>
                )}

                {/* Play icon */}
                <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity duration-150 pointer-events-none">
                    <div className="w-12 h-12 rounded-full bg-white/20 backdrop-blur-sm flex items-center justify-center">
                        <Play className="w-5 h-5 text-white fill-white ml-0.5" />
                    </div>
                </div>

                {/* Title + progress at bottom */}
                <div className="absolute bottom-0 left-0 right-0 p-3 space-y-1.5">
                    <p className="text-white text-xs font-semibold line-clamp-2 leading-tight">
                        {name}
                    </p>
                    {/* Watch progress bar */}
                    {progress !== undefined && progress > 0 && (
                        <div className="w-full h-0.5 bg-white/20 rounded-full overflow-hidden">
                            <div
                                className="h-full bg-accent rounded-full transition-all"
                                style={{ width: `${Math.min(progress * 100, 100)}%` }}
                            />
                        </div>
                    )}
                </div>
            </div>
        </article>
    );
}
