"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import EpisodeRows from "@/components/home/EpisodeRows";
import Art from "@/components/ui/Art";
import Icon from "@/components/ui/Icon";
import { useToast } from "@/components/ui/Toasts";
import { saveProgress } from "@/lib/progress";
import {
    audioChoices, createPlayer, describeShakaError, driveToken, manifestUri, type AudioTrack, type ShakaPlayer,
} from "@/lib/shaka";
import { code, fmt, isDone, left, nextEp, playHref, prevEp, regrade, runtime, type Ep, type TitleLite } from "@/lib/ui";
import SeekBar from "./SeekBar";

const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 2];
const SAVE_EVERY_MS = 30_000;
const IDLE_MS = 2800;
const UPNEXT_AT = 20; // seconds before the end
const UPNEXT_MS = 10_000;

const LANG_NAMES: Record<string, string> = {
    en: "English", eng: "English", ta: "Tamil", tam: "Tamil", hi: "Hindi", hin: "Hindi", te: "Telugu", tel: "Telugu",
    ml: "Malayalam", mal: "Malayalam", kn: "Kannada", kan: "Kannada", ja: "Japanese", jpn: "Japanese",
    und: "Original",
};

const store = {
    get: (k: string) => { try { return localStorage.getItem(k); } catch { return null; } },
    set: (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* private mode */ } },
};

type Phase = "loading" | "ready" | "error";

export default function Player({
    title,
    episodeId,
    mpd,
    start,
}: {
    title: TitleLite;
    episodeId: string;
    mpd: string;
    start: "start" | "resume" | "ask";
}) {
    const router = useRouter();
    const toast = useToast();
    const ep = useMemo(() => title.eps.find((e) => e.id === episodeId)!, [title, episodeId]);
    const next = useMemo(() => nextEp(title, ep), [title, ep]);
    const prev = useMemo(() => prevEp(title, ep), [title, ep]);
    const isSeries = title.type === "series";

    const wrapRef = useRef<HTMLDivElement>(null);
    const videoRef = useRef<HTMLVideoElement>(null);
    const playerRef = useRef<ShakaPlayer | null>(null);

    const [phase, setPhase] = useState<Phase>("loading");
    const [step, setStep] = useState("Authorising stream…");
    const [error, setError] = useState<string | null>(null);
    const [playing, setPlaying] = useState(false);
    const [needsTap, setNeedsTap] = useState(false);
    const [buffering, setBuffering] = useState(false);
    const [time, setTime] = useState(0);
    const [dur, setDur] = useState(ep.dur);
    const [buf, setBuf] = useState(0);
    const [vol, setVol] = useState(0.8);
    const [muted, setMuted] = useState(false);
    const [rate, setRate] = useState(1);
    const [idle, setIdle] = useState(false);
    const [resumeAt, setResumeAt] = useState<number | null>(null);
    const [resumeLeft, setResumeLeft] = useState(6);
    const [upnext, setUpnext] = useState<{ shown: boolean; cancelled: boolean; t0: number }>({ shown: false, cancelled: false, t0: 0 });
    const [ring, setRing] = useState(0);
    const [panel, setPanel] = useState<null | "speed" | "audio">(null);
    const [drawer, setDrawer] = useState(false);
    const [drawerSeason, setDrawerSeason] = useState(ep.s);
    const [help, setHelp] = useState(false);
    const [tracks, setTracks] = useState<AudioTrack[]>([]);
    const [hud, setHud] = useState<{ text: string; n: number } | null>(null);
    const [ripples, setRipples] = useState<{ id: number; fwd: boolean }[]>([]);
    const [pipOk, setPipOk] = useState(false);

    const seekDrag = useRef(false);
    const idleTimer = useRef<ReturnType<typeof setTimeout>>();
    const lastSaved = useRef<number>(-1);
    const leaving = useRef(false);
    const lastTap = useRef<{ t: number; zone: string | null }>({ t: 0, zone: null });
    // latest position/state for saves that run after React has detached the <video> (unmount)
    const posRef = useRef(0);
    const readyRef = useRef(false);
    // setups run one after another, so a cancelled one (Strict Mode's double effect) never races the next
    const setupChain = useRef<Promise<void>>(Promise.resolve());

    const flash = useCallback((text: string) => setHud((h) => ({ text, n: (h?.n ?? 0) + 1 })), []);

    // ── progress ────────────────────────────────────────────────────────────────
    const save = useCallback(async (force = false) => {
        if (!readyRef.current) return;
        const v = videoRef.current;
        const t = v ? (v.ended ? v.duration || dur : v.currentTime) : posRef.current;
        if (t < 3 && !force) return;
        if (Math.abs(t - lastSaved.current) < 2) return;
        lastSaved.current = t;
        await saveProgress(episodeId, Math.floor(t));
    }, [dur, episodeId]);
    const saveRef = useRef(save);
    saveRef.current = save;

    useEffect(() => {
        if (!playing) return;
        const i = setInterval(() => save(), SAVE_EVERY_MS);
        return () => clearInterval(i);
    }, [playing, save]);

    useEffect(() => {
        const onHide = () => { if (document.visibilityState === "hidden") save(); };
        const onPageHide = () => save();
        document.addEventListener("visibilitychange", onHide);
        window.addEventListener("pagehide", onPageHide);
        return () => {
            document.removeEventListener("visibilitychange", onHide);
            window.removeEventListener("pagehide", onPageHide);
        };
    }, [save]);

    // ── set up Shaka and load the manifest ──────────────────────────────────────
    useEffect(() => {
        const video = videoRef.current!;
        let cancelled = false;
        regrade(title.id);
        const savedVol = parseFloat(store.get("pf.vol") ?? "");
        if (!isNaN(savedVol)) { video.volume = savedVol; setVol(savedVol); }
        setPipOk(typeof document !== "undefined" && "pictureInPictureEnabled" in document && !!document.pictureInPictureEnabled);

        const saved = ep.pos > 5 && (!ep.dur || ep.pos < ep.dur - 30) ? ep.pos : 0;
        const startAt = start === "start" ? 0 : saved;

        setupChain.current = setupChain.current.then(async () => {
            if (cancelled) return;
            try {
                setStep("Authorising stream…");
                await driveToken();
                if (cancelled) return;
                setStep("Starting player…");
                const player = await createPlayer(video, store.get("pf.audioLang"));
                if (cancelled) { await player.destroy(); return; }
                playerRef.current = player;

                player.addEventListener("error", (e) => {
                    const err = e.detail;
                    if (err?.code === 1001 && Number(err?.data?.[1]) === 401) {
                        // token expired mid-stream: get a fresh one and carry on
                        driveToken(true).then(() => player.retryStreaming()).catch(() => {});
                        return;
                    }
                    if (err?.severity === 2) { setError(describeShakaError(err)); setPhase("error"); }
                });
                player.addEventListener("buffering", (e) => setBuffering(!!e.buffering));
                const refreshTracks = () => setTracks(audioChoices(player));
                player.addEventListener("trackschanged", refreshTracks);
                player.addEventListener("variantchanged", refreshTracks);

                setStep("Opening file on Drive…");
                const uri = manifestUri(mpd);
                try {
                    await player.load(uri, startAt || null, "application/dash+xml");
                } finally {
                    URL.revokeObjectURL(uri);
                }
                if (cancelled) return;
                refreshTracks();
                setDur(video.duration || ep.dur);
                posRef.current = video.currentTime;
                lastSaved.current = video.currentTime; // loading at the saved spot isn't news
                readyRef.current = true;
                setPhase("ready");

                if (start === "ask" && saved) {
                    setResumeAt(saved); // loaded at the saved spot; the card decides
                } else {
                    video.play().catch(() => setNeedsTap(true));
                }
            } catch (err: any) {
                if (cancelled) return;
                setError(err?.code ? describeShakaError(err) : err?.message ?? String(err));
                setPhase("error");
            }
        });

        return () => {
            cancelled = true;
            const p = playerRef.current;
            playerRef.current = null;
            if (p) setupChain.current = setupChain.current.then(() => p.destroy()).catch(() => {});
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps -- one load per mounted episode (page keys Player by episode)
    }, []);

    // save once more when the player goes away without leave()/goEp() (browser back, etc.)
    useEffect(() => () => { if (!leaving.current) saveRef.current(); }, []);

    // ── video element events ────────────────────────────────────────────────────
    useEffect(() => {
        const v = videoRef.current!;
        const onTime = () => {
            posRef.current = v.currentTime;
            setTime(v.currentTime);
            for (let i = 0; i < v.buffered.length; i++) {
                if (v.buffered.start(i) <= v.currentTime + 0.5 && v.buffered.end(i) >= v.currentTime) { setBuf(v.buffered.end(i)); break; }
            }
        };
        const onPlay = () => { setPlaying(true); setNeedsTap(false); };
        const onPause = () => { setPlaying(false); save(); };
        const onDur = () => { if (v.duration && isFinite(v.duration)) setDur(v.duration); };
        const onVol = () => { setVol(v.volume); setMuted(v.muted); };
        const onRate = () => setRate(v.playbackRate);
        v.addEventListener("timeupdate", onTime);
        v.addEventListener("progress", onTime);
        v.addEventListener("seeked", onTime);
        v.addEventListener("play", onPlay);
        v.addEventListener("pause", onPause);
        v.addEventListener("durationchange", onDur);
        v.addEventListener("volumechange", onVol);
        v.addEventListener("ratechange", onRate);
        return () => {
            v.removeEventListener("timeupdate", onTime);
            v.removeEventListener("progress", onTime);
            v.removeEventListener("seeked", onTime);
            v.removeEventListener("play", onPlay);
            v.removeEventListener("pause", onPause);
            v.removeEventListener("durationchange", onDur);
            v.removeEventListener("volumechange", onVol);
            v.removeEventListener("ratechange", onRate);
        };
    }, [save]);

    // ── transport ───────────────────────────────────────────────────────────────
    const togglePlay = useCallback(() => {
        const v = videoRef.current;
        if (!v || phase !== "ready" || resumeAt !== null) return;
        if (v.paused) { v.play().catch(() => setNeedsTap(true)); flash("▶"); }
        else { v.pause(); flash("❚❚"); }
    }, [flash, phase, resumeAt]);

    const seekTo = useCallback((t: number, label?: string) => {
        const v = videoRef.current;
        if (!v || phase !== "ready") return;
        const d = v.duration || dur;
        v.currentTime = Math.max(0, Math.min(d - 1, t));
        setTime(v.currentTime);
        if (label) flash(label);
        if (v.currentTime < d - UPNEXT_AT - 5) setUpnext((u) => ({ ...u, shown: false }));
    }, [dur, flash, phase]);

    const setVolume = useCallback((val: number, show = true) => {
        const v = videoRef.current;
        if (!v) return;
        v.volume = Math.max(0, Math.min(1, val));
        v.muted = v.volume === 0;
        store.set("pf.vol", String(v.volume));
        if (show) flash(`🔊 ${Math.round(v.volume * 100)}%`);
    }, [flash]);

    const toggleMute = useCallback(() => {
        const v = videoRef.current;
        if (!v) return;
        v.muted = !v.muted;
        if (!v.muted && v.volume === 0) v.volume = 0.8;
        flash(v.muted ? "Muted" : "Sound on");
    }, [flash]);

    const setSpeed = useCallback((r: number) => {
        if (videoRef.current) videoRef.current.playbackRate = r;
        flash(r === 1 ? "Normal speed" : `${r}×`);
    }, [flash]);

    const selectAudio = useCallback((t: AudioTrack) => {
        const p = playerRef.current;
        if (!p || t.active) return;
        // clearing the buffer switches right away; the position stays where it is
        p.selectVariantTrack(t, true, 0);
        store.set("pf.audioLang", t.language);
        setTracks(audioChoices(p));
        toast(`Audio: ${trackName(t)} — at ${fmt(videoRef.current?.currentTime ?? 0)}`);
    }, [toast]);

    const leave = useCallback(async (to = "/") => {
        if (leaving.current) return;
        leaving.current = true;
        await save(true);
        if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
        router.push(to);
        router.refresh();
    }, [router, save]);

    const goEp = useCallback(async (target: Ep | null, opts: { start?: boolean } = {}) => {
        if (!target || leaving.current) return;
        leaving.current = true;
        await save(true);
        router.replace(playHref(target.id, opts));
    }, [router, save]);

    const toggleFullscreen = useCallback(async () => {
        const wrap = wrapRef.current, v = videoRef.current as any;
        try {
            if (document.fullscreenElement) await document.exitFullscreen();
            else if (wrap?.requestFullscreen) {
                await wrap.requestFullscreen();
                try { await (screen.orientation as any)?.lock?.("landscape"); } catch { /* not allowed everywhere */ }
            } else if (v?.webkitEnterFullscreen) v.webkitEnterFullscreen();
        } catch {
            toast("Fullscreen isn't available here");
        }
    }, [toast]);

    const togglePip = useCallback(async () => {
        const v = videoRef.current;
        if (!v) return;
        try {
            if (document.pictureInPictureElement) await document.exitPictureInPicture();
            else await v.requestPictureInPicture();
        } catch {
            toast("Picture-in-picture isn't available here");
        }
    }, [toast]);

    // ── resume card: auto-resume after 6 s ──────────────────────────────────────
    useEffect(() => {
        if (resumeAt === null) return;
        const t0 = performance.now();
        const i = setInterval(() => {
            const el = (performance.now() - t0) / 1000;
            setResumeLeft(Math.max(0, 6 - el));
            if (el >= 6) doResume();
        }, 100);
        return () => clearInterval(i);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [resumeAt]);

    function doResume() {
        const v = videoRef.current;
        if (!v || resumeAt === null) return;
        setResumeAt(null);
        v.play().catch(() => setNeedsTap(true));
        flash(`↻ ${fmt(v.currentTime)}`);
    }
    function startOver() {
        const v = videoRef.current;
        if (!v) return;
        setResumeAt(null);
        v.currentTime = 0;
        v.play().catch(() => setNeedsTap(true));
    }

    // ── up next card during the credits, then auto-advance ──────────────────────
    useEffect(() => {
        if (!next || upnext.cancelled || phase !== "ready" || !dur) return;
        if (time >= dur - UPNEXT_AT && !upnext.shown) setUpnext((u) => ({ ...u, shown: true, t0: performance.now() }));
    }, [time, dur, next, upnext.cancelled, upnext.shown, phase]);

    useEffect(() => {
        if (!upnext.shown || !playing) return;
        let raf = 0;
        const loop = () => {
            const el = (performance.now() - upnext.t0) / UPNEXT_MS;
            setRing(Math.min(1, el));
            if (el >= 1) { goEp(next); return; }
            raf = requestAnimationFrame(loop);
        };
        raf = requestAnimationFrame(loop);
        return () => cancelAnimationFrame(raf);
    }, [upnext.shown, upnext.t0, playing, goEp, next]);

    useEffect(() => {
        const v = videoRef.current!;
        const onEnded = () => {
            if (next && !upnext.cancelled) goEp(next);
            else {
                toast(`Finished ${title.name}`, true);
                leave();
            }
        };
        v.addEventListener("ended", onEnded);
        return () => v.removeEventListener("ended", onEnded);
    }, [goEp, leave, next, title.name, toast, upnext.cancelled]);

    // ── chrome auto-hide ────────────────────────────────────────────────────────
    const showChrome = useCallback((stay = false) => {
        setIdle(false);
        clearTimeout(idleTimer.current);
        if (stay) return;
        idleTimer.current = setTimeout(() => {
            if (videoRef.current && !videoRef.current.paused && !seekDrag.current) setIdle(true);
        }, IDLE_MS);
    }, []);

    useEffect(() => {
        if (!playing || panel || drawer || help) { setIdle(false); clearTimeout(idleTimer.current); }
        else showChrome();
    }, [playing, panel, drawer, help, showChrome]);

    const toggleChromeTouch = () => {
        if (idle || !playing) showChrome();
        else setIdle(true);
    };

    const onZone = (zone: "l" | "r", e: React.PointerEvent) => {
        if (e.pointerType === "mouse") { togglePlay(); return; }
        const now = Date.now();
        if (now - lastTap.current.t < 320 && lastTap.current.zone === zone) {
            const fwd = zone === "r";
            seekTo((videoRef.current?.currentTime ?? 0) + (fwd ? 10 : -10));
            const id = now;
            setRipples((r) => [...r, { id, fwd }]);
            setTimeout(() => setRipples((r) => r.filter((x) => x.id !== id)), 650);
            lastTap.current = { t: 0, zone: null };
        } else {
            lastTap.current = { t: now, zone };
            toggleChromeTouch();
        }
    };

    // ── keyboard ────────────────────────────────────────────────────────────────
    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            const tag = (e.target as HTMLElement).tagName;
            if (e.key === "Escape") {
                if (help) return setHelp(false);
                if (panel) return setPanel(null);
                if (drawer) return setDrawer(false);
                if (document.fullscreenElement) return;
                leave();
                return;
            }
            if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA") return;
            if ((e.key === " " || e.key === "Enter") && tag === "BUTTON") return;
            if (e.ctrlKey || e.metaKey || e.altKey) return;
            showChrome();
            const v = videoRef.current;
            const k = e.key.toLowerCase();
            if (resumeAt !== null && (k === " " || k === "enter" || k === "k")) { e.preventDefault(); doResume(); return; }
            if (k === " " || k === "k") { e.preventDefault(); togglePlay(); }
            else if (k === "arrowright" || k === "l") { e.preventDefault(); seekTo((v?.currentTime ?? 0) + 10, "+10s"); }
            else if (k === "arrowleft" || k === "j") { e.preventDefault(); seekTo((v?.currentTime ?? 0) - 10, "−10s"); }
            else if (k === "arrowup") { e.preventDefault(); setVolume((v?.volume ?? 0) + 0.1); }
            else if (k === "arrowdown") { e.preventDefault(); setVolume((v?.volume ?? 0) - 0.1); }
            else if (k === "m") toggleMute();
            else if (k === "f") toggleFullscreen();
            else if (k === "a" && tracks.length > 1) {
                const i = tracks.findIndex((t) => t.active);
                selectAudio(tracks[(i + 1) % tracks.length]);
            }
            else if (k === "n") { if (next) goEp(next); else flash(isSeries ? "Last episode" : "No next episode"); }
            else if (k === "p" && prev) goEp(prev);
            else if (k === "e" && isSeries) setDrawer((d) => !d);
            else if (k === "?") setHelp((h) => !h);
            else if (k === "," || k === ".") {
                const i = SPEEDS.indexOf(v?.playbackRate ?? 1) + (k === "." ? 1 : -1);
                if (SPEEDS[i]) setSpeed(SPEEDS[i]);
            }
            else if (/^[0-9]$/.test(k)) seekTo((v?.duration || dur) * (+k / 10), `${k}0%`);
        };
        document.addEventListener("keydown", onKey);
        return () => document.removeEventListener("keydown", onKey);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [help, panel, drawer, resumeAt, tracks, next, prev, dur, togglePlay, seekTo, setVolume, toggleMute, toggleFullscreen, selectAudio, goEp, leave, setSpeed, showChrome, flash, isSeries]);

    // ── Media Session (hardware keys, lock screen) ──────────────────────────────
    useEffect(() => {
        if (!("mediaSession" in navigator)) return;
        const ms = navigator.mediaSession;
        const art = title.poster ?? title.backdrop;
        ms.metadata = new MediaMetadata({
            title: isSeries ? `${code(ep)} · ${ep.name}` : title.name,
            artist: isSeries ? title.name : title.year ? String(title.year) : "",
            album: "PersonalFlix",
            artwork: art ? [{ src: art, sizes: "500x750", type: "image/jpeg" }] : [],
        });
        const v = () => videoRef.current;
        const handlers: [MediaSessionAction, MediaSessionActionHandler | null][] = [
            ["play", () => v()?.play()],
            ["pause", () => v()?.pause()],
            ["seekbackward", (d) => seekTo((v()?.currentTime ?? 0) - (d.seekOffset ?? 10))],
            ["seekforward", (d) => seekTo((v()?.currentTime ?? 0) + (d.seekOffset ?? 10))],
            ["seekto", (d) => { if (d.seekTime !== undefined) seekTo(d.seekTime); }],
            ["previoustrack", prev ? () => goEp(prev) : null],
            ["nexttrack", next ? () => goEp(next) : null],
        ];
        for (const [a, h] of handlers) { try { ms.setActionHandler(a, h); } catch { /* unsupported action */ } }
        return () => { for (const [a] of handlers) { try { ms.setActionHandler(a, null); } catch { /* */ } } };
    }, [ep, goEp, isSeries, next, prev, seekTo, title]);

    useEffect(() => {
        if (!("mediaSession" in navigator) || !dur || !isFinite(dur)) return;
        try { navigator.mediaSession.setPositionState({ duration: dur, position: Math.min(time, dur), playbackRate: rate }); } catch { /* */ }
    }, [time, dur, rate]);

    // close the settings panel on any outside press
    const onWrapPointerDown = (e: React.PointerEvent) => {
        if (panel && !(e.target as HTMLElement).closest(".panel") && !(e.target as HTMLElement).closest("[data-gear]")) setPanel(null);
    };

    const sub = isSeries
        ? `${code(ep)} · ${ep.name}`
        : [title.year, ep.dur ? runtime(ep.dur) : ""].filter(Boolean).join(" · ");
    const drawerEps = title.eps.filter((e) => e.s === drawerSeason);

    return (
        <div
            ref={wrapRef}
            className={`player open${idle ? " idle" : ""}`}
            role="dialog"
            aria-modal="true"
            aria-label="Video player"
            onPointerMove={(e) => { if (e.pointerType === "mouse") showChrome(); }}
            onPointerDown={onWrapPointerDown}
        >
            <video
                ref={videoRef}
                className="screen"
                playsInline
                preload="auto"
                onPointerUp={(e) => (e.pointerType === "mouse" ? togglePlay() : toggleChromeTouch())}
                poster={title.backdrop ?? undefined}
            />
            <div className="tapzone l" onPointerUp={(e) => onZone("l", e)} />
            <div className="tapzone r" onPointerUp={(e) => onZone("r", e)} />
            {ripples.map((r) => (
                <div key={r.id} className="ripple" style={r.fwd ? { right: "12%" } : { left: "12%" }}>{r.fwd ? "+10" : "−10"}</div>
            ))}
            {phase === "ready" && buffering && !needsTap && <div className="p-buffer" aria-label="Buffering" />}
            {needsTap && resumeAt === null && (
                <button className="p-bigplay" aria-label="Play" onClick={() => videoRef.current?.play().catch(() => {})}>
                    <Icon name="play" />
                </button>
            )}

            <div className="p-chrome">
                <div className="p-top">
                    <button className="p-btn" aria-label="Back" onClick={() => leave()}><Icon name="back" /></button>
                    <div className="p-title"><b>{title.name}</b><span>{sub}</span></div>
                    <button className="p-btn p-hide-sm" aria-label="Keyboard shortcuts" onClick={() => setHelp((h) => !h)}><Icon name="kbd" /></button>
                </div>
                <div className="p-bottom">
                    <SeekBar
                        time={time}
                        dur={dur}
                        buf={buf}
                        onSeek={(t) => seekTo(t)}
                        onDrag={(d) => { seekDrag.current = d; if (d) showChrome(true); else showChrome(); }}
                    />
                    <div className="p-row">
                        <button className="p-btn p-play" aria-label={playing ? "Pause" : "Play"} onClick={togglePlay}>
                            <Icon name={playing ? "pause" : "play"} />
                        </button>
                        <button className="p-btn" aria-label="Back 10 seconds" onClick={() => seekTo(time - 10, "−10s")}>
                            <Icon name="rw" /><span className="num">10</span>
                        </button>
                        <button className="p-btn" aria-label="Forward 10 seconds" onClick={() => seekTo(time + 10, "+10s")}>
                            <Icon name="fw" /><span className="num">10</span>
                        </button>
                        <div className="vol p-hide-sm">
                            <button className="p-btn" aria-label={muted ? "Unmute" : "Mute"} onClick={toggleMute}>
                                <Icon name={muted || vol === 0 ? "mute" : "vol"} />
                            </button>
                            <input
                                type="range" min="0" max="1" step="0.05" aria-label="Volume"
                                value={muted ? 0 : vol}
                                onChange={(e) => setVolume(+e.target.value, false)}
                            />
                        </div>
                        <span className="p-time"><b>{fmt(time)}</b> / <span>{fmt(dur)}</span></span>
                        <span className="spacer" />
                        {isSeries && (
                            <>
                                <button className="p-btn" aria-label="Previous episode" disabled={!prev} onClick={() => goEp(prev)}><Icon name="prev" /></button>
                                <button className="p-btn" aria-label="Next episode" disabled={!next} onClick={() => goEp(next)}><Icon name="next" /></button>
                            </>
                        )}
                        {tracks.length > 1 && (
                            <button
                                className={`p-btn${panel === "audio" ? " on" : ""}`}
                                aria-label="Audio language"
                                data-gear
                                onClick={() => setPanel((p) => (p === "audio" ? null : "audio"))}
                            >
                                <Icon name="audio" />
                            </button>
                        )}
                        {isSeries && (
                            <button className="p-btn" aria-label="Episodes" onClick={() => { setDrawerSeason(ep.s); setDrawer(true); }}>
                                <Icon name="list" />
                            </button>
                        )}
                        <button
                            className={`p-btn${panel ? " on" : ""}`}
                            aria-label="Settings"
                            data-gear
                            onClick={() => setPanel((p) => (p ? null : "speed"))}
                        >
                            <Icon name="gear" />
                        </button>
                        {pipOk && <button className="p-btn p-hide-sm" aria-label="Picture in picture" onClick={togglePip}><Icon name="pip" /></button>}
                        <button className="p-btn" aria-label="Fullscreen" onClick={toggleFullscreen}><Icon name="full" /></button>
                    </div>
                </div>
            </div>

            <div className={`hud${hud ? " show" : ""}`} key={hud?.n ?? 0}>{hud?.text}</div>

            <div className={`panel${panel ? " show" : ""}`} role="dialog" aria-label="Playback settings">
                <div className="panel-tabs" role="tablist">
                    <button role="tab" aria-selected={panel === "speed"} onClick={() => setPanel("speed")}>Speed</button>
                    <button role="tab" aria-selected={panel === "audio"} onClick={() => setPanel("audio")}>Audio</button>
                </div>
                <div className="panel-list">
                    {panel === "speed" && SPEEDS.map((s) => (
                        <button key={s} className="opt" role="menuitemradio" aria-checked={rate === s} onClick={() => setSpeed(s)}>
                            {s === 1 ? "Normal" : `${s}×`}
                        </button>
                    ))}
                    {panel === "audio" && tracks.map((t) => (
                        <button key={t.id} className="opt" role="menuitemradio" aria-checked={t.active} onClick={() => selectAudio(t)}>
                            <span>{trackName(t)}<small>{trackDetail(t)}</small></span>
                        </button>
                    ))}
                </div>
                {panel === "audio" && tracks.length < 2 && <div className="panel-note">This title has one audio track.</div>}
            </div>

            <div className={`card-float resume-card${resumeAt !== null ? " show" : ""}`} role="alertdialog" aria-label="Resume playback">
                <div className="eyebrow">Welcome back</div>
                <h3>Resume from {fmt(resumeAt ?? 0)}?</h3>
                <p>{resumeAt !== null && dur ? `${left(resumeAt, dur)} · ` : ""}auto-resuming in {Math.ceil(resumeLeft)}s</p>
                <div className="btns">
                    <button className="btn btn-ghost" onClick={startOver}>Start over</button>
                    <button className="btn btn-primary btn-ring" style={{ ["--p" as string]: `${((6 - resumeLeft) / 6) * 100}%` }} onClick={doResume} autoFocus>
                        Resume
                    </button>
                </div>
            </div>

            {next && (
                <div className={`card-float upnext${upnext.shown && !upnext.cancelled ? " show" : ""}`} role="alertdialog" aria-label="Next episode">
                    <div className="un-thumb"><Art t={title} kind="backdrop" src={next.thumb} label={false} /></div>
                    <div className="un-t">
                        <small>Next episode</small>
                        <b>{code(next)} · {next.name}</b>
                        <div className="un-actions">
                            <button className="btn btn-primary btn-sm" onClick={() => goEp(next)}>
                                <svg className="cd-ring" viewBox="0 0 40 40" aria-hidden="true">
                                    <circle cx="20" cy="20" r="16" stroke="rgba(0,0,0,.2)" />
                                    <circle cx="20" cy="20" r="16" stroke="#000" strokeDasharray="100.5" strokeDashoffset={100.5 * (1 - ring)} transform="rotate(-90 20 20)" strokeLinecap="round" />
                                </svg>
                                Play now
                            </button>
                            <button className="btn btn-ghost btn-sm" onClick={() => setUpnext((u) => ({ ...u, cancelled: true }))}>Cancel</button>
                        </div>
                    </div>
                </div>
            )}

            {isSeries && (
                <aside className={`drawer${drawer ? " show" : ""}`} aria-label="Episodes">
                    <div className="drawer-head">
                        <h3>{title.name}</h3>
                        <button className="p-btn" aria-label="Close" onClick={() => setDrawer(false)}><Icon name="x" /></button>
                    </div>
                    {title.seasons.length > 1 && (
                        <div className="season-tabs" style={{ margin: "0 12px 8px" }}>
                            {title.seasons.map((s) => (
                                <button key={s} className="season-tab" role="tab" aria-selected={s === drawerSeason} onClick={() => setDrawerSeason(s)}>S{s}</button>
                            ))}
                        </div>
                    )}
                    <div className="drawer-list">
                        <EpisodeRows t={title} eps={drawerEps} currentId={ep.id} onPick={(x) => { setDrawer(false); if (x.id !== ep.id) goEp(x); }} />
                    </div>
                </aside>
            )}

            <div className={`help${help ? " show" : ""}`} onClick={() => setHelp(false)}>
                <div className="help-card">
                    <h3>Keyboard shortcuts</h3>
                    <div className="keys">
                        <div><span>Play / pause</span><span><kbd>Space</kbd> <kbd>K</kbd></span></div>
                        <div><span>Back / fwd 10s</span><span><kbd>J</kbd> <kbd>L</kbd> <kbd>←</kbd> <kbd>→</kbd></span></div>
                        <div><span>Volume</span><span><kbd>↑</kbd> <kbd>↓</kbd></span></div>
                        <div><span>Mute</span><span><kbd>M</kbd></span></div>
                        <div><span>Fullscreen</span><span><kbd>F</kbd></span></div>
                        <div><span>Next audio language</span><span><kbd>A</kbd></span></div>
                        <div><span>Next / previous episode</span><span><kbd>N</kbd> <kbd>P</kbd></span></div>
                        <div><span>Jump to 0–90%</span><span><kbd>0</kbd>…<kbd>9</kbd></span></div>
                        <div><span>Speed − / +</span><span><kbd>,</kbd> <kbd>.</kbd></span></div>
                        <div><span>Episodes</span><span><kbd>E</kbd></span></div>
                        <div><span>Close / back</span><span><kbd>Esc</kbd></span></div>
                    </div>
                </div>
            </div>

            <div className={`loading${phase === "ready" ? " hide" : ""}`}>
                <div className="stack">
                    {phase === "error" ? (
                        <>
                            <div className="ttl">Can&apos;t play this right now</div>
                            <div className="err">{error}</div>
                            <div className="btns">
                                <button className="btn btn-ghost" onClick={() => leave()}>Back to library</button>
                                <button className="btn btn-primary" onClick={() => window.location.reload()}>Try again</button>
                            </div>
                        </>
                    ) : (
                        <>
                            <div className="reel" />
                            <div className="ttl">{isSeries ? `${title.name} · ${code(ep)}` : title.name}</div>
                            <div className="step">{step}</div>
                        </>
                    )}
                </div>
            </div>
        </div>
    );
}

function trackName(t: AudioTrack) {
    return t.label || LANG_NAMES[t.language] || t.language || "Audio";
}

function trackDetail(t: AudioTrack) {
    const ch = t.channelsCount ? (t.channelsCount >= 6 ? "5.1" : t.channelsCount === 2 ? "Stereo" : `${t.channelsCount} ch`) : "";
    const lang = LANG_NAMES[t.language] && t.label && t.label !== LANG_NAMES[t.language] ? LANG_NAMES[t.language] : "";
    return [lang, ch].filter(Boolean).join(" · ");
}
