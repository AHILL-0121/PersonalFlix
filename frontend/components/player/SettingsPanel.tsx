"use client";

import { RefObject, useEffect, useRef, useState } from "react";
import { Check } from "lucide-react";
import type { SubtitleTrack, AudioTrack } from "@prisma/client";

const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];

interface SettingsPanelProps {
    playbackRate: number;
    subtitleTracks: SubtitleTrack[];   // DB-stored subtitle files
    audioTracks: AudioTrack[];         // DB-stored separate audio files (usually empty)
    videoRef: RefObject<HTMLVideoElement>;
    onRateChange(r: number): void;
    onClose(): void;
}

type Tab = "speed" | "subtitles" | "audio";

export default function SettingsPanel({
    playbackRate,
    subtitleTracks,
    audioTracks,
    videoRef,
    onRateChange,
    onClose,
}: SettingsPanelProps) {
    const panelRef = useRef<HTMLDivElement>(null);
    const [activeSubtitle, setActiveSubtitle] = useState<string | null>(null);

    // ── Subtitle switching ────────────────────────────────────────────────────
    function selectSubtitle(lang: string | null) {
        const v = videoRef.current;
        if (!v) return;
        setActiveSubtitle(lang);
        Array.from(v.textTracks).forEach((t) => {
            t.mode = t.language === lang ? "showing" : "hidden";
        });
    }

    // ── Tab visibility ────────────────────────────────────────────────────────
    const hasDbAudio = audioTracks.length > 0;
    const hasSubtitles = subtitleTracks.length > 0;

    const [activeTab, setActiveTab] = useState<Tab>("speed");

    const shownTabs: { id: Tab; label: string }[] = [
        { id: "speed", label: "Speed" },
        ...(hasSubtitles ? [{ id: "subtitles" as Tab, label: "Subtitles" }] : []),
        ...(hasDbAudio ? [{ id: "audio" as Tab, label: "Audio" }] : []),
    ];

    // Close on outside click
    useEffect(() => {
        function handler(e: MouseEvent) {
            if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
                onClose();
            }
        }
        document.addEventListener("mousedown", handler);
        return () => document.removeEventListener("mousedown", handler);
    }, [onClose]);

    return (
        <div
            ref={panelRef}
            id="settings-panel"
            className="absolute bottom-12 right-0 w-60 rounded-xl overflow-hidden shadow-2xl animate-fade-in z-50"
            style={{
                background: "rgba(16,16,16,0.96)",
                border: "1px solid rgba(255,255,255,0.08)",
                backdropFilter: "blur(16px)",
            }}
            onClick={(e) => e.stopPropagation()}
        >
            {/* Tab bar */}
            <div className="flex border-b border-white/8">
                {shownTabs.map((tab) => (
                    <button
                        key={tab.id}
                        id={`settings-tab-${tab.id}`}
                        onClick={() => setActiveTab(tab.id)}
                        className="flex-1 py-2.5 text-xs font-semibold tracking-wide transition-colors duration-150"
                        style={{
                            color: activeTab === tab.id ? "#F0A500" : "rgba(255,255,255,0.45)",
                            borderBottom: activeTab === tab.id ? "2px solid #F0A500" : "2px solid transparent",
                            marginBottom: "-1px",
                        }}
                    >
                        {tab.label}
                    </button>
                ))}
            </div>

            {/* Content */}
            <div className="py-1 max-h-64 overflow-y-auto">

                {/* ── Speed ──────────────────────────────────────────────── */}
                {activeTab === "speed" &&
                    SPEEDS.map((speed) => {
                        const isActive = playbackRate === speed;
                        return (
                            <button
                                key={speed}
                                id={`speed-${speed}`}
                                onClick={() => onRateChange(speed)}
                                className="w-full flex items-center justify-between px-4 py-2 text-sm transition-colors duration-100 hover:bg-white/5"
                                style={{ color: isActive ? "#F0A500" : "rgba(255,255,255,0.65)" }}
                            >
                                <span>{speed === 1 ? "Normal" : `${speed}×`}</span>
                                {isActive && <Check className="w-3.5 h-3.5" />}
                            </button>
                        );
                    })
                }

                {/* ── Subtitles ──────────────────────────────────────────── */}
                {activeTab === "subtitles" && (
                    <>
                        <button
                            id="subtitle-off"
                            onClick={() => selectSubtitle(null)}
                            className="w-full flex items-center justify-between px-4 py-2 text-sm transition-colors duration-100 hover:bg-white/5"
                            style={{ color: !activeSubtitle ? "#F0A500" : "rgba(255,255,255,0.65)" }}
                        >
                            <span>Off</span>
                            {!activeSubtitle && <Check className="w-3.5 h-3.5" />}
                        </button>
                        {subtitleTracks.map((t) => {
                            const isActive = activeSubtitle === t.language;
                            return (
                                <button
                                    key={t.id}
                                    id={`subtitle-${t.language}`}
                                    onClick={() => selectSubtitle(t.language)}
                                    className="w-full flex items-center justify-between px-4 py-2 text-sm transition-colors duration-100 hover:bg-white/5"
                                    style={{ color: isActive ? "#F0A500" : "rgba(255,255,255,0.65)" }}
                                >
                                    <span>{t.language.toUpperCase()}</span>
                                    {isActive && <Check className="w-3.5 h-3.5" />}
                                </button>
                            );
                        })}
                    </>
                )}

                {/* ── Audio ──────────────────────────────────────────────── */}
                {activeTab === "audio" && (
                    <>
                        {/* DB-stored separate audio tracks */}
                        {hasDbAudio && audioTracks.map((t) => (
                            <button
                                key={t.id}
                                id={`audio-${t.language}`}
                                onClick={() => {
                                    const v = videoRef.current;
                                    if (!v || !("audioTracks" in v)) return;
                                    const tracks = (v as any).audioTracks;
                                    for (let i = 0; i < tracks.length; i++) {
                                        (tracks[i] as any).enabled = (tracks[i] as any).language === t.language;
                                    }
                                }}
                                className="w-full flex items-center px-4 py-2 text-sm text-white/65 hover:bg-white/5 hover:text-white transition-colors duration-100"
                            >
                                {t.language.toUpperCase()}
                            </button>
                        ))}

                        {/* Fallback when no tracks detected yet */}
                        {!hasDbAudio && (
                            <p className="px-4 py-3 text-sm text-white/30 text-center">
                                No alternate audio tracks
                            </p>
                        )}
                    </>
                )}
            </div>
        </div>
    );
}
