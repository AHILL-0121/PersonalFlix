"use client";

import { RefObject, useState } from "react";
import {
    Play,
    Pause,
    SkipBack,
    SkipForward,
    RotateCcw,
    RotateCw,
    Volume2,
    VolumeX,
    Maximize,
    PictureInPicture2,
    ArrowLeft,
    Settings,
} from "lucide-react";
import SeekBar from "./SeekBar";
import SettingsPanel from "./SettingsPanel";
import { formatTime } from "@/lib/progress";
import type { Episode, Title, Season, SubtitleTrack, AudioTrack } from "@prisma/client";

type FullEpisode = Episode & {
    title: Title;
    season: (Season & { episodes: { id: string; name: string; order: number }[] }) | null;
    subtitleTracks: SubtitleTrack[];
    audioTracks: AudioTrack[];
};

interface PlayerControlsProps {
    episode: FullEpisode;
    isPlaying: boolean;
    currentTime: number;
    duration: number;
    buffered: number;
    volume: number;
    muted: boolean;
    playbackRate: number;
    subtitleTracks: SubtitleTrack[];
    audioTracks: AudioTrack[];
    prevEpisodeId: string | null;
    nextEpisodeId: string | null;
    onTogglePlay(): void;
    onSkipBack(): void;
    onSkipForward(): void;
    onSeek(t: number): void;
    onVolumeChange(v: number): void;
    onToggleMute(): void;
    onRateChange(r: number): void;
    onToggleFullscreen(): void;
    onTogglePiP(): void;
    onPrev(): void;
    onNext(): void;
    onBack(): void;
    videoRef: RefObject<HTMLVideoElement>;
}

export default function PlayerControls({
    episode,
    isPlaying,
    currentTime,
    duration,
    buffered,
    volume,
    muted,
    playbackRate,
    subtitleTracks,
    audioTracks,
    prevEpisodeId,
    nextEpisodeId,
    onTogglePlay,
    onSkipBack,
    onSkipForward,
    onSeek,
    onVolumeChange,
    onToggleMute,
    onRateChange,
    onToggleFullscreen,
    onTogglePiP,
    onPrev,
    onNext,
    onBack,
    videoRef,
}: PlayerControlsProps) {
    const [showSettings, setShowSettings] = useState(false);
    const [showVolumeSlider, setShowVolumeSlider] = useState(false);

    const title =
        episode.season
            ? `${episode.title.name} · S${episode.season.number}E${episode.order} · ${episode.name}`
            : `${episode.title.name} · ${episode.name}`;

    return (
        <div className="absolute inset-0 flex flex-col pointer-events-none">
            {/* ── Top gradient scrim ──────────────────────────────────────────── */}
            <div className="h-24 bg-gradient-to-b from-black/70 to-transparent flex-shrink-0" />

            {/* ── Top bar ────────────────────────────────────────────────────── */}
            <div className="absolute top-0 left-0 right-0 px-4 py-3 flex items-center gap-3 pointer-events-auto">
                <button
                    id="btn-player-back"
                    onClick={(e) => { e.stopPropagation(); onBack(); }}
                    className="btn-icon"
                    aria-label="Back"
                >
                    <ArrowLeft className="w-5 h-5" />
                </button>
                <span className="text-sm text-text-secondary truncate select-none">
                    {title}
                </span>
            </div>

            {/* ── Spacer ─────────────────────────────────────────────────────── */}
            <div className="flex-1" />

            {/* ── Bottom controls ────────────────────────────────────────────── */}
            <div className="px-4 pb-4 space-y-2 pointer-events-auto bg-gradient-to-t from-black/80 via-black/40 to-transparent pt-10">
                {/* Seek bar */}
                <SeekBar
                    currentTime={currentTime}
                    duration={duration}
                    buffered={buffered}
                    onSeek={onSeek}
                />

                {/* Transport row */}
                <div
                    className="flex items-center gap-1"
                    onClick={(e) => e.stopPropagation()}
                >
                    {/* Left group */}
                    <div className="flex items-center gap-1">
                        {/* Play / Pause */}
                        <button
                            id="btn-play-pause"
                            onClick={onTogglePlay}
                            className="btn-icon w-11 h-11"
                            aria-label={isPlaying ? "Pause" : "Play"}
                        >
                            {isPlaying ? (
                                <Pause className="w-6 h-6 fill-current" />
                            ) : (
                                <Play className="w-6 h-6 fill-current ml-0.5" />
                            )}
                        </button>

                        {/* Prev episode */}
                        <button
                            id="btn-prev-episode"
                            onClick={onPrev}
                            disabled={!prevEpisodeId}
                            className="btn-icon disabled:opacity-30"
                            aria-label="Previous episode"
                        >
                            <SkipBack className="w-5 h-5" />
                        </button>

                        {/* Next episode */}
                        <button
                            id="btn-next-episode"
                            onClick={onNext}
                            disabled={!nextEpisodeId}
                            className="btn-icon disabled:opacity-30"
                            aria-label="Next episode"
                        >
                            <SkipForward className="w-5 h-5" />
                        </button>

                        {/* Rewind 10s */}
                        <button
                            id="btn-rewind-10"
                            onClick={(e) => { e.stopPropagation(); onSkipBack(); }}
                            className="btn-icon relative"
                            aria-label="Rewind 10 seconds"
                        >
                            <RotateCcw className="w-5 h-5" />
                            <span className="absolute inset-0 flex items-center justify-center text-[9px] font-bold mt-0.5 pointer-events-none">10</span>
                        </button>

                        {/* Forward 10s */}
                        <button
                            id="btn-forward-10"
                            onClick={(e) => { e.stopPropagation(); onSkipForward(); }}
                            className="btn-icon relative"
                            aria-label="Forward 10 seconds"
                        >
                            <RotateCw className="w-5 h-5" />
                            <span className="absolute inset-0 flex items-center justify-center text-[9px] font-bold mt-0.5 pointer-events-none">10</span>
                        </button>

                        {/* Volume */}
                        <div
                            className="relative flex items-center gap-2 ml-2"
                            onMouseEnter={() => setShowVolumeSlider(true)}
                            onMouseLeave={() => setShowVolumeSlider(false)}
                        >
                            <button
                                id="btn-mute"
                                onClick={onToggleMute}
                                className="btn-icon"
                                aria-label={muted ? "Unmute" : "Mute"}
                            >
                                {muted || volume === 0 ? (
                                    <VolumeX className="w-5 h-5" />
                                ) : (
                                    <Volume2 className="w-5 h-5" />
                                )}
                            </button>
                            {showVolumeSlider && (
                                <input
                                    id="volume-slider"
                                    type="range"
                                    min={0}
                                    max={1}
                                    step={0.05}
                                    value={muted ? 0 : volume}
                                    onChange={(e) => onVolumeChange(parseFloat(e.target.value))}
                                    className="w-24 h-1 accent-accent cursor-pointer"
                                    aria-label="Volume"
                                />
                            )}
                        </div>

                        {/* Time */}
                        <span className="text-xs text-text-secondary tabular-nums select-none ml-1">
                            {formatTime(currentTime)} / {formatTime(duration)}
                        </span>
                    </div>

                    {/* Spacer */}
                    <div className="flex-1" />

                    {/* Right group */}
                    <div className="flex items-center gap-1">
                        {/* PiP */}
                        <button
                            id="btn-pip"
                            onClick={onTogglePiP}
                            className="btn-icon"
                            aria-label="Picture in Picture"
                        >
                            <PictureInPicture2 className="w-5 h-5" />
                        </button>

                        {/* Settings */}
                        <div className="relative">
                            <button
                                id="btn-settings"
                                onClick={() => setShowSettings((v) => !v)}
                                className={`btn-icon ${showSettings ? "text-accent" : ""}`}
                                aria-label="Settings"
                                aria-expanded={showSettings}
                            >
                                <Settings className="w-5 h-5" />
                            </button>
                            {showSettings && (
                                <SettingsPanel
                                    playbackRate={playbackRate}
                                    subtitleTracks={subtitleTracks}
                                    audioTracks={audioTracks}
                                    videoRef={videoRef}
                                    onRateChange={onRateChange}
                                    onClose={() => setShowSettings(false)}
                                />
                            )}
                        </div>

                        {/* Fullscreen */}
                        <button
                            id="btn-fullscreen"
                            onClick={onToggleFullscreen}
                            className="btn-icon"
                            aria-label="Toggle fullscreen"
                        >
                            <Maximize className="w-5 h-5" />
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}
