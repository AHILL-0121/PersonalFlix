"use client";

import { RefObject, useEffect, useRef, useState } from "react";
import type { SubtitleTrack, AudioTrack } from "@prisma/client";

const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];

interface SettingsPanelProps {
    playbackRate: number;
    subtitleTracks: SubtitleTrack[];
    audioTracks: AudioTrack[];
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
    const [activeTab, setActiveTab] = useState<Tab>("speed");
    const [activeSubtitle, setActiveSubtitle] = useState<string | null>(null);

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

    function selectSubtitle(lang: string | null) {
        const v = videoRef.current;
        if (!v) return;
        setActiveSubtitle(lang);
        Array.from(v.textTracks).forEach((t) => {
            t.mode = t.language === lang ? "showing" : "hidden";
        });
    }

    const shownTabs: { id: Tab; label: string }[] = [
        { id: "speed", label: "Speed" },
        ...(subtitleTracks.length > 0 ? [{ id: "subtitles" as Tab, label: "Subtitles" }] : []),
        ...(audioTracks.length > 0 ? [{ id: "audio" as Tab, label: "Audio" }] : []),
    ];

    return (
        <div
            ref={panelRef}
            id="settings-panel"
            className="absolute bottom-12 right-0 w-56 glass rounded-xl overflow-hidden shadow-2xl animate-fade-in z-50"
            onClick={(e) => e.stopPropagation()}
        >
            {/* Tab bar */}
            <div className="flex border-b border-white/10">
                {shownTabs.map((tab) => (
                    <button
                        key={tab.id}
                        id={`settings-tab-${tab.id}`}
                        onClick={() => setActiveTab(tab.id)}
                        className={`flex-1 py-2 text-xs font-medium transition-colors duration-150 ${activeTab === tab.id
                            ? "text-accent border-b-2 border-accent -mb-px"
                            : "text-text-secondary hover:text-text-primary"
                            }`}
                    >
                        {tab.label}
                    </button>
                ))}
            </div>

            {/* Content */}
            <div className="py-1 max-h-60 overflow-y-auto">
                {activeTab === "speed" &&
                    SPEEDS.map((speed) => (
                        <button
                            key={speed}
                            id={`speed-${speed}`}
                            onClick={() => onRateChange(speed)}
                            className={`w-full px-4 py-2 text-sm text-left transition-colors duration-100 ${playbackRate === speed
                                ? "text-accent font-semibold"
                                : "text-text-secondary hover:bg-white/5 hover:text-text-primary"
                                }`}
                        >
                            {speed === 1 ? "Normal" : `${speed}×`}
                        </button>
                    ))}

                {activeTab === "subtitles" && (
                    <>
                        <button
                            id="subtitle-off"
                            onClick={() => selectSubtitle(null)}
                            className={`w-full px-4 py-2 text-sm text-left transition-colors duration-100 ${!activeSubtitle
                                ? "text-accent font-semibold"
                                : "text-text-secondary hover:bg-white/5 hover:text-text-primary"
                                }`}
                        >
                            Off
                        </button>
                        {subtitleTracks.map((t) => (
                            <button
                                key={t.id}
                                id={`subtitle-${t.language}`}
                                onClick={() => selectSubtitle(t.language)}
                                className={`w-full px-4 py-2 text-sm text-left transition-colors duration-100 ${activeSubtitle === t.language
                                    ? "text-accent font-semibold"
                                    : "text-text-secondary hover:bg-white/5 hover:text-text-primary"
                                    }`}
                            >
                                {t.language.toUpperCase()}
                            </button>
                        ))}
                    </>
                )}

                {activeTab === "audio" && (
                    <>
                        {audioTracks.map((t) => (
                            <button
                                key={t.id}
                                id={`audio-${t.language}`}
                                onClick={() => {
                                    // Audio track switching via HTMLVideoElement.audioTracks (where supported)
                                    const v = videoRef.current;
                                    if (v && "audioTracks" in v) {
                                        const tracks = (v as any).audioTracks;
                                        for (let i = 0; i < tracks.length; i++) {
                                            const track = tracks[i];
                                            track.enabled = track.language === t.language;
                                        }
                                    }
                                }}
                                className="w-full px-4 py-2 text-sm text-left text-text-secondary hover:bg-white/5 hover:text-text-primary transition-colors duration-100"
                            >
                                {t.language.toUpperCase()}
                            </button>
                        ))}
                    </>
                )}
            </div>
        </div>
    );
}
