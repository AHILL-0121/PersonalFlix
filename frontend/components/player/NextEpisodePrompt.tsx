"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { X } from "lucide-react";

interface NextEpisodePromptProps {
    nextEpisodeId: string;
    onSkip(): void;
    onCancel(): void;
}

const AUTO_ADVANCE_DELAY_MS = 8000;

export default function NextEpisodePrompt({
    nextEpisodeId,
    onSkip,
    onCancel,
}: NextEpisodePromptProps) {
    const router = useRouter();
    const [progress, setProgress] = useState(0); // 0–100
    const rafRef = useRef<number | null>(null);
    const startRef = useRef<number | null>(null);

    useEffect(() => {
        function tick(timestamp: number) {
            if (!startRef.current) startRef.current = timestamp;
            const elapsed = timestamp - startRef.current;
            const pct = Math.min((elapsed / AUTO_ADVANCE_DELAY_MS) * 100, 100);
            setProgress(pct);

            if (pct < 100) {
                rafRef.current = requestAnimationFrame(tick);
            } else {
                router.push(`/player/${nextEpisodeId}`);
            }
        }
        rafRef.current = requestAnimationFrame(tick);
        return () => {
            if (rafRef.current) cancelAnimationFrame(rafRef.current);
        };
    }, [nextEpisodeId, router]);

    return (
        <div
            id="next-episode-prompt"
            className="absolute bottom-24 right-4 z-30 glass rounded-xl px-5 py-4 flex items-center gap-4
                 shadow-2xl animate-fade-in max-w-xs"
        >
            {/* Circular countdown */}
            <div className="relative w-10 h-10 flex-shrink-0">
                <svg className="w-10 h-10 -rotate-90" viewBox="0 0 36 36">
                    <circle
                        cx="18"
                        cy="18"
                        r="15.9"
                        fill="none"
                        stroke="#2a2a2a"
                        strokeWidth="2"
                    />
                    <circle
                        cx="18"
                        cy="18"
                        r="15.9"
                        fill="none"
                        stroke="#e0562d"
                        strokeWidth="2"
                        strokeDasharray="100"
                        strokeDashoffset={100 - progress}
                        strokeLinecap="round"
                        style={{ transition: "stroke-dashoffset 0.1s linear" }}
                    />
                </svg>
            </div>

            <div className="flex flex-col gap-1 min-w-0">
                <p className="text-xs text-text-secondary">Next Episode</p>
                <button
                    id="btn-next-now"
                    onClick={onSkip}
                    className="text-sm font-semibold text-accent hover:text-accent-hover transition-colors text-left"
                >
                    Play Now →
                </button>
            </div>

            <button
                id="btn-cancel-next"
                onClick={onCancel}
                className="btn-icon flex-shrink-0 w-7 h-7"
                aria-label="Cancel auto-advance"
            >
                <X className="w-4 h-4" />
            </button>
        </div>
    );
}
