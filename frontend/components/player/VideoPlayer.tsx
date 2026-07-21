"use client";

import { useRef, useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { saveProgress } from "@/lib/progress";
import PlayerControls from "./PlayerControls";
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
    // Reliable duration from the DB (used as fallback when browser reports
    // Infinity or a tiny fragment duration for fMP4 live streams).
    const dbDurationSec = _durationSec ?? episode.durationSec ?? 0;
    const router = useRouter();
    const videoRef = useRef<HTMLVideoElement>(null);

    const initialSeek = savedPositionSec > 5 ? savedPositionSec : 0;

    // ── UI state ──────────────────────────────────────────────────────────────
    const [showControls, setShowControls] = useState(true);
    const [isPlaying, setIsPlaying] = useState(false);
    const [currentTime, setCurrentTime] = useState(initialSeek);
    // Pre-seed from DB so the progress bar renders correctly before the browser
    // reports a reliable duration (fMP4 streams start as Infinity).
    const [duration, setDuration] = useState(dbDurationSec);
    const [buffered, setBuffered] = useState(initialSeek);
    const [volume, setVolume] = useState(1);
    const [muted, setMuted] = useState(false);
    const [playbackRate, setPlaybackRate] = useState(1);
    const [showNextPrompt, setShowNextPrompt] = useState(false);
    // True until the browser fires 'canplay' — shows a spinner during FFmpeg startup
    const [isLoading, setIsLoading] = useState(true);

    const hideControlsTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const progressSaveTimer = useRef<ReturnType<typeof setInterval> | null>(null);

    // ── Stream / Track State ──────────────────────────────────────────────────
    const [activeAudioTrack, setActiveAudioTrack] = useState<number | null>(null);
    const [isServerStream, setIsServerStream] = useState<boolean>(false);

    // If activeAudioTrack is null, normally we stream natively. But if track logic knows it's an MKV,
    // isServerStream will be flipped true, forcing server-side seeking!
    const isNative = activeAudioTrack === null && !isServerStream;

    // ── Seek offset (server-side seeking for fMP4 streams) ───────────────────
    // fMP4 piped via empty_moov supports no byte-range seeking.
    // When the user seeks, we restart the stream with ?start=<seconds> and
    // track the offset so displayed time = v.currentTime + seekOffset.
    const seekOffsetRef = useRef(!isNative ? initialSeek : 0); // always in sync, readable inside callbacks
    const currentTimeRef = useRef(initialSeek); // mirrors currentTime state, readable in effects
    const seekToTimeRef = useRef<(t: number) => void>(() => { }); // updated below

    const baseStreamUrl = `/api/stream/${episode.driveFileId}`;

    const [streamUrl, setStreamUrl] = useState(() => {
        return (!isNative && initialSeek > 0)
            ? `${baseStreamUrl}?start=${initialSeek}&audioTrack=${activeAudioTrack ?? 0}`
            : baseStreamUrl;
    });

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
        if (v) saveProgress(episode.id, v.currentTime + seekOffsetRef.current);
    }, [episode.id]);

    // ── Probe duration for MKV/fMP4 streams ──────────────────────────────────
    // fMP4 streams report Infinity for video.duration. If the DB doesn't have
    // durationSec stored, we probe it via a lightweight server-side FFmpeg call.
    useEffect(() => {
        if (dbDurationSec > 0) return; // already have it from DB
        let cancelled = false;
        fetch(`/api/duration/${episode.driveFileId}`)
            .then((r) => r.json())
            .then((data: { durationSec: number }) => {
                if (!cancelled && data.durationSec > 0) {
                    setDuration(data.durationSec);
                }
            })
            .catch(() => { /* silently ignore — seek bar just stays indeterminate */ });
        return () => { cancelled = true; };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [episode.driveFileId]);


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
                    seekToTimeRef.current(Math.min(currentTimeRef.current + 10, dbDurationSec || Infinity));
                    break;
                case "ArrowLeft":
                    e.preventDefault();
                    seekToTimeRef.current(Math.max(currentTimeRef.current - 10, 0));
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
        const effective = v.currentTime + seekOffsetRef.current;
        currentTimeRef.current = effective;
        setCurrentTime(effective);

        // Update buffered end (offset-corrected)
        if (v.buffered.length > 0) {
            setBuffered(v.buffered.end(v.buffered.length - 1) + seekOffsetRef.current);
        }

        // "Next Episode" prompt — use the `duration` state (populated from DB or
        // from the probe endpoint). NEVER use v.duration for fMP4 streams — it
        // only reflects how much has buffered, not the total episode length.
        const remaining = duration - effective;
        if (nextEpisodeId && duration > 60 && remaining <= 15 && remaining > 0 && !showNextPrompt) {
            setShowNextPrompt(true);
        }
    }

    function onLoadedMetadata() {
        const v = videoRef.current;
        if (!v) return;
        // Override DB duration only if browser reports a trustworthy finite value.
        if (isFinite(v.duration) && v.duration > 30) {
            setDuration(v.duration);
        }
        v.volume = volume;

        // Auto-seek to saved position (only needed for native MP4s, 
        // MKVs remixed through FFmpeg already requested the ?start offset in the src URL)
        if (isNative && initialSeek > 0 && v.currentTime < 1) {
            v.currentTime = initialSeek;
        }

        v.play().catch(() => { });
    }


    function onCanPlay() {
        setIsLoading(false);
    }

    function onPlay() {
        setIsPlaying(true);
        resetHideTimer();
        if (typeof screen !== "undefined" && screen.orientation && screen.orientation.lock) {
            screen.orientation.lock("landscape").catch(() => { });
        }
    }

    function onPause() {
        setIsPlaying(false);
        setShowControls(true);
        saveNow();
    }

    function onEnded() {
        // Guard: ignore false-positive 'ended' fired on tiny fMP4 fragments.
        // currentTime is offset-corrected so < 30 means it truly just started.
        if (currentTime < 30) return;
        saveNow();
        if (nextEpisodeId) {
            router.push(`/player/${nextEpisodeId}`);
        } else {
            router.back();
        }
    }

    // MEDIA_ERR_ABORTED (1) — browser cancelled fetch on seek/unmount, ignore.
    // MEDIA_ERR_DECODE   (3) — unexpected here since MKV is now handled server-
    //                          side, but log it in case of other codec issues.
    function onVideoError() {
        const v = videoRef.current;
        if (!v || !v.error) return;
        if (v.error.code === MediaError.MEDIA_ERR_ABORTED) return;
        console.error("[player] video error", v.error.code, v.error.message);
    }

    function seekToTime(time: number) {
        const v = videoRef.current;
        if (!v) return;

        const targetSec = Math.max(0, Math.floor(time));

        if (isNative) {
            v.currentTime = targetSec;
            currentTimeRef.current = targetSec;
            setCurrentTime(targetSec);
            return;
        }

        // --- Server-side seek fallback for un-transcoded MKVs ---
        seekOffsetRef.current = targetSec;
        currentTimeRef.current = targetSec;
        setCurrentTime(targetSec); // optimistic update
        setBuffered(targetSec);
        setIsLoading(true);
        const newUrl = targetSec > 0
            ? `${baseStreamUrl}?start=${targetSec}&audioTrack=${activeAudioTrack}`
            : `${baseStreamUrl}?audioTrack=${activeAudioTrack}`;
        setStreamUrl(newUrl);

        // Explicitly force video reset
        v.pause();
        v.src = newUrl;
        v.load();
        v.play().catch(() => { });
    }
    seekToTimeRef.current = seekToTime;

    // ── Seek handler (called by progress bar drag) ────────────────────────────
    function seekPreview(time: number) {
        const v = videoRef.current;
        if (!v) return;
        const targetSec = Math.max(0, Math.floor(time));

        if (isNative) {
            v.currentTime = targetSec;
        }
        setCurrentTime(targetSec);
        currentTimeRef.current = targetSec;
    }

    function seekCommit(time: number) {
        seekToTime(time);
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
        seekToTime(Math.max(currentTime - 10, 0));
    }

    function skipForward() {
        seekToTime(Math.min(currentTime + 10, dbDurationSec || Infinity));
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
            document.documentElement.requestFullscreen().then(() => {
                if (typeof screen !== "undefined" && screen.orientation && screen.orientation.lock) {
                    screen.orientation.lock("landscape").catch(() => { });
                }
            }).catch(() => { });
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
            seekToTime(Math.max(currentTime - 10, 0));
        });
        navigator.mediaSession.setActionHandler("seekforward", () => {
            seekToTime(Math.min(currentTime + 10, dbDurationSec || Infinity));
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
            {/* ── Loading spinner (visible while FFmpeg starts up) ──────────── */}
            {isLoading && (
                <div className="absolute inset-0 z-40 flex flex-col items-center justify-center gap-4 bg-black/60 backdrop-blur-sm pointer-events-none">
                    <div className="h-14 w-14 animate-spin rounded-full border-4 border-white/20 border-t-white" />
                    <p className="text-sm font-medium text-white/60 tracking-wide">Preparing video…</p>
                </div>
            )}
            {/* ── Video element ─────────────────────────────────────────────────── */}
            <video
                ref={videoRef}
                className="w-full h-full object-contain"
                src={streamUrl}
                onTimeUpdate={onTimeUpdate}
                onLoadedMetadata={onLoadedMetadata}
                onCanPlay={onCanPlay}
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
                className={`absolute inset-0 z-50 transition-opacity duration-200 ${showControls ? "opacity-100" : "opacity-0 pointer-events-none"
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
                    activeAudioTrack={activeAudioTrack}
                    fileId={episode.driveFileId}
                    onTogglePlay={togglePlay}
                    onSkipBack={skipBack}
                    onSkipForward={skipForward}
                    onSeek={seekPreview}
                    onSeekCommit={seekCommit}
                    onVolumeChange={changeVolume}
                    onToggleMute={toggleMute}
                    onRateChange={changeRate}
                    onToggleFullscreen={toggleFullscreen}
                    onTogglePiP={togglePiP}
                    onPrev={() => prevEpisodeId && router.push(`/player/${prevEpisodeId}`)}
                    onNext={() => nextEpisodeId && router.push(`/player/${nextEpisodeId}`)}
                    onBack={() => router.back()}
                    onHome={() => router.push("/")}
                    onSetServerStream={setIsServerStream}
                    onAudioTrackSwitch={(trackIdx) => {
                        if (trackIdx === activeAudioTrack) return;
                        setActiveAudioTrack(trackIdx);
                        setIsLoading(true);
                        setBuffered(0);
                        seekOffsetRef.current = 0;

                        // User specifically requested to FORCE the stream to start from 0 
                        // to guarantee absolutely zero A/V desync distortions.
                        const newUrl = `${baseStreamUrl}?start=0&audioTrack=${trackIdx}`;
                        setStreamUrl(newUrl);

                        const v = videoRef.current;
                        if (v) {
                            v.pause();
                            v.currentTime = 0;
                            v.src = newUrl;
                            v.load();
                            v.play().catch(() => { });
                        }
                    }}
                    videoRef={videoRef}
                />
            </div>
        </div>
    );
}
