"use client";

import { useRef, useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { saveProgress } from "@/lib/progress";
import PlayerControls from "./PlayerControls";
import ResumePrompt from "./ResumePrompt";
import NextEpisodePrompt from "./NextEpisodePrompt";
import type {
    Episode,
    Title,
    Season,
    SubtitleTrack,
    AudioTrack,
    WatchProgress,
} from "@prisma/client";

type FullEpisode = Episode & {
    title: Title;
    season: (Season & { episodes: { id: string; name: string; order: number }[] }) | null;
    subtitleTracks: SubtitleTrack[];
    audioTracks: AudioTrack[];
    watchProgress: WatchProgress | null;
};

interface VideoPlayerProps {
    episode: FullEpisode;
    prevEpisodeId: string | null;
    nextEpisodeId: string | null;
    savedPositionSec: number;
    durationSec: number | null;
}

const PROGRESS_INTERVAL_MS = 10_000;
const CONTROLS_HIDE_DELAY_MS = 2800;

export default function VideoPlayer({
    episode,
    prevEpisodeId,
    nextEpisodeId,
    savedPositionSec,
    durationSec: _durationSec,
}: VideoPlayerProps) {
    const router = useRouter();
    const videoRef = useRef<HTMLVideoElement>(null);

    // ── UI state ──────────────────────────────────────────────────────────────
    const [showControls, setShowControls] = useState(true);
    const [isPlaying, setIsPlaying] = useState(false);
    const [currentTime, setCurrentTime] = useState(0);
    const [duration, setDuration] = useState(0);
    const [buffered, setBuffered] = useState(0);
    const [volume, setVolume] = useState(1);
    const [muted, setMuted] = useState(false);
    const [playbackRate, setPlaybackRate] = useState(1);
    const [showResumePrompt, setShowResumePrompt] = useState(
        savedPositionSec > 3
    );
    const [showNextPrompt, setShowNextPrompt] = useState(false);

    const hideControlsTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const progressSaveTimer = useRef<ReturnType<typeof setInterval> | null>(null);

    // ── Stream URL ────────────────────────────────────────────────────────────
    const streamUrl = `/api/stream/${episode.driveFileId}`;

    // ── Controls auto-hide ────────────────────────────────────────────────────
    const resetHideTimer = useCallback(() => {
        if (hideControlsTimer.current) clearTimeout(hideControlsTimer.current);
        setShowControls(true);
        hideControlsTimer.current = setTimeout(() => {
            if (isPlaying) setShowControls(false);
        }, CONTROLS_HIDE_DELAY_MS);
    }, [isPlaying]);

    useEffect(() => {
        resetHideTimer();
        return () => {
            if (hideControlsTimer.current) clearTimeout(hideControlsTimer.current);
        };
    }, [resetHideTimer]);

    // ── Suppress harmless media AbortErrors globally ───────────────────────────
    // The browser fires AbortError when a media fetch is cancelled (seek, unmount,
    // navigation). Next.js treats these as unhandled rejections and shows the
    // error overlay — we intercept and discard them here.
    useEffect(() => {
        function suppressMediaAbort(event: PromiseRejectionEvent) {
            if (event.reason?.name === "AbortError") {
                event.preventDefault();
            }
        }
        function suppressMediaError(event: ErrorEvent) {
            if (event.message?.includes("AbortError") || event.message?.includes("media resource")) {
                event.preventDefault();
            }
        }
        window.addEventListener("unhandledrejection", suppressMediaAbort);
        window.addEventListener("error", suppressMediaError);
        return () => {
            window.removeEventListener("unhandledrejection", suppressMediaAbort);
            window.removeEventListener("error", suppressMediaError);
        };
    }, []);

    // ── Progress saving ───────────────────────────────────────────────────────
    useEffect(() => {
        progressSaveTimer.current = setInterval(() => {
            const v = videoRef.current;
            if (v && isPlaying) {
                saveProgress(episode.id, v.currentTime);
            }
        }, PROGRESS_INTERVAL_MS);

        return () => {
            if (progressSaveTimer.current) clearInterval(progressSaveTimer.current);
        };
    }, [episode.id, isPlaying]);

    // Save on unmount / pause
    const saveNow = useCallback(() => {
        const v = videoRef.current;
        if (v) saveProgress(episode.id, v.currentTime);
    }, [episode.id]);

    // ── Keyboard shortcuts ────────────────────────────────────────────────────
    useEffect(() => {
        const v = videoRef.current;
        if (!v) return;

        function onKey(e: KeyboardEvent) {
            // Don't intercept when typing in an input
            if ((e.target as HTMLElement).tagName === "INPUT") return;
            resetHideTimer();

            switch (e.key) {
                case " ":
                case "k":
                    e.preventDefault();
                    v!.paused ? v!.play() : v!.pause();
                    break;
                case "ArrowRight":
                    e.preventDefault();
                    v!.currentTime = Math.min(v!.currentTime + 10, v!.duration);
                    break;
                case "ArrowLeft":
                    e.preventDefault();
                    v!.currentTime = Math.max(v!.currentTime - 10, 0);
                    break;
                case "ArrowUp":
                    e.preventDefault();
                    v!.volume = Math.min(v!.volume + 0.1, 1);
                    setVolume(v!.volume);
                    break;
                case "ArrowDown":
                    e.preventDefault();
                    v!.volume = Math.max(v!.volume - 0.1, 0);
                    setVolume(v!.volume);
                    break;
                case "m":
                    v!.muted = !v!.muted;
                    setMuted(v!.muted);
                    break;
                case "f":
                    if (!document.fullscreenElement) {
                        document.documentElement.requestFullscreen();
                    } else {
                        document.exitFullscreen();
                    }
                    break;
            }
        }

        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, [resetHideTimer]);

    // ── Video event handlers ──────────────────────────────────────────────────
    function onTimeUpdate() {
        const v = videoRef.current;
        if (!v) return;
        setCurrentTime(v.currentTime);

        // Update buffered end
        if (v.buffered.length > 0) {
            setBuffered(v.buffered.end(v.buffered.length - 1));
        }

        // "Next Episode" prompt logic: show in last 15s if next episode exists
        const remaining = v.duration - v.currentTime;
        if (nextEpisodeId && remaining <= 15 && remaining > 0 && !showNextPrompt) {
            setShowNextPrompt(true);
        }
    }

    function onLoadedMetadata() {
        const v = videoRef.current;
        if (!v) return;
        setDuration(v.duration);
        v.volume = volume;

        // If not showing resume prompt, start from beginning
        if (!showResumePrompt) {
            v.play().catch(() => { });
        }
    }

    function onPlay() {
        setIsPlaying(true);
        resetHideTimer();
    }

    function onPause() {
        setIsPlaying(false);
        setShowControls(true);
        saveNow();
    }

    function onEnded() {
        saveNow();
        if (nextEpisodeId) {
            router.push(`/player/${nextEpisodeId}`);
        } else {
            router.back();
        }
    }

    // Ignore MEDIA_ERR_ABORTED (code 1) — fires when browser cancels the fetch
    // on seek / navigation / unmount. All other errors are logged.
    function onVideoError() {
        const v = videoRef.current;
        if (!v || !v.error) return;
        if (v.error.code === MediaError.MEDIA_ERR_ABORTED) return; // expected, ignore
        console.error("[player] video error", v.error.code, v.error.message);
    }

    // ── Resume prompt handlers ────────────────────────────────────────────────
    function handleResume() {
        const v = videoRef.current;
        if (v) {
            v.currentTime = savedPositionSec;
            v.play().catch(() => { });
        }
        setShowResumePrompt(false);
    }

    function handleStartOver() {
        const v = videoRef.current;
        if (v) {
            v.currentTime = 0;
            v.play().catch(() => { });
        }
        setShowResumePrompt(false);
    }

    // ── Seek handler ──────────────────────────────────────────────────────────
    function seek(time: number) {
        const v = videoRef.current;
        if (v) v.currentTime = time;
        setCurrentTime(time);
    }

    // ── Playback speed ────────────────────────────────────────────────────────
    function changeRate(rate: number) {
        const v = videoRef.current;
        if (v) v.playbackRate = rate;
        setPlaybackRate(rate);
    }

    // ── Toggle play ───────────────────────────────────────────────────────────
    function togglePlay() {
        const v = videoRef.current;
        if (!v) return;
        v.paused ? v.play() : v.pause();
    }

    // ── Skip ±10s ─────────────────────────────────────────────────────────────
    function skipBack() {
        const v = videoRef.current;
        if (!v) return;
        v.currentTime = Math.max(v.currentTime - 10, 0);
        setCurrentTime(v.currentTime);
    }

    function skipForward() {
        const v = videoRef.current;
        if (!v) return;
        v.currentTime = Math.min(v.currentTime + 10, v.duration || Infinity);
        setCurrentTime(v.currentTime);
    }

    // ── Toggle mute ───────────────────────────────────────────────────────────
    function toggleMute() {
        const v = videoRef.current;
        if (!v) return;
        v.muted = !v.muted;
        setMuted(v.muted);
    }

    // ── Volume change ─────────────────────────────────────────────────────────
    function changeVolume(val: number) {
        const v = videoRef.current;
        if (!v) return;
        v.volume = val;
        setVolume(val);
        if (val > 0) {
            v.muted = false;
            setMuted(false);
        }
    }

    // ── Fullscreen ────────────────────────────────────────────────────────────
    function toggleFullscreen() {
        if (!document.fullscreenElement) {
            document.documentElement.requestFullscreen();
        } else {
            document.exitFullscreen();
        }
    }

    // ── PiP ──────────────────────────────────────────────────────────────────
    async function togglePiP() {
        const v = videoRef.current;
        if (!v) return;
        if (document.pictureInPictureElement) {
            await document.exitPictureInPicture();
        } else {
            await v.requestPictureInPicture();
        }
    }

    // ── Media Session API (OS media overlay controls) ─────────────────────────
    useEffect(() => {
        if (typeof navigator === "undefined" || !navigator.mediaSession) return;

        navigator.mediaSession.metadata = new MediaMetadata({
            title: episode.name,
            artist: episode.title?.name ?? "Personal Netflix",
            album: episode.season ? `Season ${episode.season.number}` : undefined,
        });

        navigator.mediaSession.setActionHandler("play", () => videoRef.current?.play());
        navigator.mediaSession.setActionHandler("pause", () => videoRef.current?.pause());
        navigator.mediaSession.setActionHandler("seekbackward", () => {
            const v = videoRef.current;
            if (v) { v.currentTime = Math.max(v.currentTime - 10, 0); setCurrentTime(v.currentTime); }
        });
        navigator.mediaSession.setActionHandler("seekforward", () => {
            const v = videoRef.current;
            if (v) { v.currentTime = Math.min(v.currentTime + 10, v.duration || Infinity); setCurrentTime(v.currentTime); }
        });
        navigator.mediaSession.setActionHandler("previoustrack",
            prevEpisodeId ? () => router.push(`/player/${prevEpisodeId}`) : null
        );
        navigator.mediaSession.setActionHandler("nexttrack",
            nextEpisodeId ? () => router.push(`/player/${nextEpisodeId}`) : null
        );

        return () => {
            (["play", "pause", "seekbackward", "seekforward", "previoustrack", "nexttrack"] as MediaSessionAction[])
                .forEach((action) => navigator.mediaSession.setActionHandler(action, null));
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [episode.id, prevEpisodeId, nextEpisodeId]);

    // Keep OS media position indicator in sync
    useEffect(() => {
        if (!navigator?.mediaSession || !duration) return;
        try {
            navigator.mediaSession.setPositionState({ duration, playbackRate, position: Math.min(currentTime, duration) });
        } catch { /* ignore if not supported */ }
    }, [currentTime, duration, playbackRate]);

    return (
        <div
            className="relative w-full h-full bg-black select-none"
            onMouseMove={resetHideTimer}
            onTouchStart={resetHideTimer}
            style={{ cursor: showControls ? "default" : "none" }}
        >
            {/* ── Video element ─────────────────────────────────────────────────── */}
            <video
                ref={videoRef}
                className="w-full h-full object-contain"
                src={streamUrl}
                onTimeUpdate={onTimeUpdate}
                onLoadedMetadata={onLoadedMetadata}
                onPlay={onPlay}
                onPause={onPause}
                onEnded={onEnded}
                onError={onVideoError}
                playsInline
                crossOrigin="anonymous"
            >
                {/* Subtitle tracks */}
                {episode.subtitleTracks.map((track) => (
                    <track
                        key={track.id}
                        kind="subtitles"
                        srcLang={track.language}
                        label={track.language.toUpperCase()}
                        src={`/api/stream/${track.driveFileId}`}
                    />
                ))}
            </video>

            {/* ── Resume prompt ────────────────────────────────────────────────── */}
            {showResumePrompt && (
                <ResumePrompt
                    positionSec={savedPositionSec}
                    onResume={handleResume}
                    onStartOver={handleStartOver}
                />
            )}

            {/* ── Next Episode prompt ───────────────────────────────────────────── */}
            {showNextPrompt && nextEpisodeId && (
                <NextEpisodePrompt
                    nextEpisodeId={nextEpisodeId}
                    onSkip={() => router.push(`/player/${nextEpisodeId}`)}
                    onCancel={() => setShowNextPrompt(false)}
                />
            )}

            {/* ── Controls overlay ─────────────────────────────────────────────── */}
            <div
                className={`absolute inset-0 transition-opacity duration-200 ${showControls ? "opacity-100" : "opacity-0 pointer-events-none"
                    }`}
                onClick={togglePlay}
            >
                <PlayerControls
                    episode={episode}
                    isPlaying={isPlaying}
                    currentTime={currentTime}
                    duration={duration}
                    buffered={buffered}
                    volume={volume}
                    muted={muted}
                    playbackRate={playbackRate}
                    subtitleTracks={episode.subtitleTracks}
                    audioTracks={episode.audioTracks}
                    prevEpisodeId={prevEpisodeId}
                    nextEpisodeId={nextEpisodeId}
                    onTogglePlay={togglePlay}
                    onSkipBack={skipBack}
                    onSkipForward={skipForward}
                    onSeek={seek}
                    onVolumeChange={changeVolume}
                    onToggleMute={toggleMute}
                    onRateChange={changeRate}
                    onToggleFullscreen={toggleFullscreen}
                    onTogglePiP={togglePiP}
                    onPrev={() => prevEpisodeId && router.push(`/player/${prevEpisodeId}`)}
                    onNext={() => nextEpisodeId && router.push(`/player/${nextEpisodeId}`)}
                    onBack={() => router.back()}
                    videoRef={videoRef}
                />
            </div>
        </div>
    );
}
