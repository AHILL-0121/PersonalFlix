"use client";

import { useEffect, useRef } from "react";
import { X, Play } from "lucide-react";
import { useRouter } from "next/navigation";

interface EpisodeItem {
    id: string;
    name: string;
    order: number;
}

interface EpisodeDrawerProps {
    episodes: EpisodeItem[];
    currentEpisodeId: string;
    onClose(): void;
}

export default function EpisodeDrawer({ episodes, currentEpisodeId, onClose }: EpisodeDrawerProps) {
    const router = useRouter();
    const drawerRef = useRef<HTMLDivElement>(null);
    const currentRef = useRef<HTMLButtonElement>(null);

    // Scroll active episode into view when drawer opens
    useEffect(() => {
        currentRef.current?.scrollIntoView({ block: "center", behavior: "smooth" });
    }, []);

    // Close on outside click
    useEffect(() => {
        function handler(e: MouseEvent) {
            if (drawerRef.current && !drawerRef.current.contains(e.target as Node)) {
                onClose();
            }
        }
        // defer so the click that opens doesn't immediately close
        const id = setTimeout(() => document.addEventListener("mousedown", handler), 100);
        return () => {
            clearTimeout(id);
            document.removeEventListener("mousedown", handler);
        };
    }, [onClose]);

    function navigate(id: string) {
        onClose();
        router.push(`/player/${id}`);
    }

    return (
        /* Backdrop */
        <div className="fixed inset-0 z-[60] flex justify-end">
            <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />

            {/* Drawer panel */}
            <div
                ref={drawerRef}
                className="relative w-80 h-full flex flex-col shadow-2xl animate-slide-in-right"
                style={{
                    background: "rgba(14,14,14,0.97)",
                    borderLeft: "1px solid rgba(255,255,255,0.07)",
                }}
                onClick={(e) => e.stopPropagation()}
            >
                {/* Header */}
                <div className="flex items-center justify-between px-5 py-4 border-b border-white/8 flex-shrink-0">
                    <span className="text-sm font-semibold text-white/90 tracking-wide uppercase">Episodes</span>
                    <button
                        onClick={onClose}
                        className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-white/10 text-white/60 hover:text-white transition-colors"
                    >
                        <X className="w-4 h-4" />
                    </button>
                </div>

                {/* Episode list */}
                <div className="flex-1 overflow-y-auto py-2">
                    {episodes.map((ep) => {
                        const isCurrent = ep.id === currentEpisodeId;
                        return (
                            <button
                                key={ep.id}
                                ref={isCurrent ? currentRef : undefined}
                                onClick={() => navigate(ep.id)}
                                className="w-full flex items-center gap-3 px-5 py-3 text-left transition-all duration-150 group"
                                style={{
                                    background: isCurrent ? "rgba(240,165,0,0.12)" : "transparent",
                                    borderLeft: isCurrent ? "2px solid #F0A500" : "2px solid transparent",
                                }}
                            >
                                {/* Number badge */}
                                <span
                                    className="flex-shrink-0 w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold"
                                    style={{
                                        background: isCurrent ? "#F0A500" : "rgba(255,255,255,0.08)",
                                        color: isCurrent ? "#000" : "rgba(255,255,255,0.5)",
                                    }}
                                >
                                    {isCurrent ? <Play className="w-3 h-3 fill-current" /> : ep.order}
                                </span>
                                <span
                                    className="flex-1 text-sm leading-snug"
                                    style={{ color: isCurrent ? "#F0A500" : "rgba(255,255,255,0.75)" }}
                                >
                                    {ep.name || `Episode ${ep.order}`}
                                </span>
                            </button>
                        );
                    })}
                </div>
            </div>
        </div>
    );
}
