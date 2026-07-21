"use client";

import { RefObject, useEffect, useState } from "react";
import {
    Play,
    Pause,
    SkipBack,
    SkipForward,
    RotateCcw,
    RotateCw,
    Volume2,
    Volume1,
    VolumeX,
    Maximize,
    Minimize,
    PictureInPicture2,
    ArrowLeft,
    Home,
    Settings,
    List,
    ChevronRight,
    Music2,
} from "lucide-react";
import SeekBar from "./SeekBar";
import SettingsPanel from "./SettingsPanel";
import EpisodeDrawer from "./EpisodeDrawer";
import { formatTime } from "@/lib/progress";
import type { Episode, Title, Season, SubtitleTrack, AudioTrack } from "@prisma/client";

type FullEpisode = Episode & {
    title: Title & { posterUrl?: string | null };
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
    fileId: string;
    activeAudioTrack: number | null;
    prevEpisodeId: string | null;
    nextEpisodeId: string | null;
    onTogglePlay(): void;
    onSkipBack(): void;
    onSkipForward(): void;
    onSeek(t: number): void;
    onSeekCommit(t: number): void;
    onVolumeChange(v: number): void;
    onToggleMute(): void;
    onRateChange(r: number): void;
    onToggleFullscreen(): void;
    onTogglePiP(): void;
    onPrev(): void;
    onNext(): void;
    onBack(): void;
    onHome(): void;
    onAudioTrackSwitch(idx: number | null): void;
    videoRef: RefObject<HTMLVideoElement>;
}

const AMBER = "#F0A500";

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
    fileId,
    activeAudioTrack,
    onTogglePlay,
    onSkipBack,
    onSkipForward,
    onSeek,
    onSeekCommit,
    onVolumeChange,
    onToggleMute,
    onRateChange,
    onToggleFullscreen,
    onTogglePiP,
    onPrev,
    onNext,
    onBack,
    onHome,
    onAudioTrackSwitch,
    videoRef,
}: PlayerControlsProps) {
    const [showSettings, setShowSettings] = useState(false);
    const [showVolumeSlider, setShowVolumeSlider] = useState(false);
    const [showEpisodes, setShowEpisodes] = useState(false);
    const [showAudioPicker, setShowAudioPicker] = useState(false);
    const [isFullscreen, setIsFullscreen] = useState(false);

    // ── Server-fetched audio tracks (since Chrome hides them in MKV) ─────────
    const [embeddedTracks, setEmbeddedTracks] = useState<{ index: number; label: string }[]>([]);

    useEffect(() => {
        // Fetch embedded track info from ffprobe
        fetch(`/api/tracks/${fileId}`)
            .then(res => res.json())
            .then(data => {
                if (data.audioTracks?.length > 1) {
                    setEmbeddedTracks(data.audioTracks);
                }
            })
            .catch(console.error);
    }, [fileId]);

    function switchAudioTrack(idx: number | null) {
        onAudioTrackSwitch(idx);
        setShowAudioPicker(false);
    }

    const episodes = episode.season?.episodes ?? [];
    const seasonNum = episode.season?.number;
    const epNum = episode.order;
    const hasEpisodes = episodes.length > 1;

    function handleFullscreen() {
        setIsFullscreen(!document.fullscreenElement);
        onToggleFullscreen();
    }

    // Volume icon choice
    const VolumeIcon = muted || volume === 0 ? VolumeX : volume < 0.5 ? Volume1 : Volume2;

    return (
        <>
            {/* Episode drawer — rendered at root level to cover entire screen */}
            {showEpisodes && hasEpisodes && (
                <EpisodeDrawer
                    episodes={episodes}
                    currentEpisodeId={episode.id}
                    onClose={() => setShowEpisodes(false)}
                />
            )}

            <div className="absolute inset-0 flex flex-col pointer-events-none">

                {/* ── Top gradient scrim ─────────────────────────────────────── */}
                <div
                    className="absolute top-0 left-0 right-0 h-32 pointer-events-none"
                    style={{ background: "linear-gradient(to bottom, rgba(0,0,0,0.85) 0%, transparent 100%)" }}
                />

                {/* ── Top bar ───────────────────────────────────────────────── */}
                <div className="absolute top-0 left-0 right-0 px-5 pt-4 pb-2 flex items-center gap-3 pointer-events-auto z-10">
                    {/* Back */}
                    <button
                        id="btn-player-back"
                        onClick={(e) => { e.stopPropagation(); onBack(); }}
                        className="flex-shrink-0 w-9 h-9 flex items-center justify-center rounded-full
                                   bg-black/40 hover:bg-black/70 text-white/80 hover:text-white
                                   transition-all duration-150 backdrop-blur-sm border border-white/10"
                        aria-label="Back"
                    >
                        <ArrowLeft className="w-4 h-4" />
                    </button>

                    {/* Poster thumbnail */}
                    {episode.title.posterUrl && (
                        <img
                            src={episode.title.posterUrl}
                            alt={episode.title.name}
                            className="flex-shrink-0 w-8 h-11 rounded object-cover shadow-lg ring-1 ring-white/10"
                        />
                    )}

                    {/* Breadcrumb */}
                    <div className="flex-1 min-w-0 flex flex-col gap-0.5">
                        <span className="text-white font-semibold text-sm leading-tight truncate">
                            {episode.title.name}
                        </span>
                        {seasonNum != null && (
                            <div className="flex items-center gap-1.5 text-white/50 text-xs">
                                <span>Season {seasonNum}</span>
                                <ChevronRight className="w-3 h-3 flex-shrink-0" />
                                <span>Episode {epNum}</span>
                                {episode.name && !/^episode\s*0?\d+$/i.test(episode.name.trim()) && (
                                    <>
                                        <ChevronRight className="w-3 h-3 flex-shrink-0" />
                                        <span className="truncate text-white/70">{episode.name}</span>
                                    </>
                                )}
                            </div>
                        )}
                    </div>

                    {/* Home */}
                    <button
                        id="btn-player-home"
                        onClick={(e) => { e.stopPropagation(); onHome(); }}
                        className="flex-shrink-0 w-9 h-9 flex items-center justify-center rounded-full
                                   bg-black/40 hover:bg-black/70 text-white/80 hover:text-white
                                   transition-all duration-150 backdrop-blur-sm border border-white/10"
                        aria-label="Go to library"
                    >
                        <Home className="w-4 h-4" />
                    </button>
                </div>

                {/* ── Spacer ────────────────────────────────────────────────── */}
                <div className="flex-1" />

                {/* ── Bottom controls ───────────────────────────────────────── */}
                <div
                    className="px-5 pb-5 space-y-2 pointer-events-auto"
                    style={{ background: "linear-gradient(to top, rgba(0,0,0,0.9) 0%, rgba(0,0,0,0.5) 60%, transparent 100%)", paddingTop: "40px" }}
                    onClick={(e) => e.stopPropagation()}
                >
                    {/* Seek bar */}
                    <SeekBar
                        currentTime={currentTime}
                        duration={duration}
                        buffered={buffered}
                        onSeek={onSeek}
                        onSeekCommit={onSeekCommit}
                    />

                    {/* Transport row */}
                    <div className="flex items-center gap-2">

                        {/* ── Left group: transport ───────────────────────── */}
                        <div className="flex items-center gap-1">

                            {/* Play / Pause — amber accented focal point */}
                            <button
                                id="btn-play-pause"
                                onClick={onTogglePlay}
                                className="flex items-center justify-center w-12 h-12 rounded-full transition-all duration-150
                                           hover:scale-110 active:scale-95 shadow-lg mx-1"
                                style={{ background: AMBER, boxShadow: `0 0 20px ${AMBER}55` }}
                                aria-label={isPlaying ? "Pause" : "Play"}
                            >
                                {isPlaying ? (
                                    <Pause className="w-5 h-5 fill-black text-black" />
                                ) : (
                                    <Play className="w-5 h-5 fill-black text-black ml-0.5" />
                                )}
                            </button>

                            {/* Prev episode */}
                            <button
                                id="btn-prev-episode"
                                onClick={onPrev}
                                disabled={!prevEpisodeId}
                                className="player-ghost-btn disabled:opacity-25"
                                aria-label="Previous episode"
                            >
                                <SkipBack className="w-4 h-4" />
                            </button>

                            {/* Next episode */}
                            <button
                                id="btn-next-episode"
                                onClick={onNext}
                                disabled={!nextEpisodeId}
                                className="player-ghost-btn disabled:opacity-25"
                                aria-label="Next episode"
                            >
                                <SkipForward className="w-4 h-4" />
                            </button>

                            {/* Rewind 10s */}
                            <button
                                id="btn-rewind-10"
                                onClick={(e) => { e.stopPropagation(); onSkipBack(); }}
                                className="player-ghost-btn relative"
                                aria-label="Rewind 10 seconds"
                            >
                                <RotateCcw className="w-4 h-4" />
                                <span className="absolute inset-0 flex items-center justify-center text-[8px] font-black mt-0.5">10</span>
                            </button>

                            {/* Forward 10s */}
                            <button
                                id="btn-forward-10"
                                onClick={(e) => { e.stopPropagation(); onSkipForward(); }}
                                className="player-ghost-btn relative"
                                aria-label="Forward 10 seconds"
                            >
                                <RotateCw className="w-4 h-4" />
                                <span className="absolute inset-0 flex items-center justify-center text-[8px] font-black mt-0.5">10</span>
                            </button>
                        </div>

                        {/* ── Volume (separated) ──────────────────────────── */}
                        <div
                            className="flex items-center gap-2 ml-3"
                            onMouseEnter={() => setShowVolumeSlider(true)}
                            onMouseLeave={() => setShowVolumeSlider(false)}
                        >
                            <button
                                id="btn-mute"
                                onClick={onToggleMute}
                                className="player-ghost-btn"
                                aria-label={muted ? "Unmute" : "Mute"}
                            >
                                <VolumeIcon className="w-4 h-4" />
                            </button>
                            <div
                                className="overflow-hidden transition-all duration-200"
                                style={{ width: showVolumeSlider ? "80px" : "0px", opacity: showVolumeSlider ? 1 : 0 }}
                            >
                                <input
                                    id="volume-slider"
                                    type="range"
                                    min={0}
                                    max={1}
                                    step={0.05}
                                    value={muted ? 0 : volume}
                                    onChange={(e) => onVolumeChange(parseFloat(e.target.value))}
                                    className="w-20 cursor-pointer volume-slider"
                                    aria-label="Volume"
                                />
                            </div>
                        </div>

                        {/* ── Time display ────────────────────────────────── */}
                        <span className="text-xs text-white/75 tabular-nums select-none font-mono ml-1">
                            <span className="text-white font-medium">{formatTime(currentTime)}</span>
                            <span className="text-white/40 mx-1">/</span>
                            {formatTime(duration)}
                        </span>

                        {/* ── Spacer ──────────────────────────────────────── */}
                        <div className="flex-1" />

                        {/* ── Right group: utility ────────────────────────── */}
                        <div className="flex items-center gap-1">

                            {/* Audio track quick-picker */}
                            {embeddedTracks.length > 1 && (
                                <div className="relative">
                                    <button
                                        id="btn-audio-track"
                                        onClick={(e) => { e.stopPropagation(); setShowAudioPicker((v) => !v); setShowSettings(false); }}
                                        className={`player-ghost-btn ${showAudioPicker || activeAudioTrack !== null ? "text-amber-400" : ""}`}
                                        aria-label="Switch audio track"
                                        title="Audio track"
                                    >
                                        <Music2 className="w-4 h-4" />
                                    </button>
                                    {showAudioPicker && (
                                        <div
                                            className="absolute bottom-12 right-0 w-48 rounded-xl overflow-hidden shadow-2xl z-[60]"
                                            style={{
                                                background: "rgba(16,16,16,0.96)",
                                                border: "1px solid rgba(255,255,255,0.08)",
                                                backdropFilter: "blur(16px)",
                                            }}
                                            onClick={(e) => e.stopPropagation()}
                                        >
                                            <p className="px-4 pt-3 pb-1 text-[10px] font-bold uppercase tracking-widest"
                                                style={{ color: "#F0A500" }}>Audio Track</p>

                                            {/* "Native" track placeholder — clears the active track so we stream directly without FFmpeg */}
                                            <button
                                                onClick={() => switchAudioTrack(null)}
                                                className="w-full flex items-center justify-between px-4 py-2 text-sm hover:bg-white/5 transition-colors duration-100"
                                                style={{ color: activeAudioTrack === null ? "#F0A500" : "rgba(255,255,255,0.65)" }}
                                            >
                                                <span>{embeddedTracks[0]?.label || "Original (Direct)"}</span>
                                                {activeAudioTrack === null && <span className="text-xs">✓</span>}
                                            </button>

                                            {embeddedTracks.slice(1).map((t) => (
                                                <button
                                                    key={t.index}
                                                    onClick={() => switchAudioTrack(t.index)}
                                                    className="w-full flex items-center justify-between px-4 py-2 text-sm hover:bg-white/5 transition-colors duration-100"
                                                    style={{ color: activeAudioTrack === t.index ? "#F0A500" : "rgba(255,255,255,0.65)" }}
                                                >
                                                    <span>{t.label}</span>
                                                    {activeAudioTrack === t.index && (
                                                        <span className="text-xs">✓</span>
                                                    )}
                                                </button>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            )}

                            {/* Episode list */}
                            {hasEpisodes && (
                                <button
                                    id="btn-episode-list"
                                    onClick={() => setShowEpisodes(true)}
                                    className={`player-ghost-btn ${showEpisodes ? "text-amber-400" : ""}`}
                                    aria-label="Episode list"
                                >
                                    <List className="w-4 h-4" />
                                </button>
                            )}

                            {/* PiP */}
                            <button
                                id="btn-pip"
                                onClick={onTogglePiP}
                                className="player-ghost-btn"
                                aria-label="Picture in Picture"
                            >
                                <PictureInPicture2 className="w-4 h-4" />
                            </button>

                            {/* Settings */}
                            <div className="relative">
                                <button
                                    id="btn-settings"
                                    onClick={(e) => { e.stopPropagation(); setShowSettings((v) => !v); }}
                                    className={`player-ghost-btn ${showSettings ? "text-amber-400" : ""}`}
                                    aria-label="Settings"
                                    aria-expanded={showSettings}
                                >
                                    <Settings className="w-4 h-4" />
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
                                onClick={handleFullscreen}
                                className="player-ghost-btn"
                                aria-label="Toggle fullscreen"
                            >
                                {isFullscreen ? (
                                    <Minimize className="w-4 h-4" />
                                ) : (
                                    <Maximize className="w-4 h-4" />
                                )}
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        </>
    );
}
