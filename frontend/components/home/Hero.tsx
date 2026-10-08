"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Art from "@/components/ui/Art";
import Icon from "@/components/ui/Icon";
import { code, left, palette, regrade, runtime, type Ep, type TitleLite } from "@/lib/ui";

export interface HeroItem {
    t: TitleLite;
    ep: Ep;
    pos: number;
    kicker: string;
}

const AUTO_MS = 8000;

/** Filmstrip hero: the focused frame unfurls, the backdrop cross-fades and the page re-grades to it. */
export default function Hero({
    items,
    active,
    onPlay,
    onInfo,
}: {
    items: HeroItem[];
    active: boolean; // false while a sheet/palette is open or another tab is shown
    onPlay: (it: HeroItem) => void;
    onInfo: (t: TitleLite) => void;
}) {
    const [idx, setIdx] = useState(0);
    const [layers, setLayers] = useState<{ key: number; i: number; on: boolean }[]>([]);
    const stripRef = useRef<HTMLDivElement>(null);
    const lineRef = useRef<HTMLElement>(null);
    const autoT = useRef(0);
    const paused = useRef(false);
    const dragged = useRef(false);
    const layerKey = useRef(0);
    const reduced = useRef(false);

    const focus = useCallback((i: number, scroll = true) => {
        if (!items.length) return;
        const n = (i + items.length) % items.length;
        autoT.current = 0;
        setIdx(n);
        if (scroll && stripRef.current) {
            const f = stripRef.current.children[n] as HTMLElement | undefined;
            if (f) stripRef.current.scrollTo({ left: Math.max(0, f.offsetLeft - 8), behavior: reduced.current ? "auto" : "smooth" });
        }
    }, [items.length]);

    useEffect(() => {
        if (active && items[idx]) regrade(items[idx].t.id);
    }, [idx, items, active]);

    // backdrop cross-fade whenever the focused frame changes
    useEffect(() => {
        if (!items[idx]) return;
        const key = ++layerKey.current;
        setLayers((ls) => [...ls.map((l) => ({ ...l, on: false })), { key, i: idx, on: false }]);
        const r = requestAnimationFrame(() => requestAnimationFrame(() =>
            setLayers((ls) => ls.map((l) => (l.key === key ? { ...l, on: true } : l)))));
        const t = setTimeout(() => setLayers((ls) => ls.filter((l) => l.key >= key)), 1100);
        return () => { cancelAnimationFrame(r); clearTimeout(t); };
    }, [idx, items]);

    // auto-advance with a visible progress line; pauses on hover/focus and while hidden
    useEffect(() => {
        reduced.current = matchMedia("(prefers-reduced-motion: reduce)").matches;
        let last = 0, raf = 0;
        const loop = (ts: number) => {
            const dt = last ? ts - last : 0;
            last = ts;
            if (active && !paused.current && !reduced.current && !document.hidden && items.length > 1) {
                autoT.current += dt;
                if (autoT.current >= AUTO_MS) focus(idx + 1);
            }
            if (lineRef.current) lineRef.current.style.width = Math.min(100, (autoT.current / AUTO_MS) * 100) + "%";
            raf = requestAnimationFrame(loop);
        };
        raf = requestAnimationFrame(loop);
        return () => cancelAnimationFrame(raf);
    }, [active, focus, idx, items.length]);

    // wheel steps one frame; mouse drag scrolls the strip
    useEffect(() => {
        const strip = stripRef.current;
        if (!strip) return;
        let lock = 0;
        const onWheel = (e: WheelEvent) => {
            const d = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
            if (Math.abs(d) < 12) return;
            e.preventDefault();
            const now = Date.now();
            if (now - lock < 380) return;
            lock = now;
            focus(idx + (d > 0 ? 1 : -1));
        };
        let down: { x: number; sl: number } | null = null;
        const onDown = (e: PointerEvent) => {
            if (e.pointerType !== "mouse") return;
            down = { x: e.clientX, sl: strip.scrollLeft };
            dragged.current = false;
        };
        const onMove = (e: PointerEvent) => {
            if (!down) return;
            const dx = e.clientX - down.x;
            if (Math.abs(dx) > 5) {
                dragged.current = true;
                strip.classList.add("dragging");
                strip.scrollLeft = down.sl - dx;
            }
        };
        const onUp = () => {
            down = null;
            strip.classList.remove("dragging");
            setTimeout(() => (dragged.current = false), 0);
        };
        strip.addEventListener("wheel", onWheel, { passive: false });
        strip.addEventListener("pointerdown", onDown);
        window.addEventListener("pointermove", onMove);
        window.addEventListener("pointerup", onUp);
        return () => {
            strip.removeEventListener("wheel", onWheel);
            strip.removeEventListener("pointerdown", onDown);
            window.removeEventListener("pointermove", onMove);
            window.removeEventListener("pointerup", onUp);
        };
    }, [focus, idx]);

    if (!items.length) return null;
    const it = items[Math.min(idx, items.length - 1)];
    const t = it.t;
    const isSeries = t.type === "series";
    const cta = it.pos ? `Resume${isSeries ? " " + code(it.ep) : ""}` : isSeries ? `Play ${code(it.ep)}` : "Play";
    const words = t.name.split(" ");

    return (
        <section
            className="hero"
            aria-roledescription="carousel"
            aria-label="Continue watching"
            onPointerEnter={() => (paused.current = true)}
            onPointerLeave={() => (paused.current = false)}
            onFocus={() => (paused.current = true)}
            onBlur={() => (paused.current = false)}
        >
            <div className="hero-bg" aria-hidden="true">
                {layers.map((l) => items[l.i] && (
                    <div key={l.key} className={`layer${l.on ? " on" : ""}`}>
                        <Art t={items[l.i].t} kind="backdrop" label={false} />
                    </div>
                ))}
            </div>

            <div className="hero-copy" aria-live="polite">
                <div className="swap" key={t.id + it.ep.id}>
                    <span className="eyebrow">{it.kicker}</span>
                    <h1>{words.length > 1 ? <><em>{words[0]}</em> {words.slice(1).join(" ")}</> : t.name}</h1>
                    <div className="meta">
                        {t.rating ? <span className="star">★ {t.rating.toFixed(1)}</span> : null}
                        {t.year ? <span>{t.year}</span> : null}
                        <span className="chip">
                            {isSeries ? `${t.seasons.length} Season${t.seasons.length > 1 ? "s" : ""}` : it.ep.dur ? runtime(it.ep.dur) : "Film"}
                        </span>
                        {isSeries && <span>{code(it.ep)} · {it.ep.name}</span>}
                    </div>
                    <p className="overview">{t.overview}</p>
                    <div className="hero-actions">
                        <button className="btn btn-primary" onClick={() => onPlay(it)}><Icon name="play" />{cta}</button>
                        <button className="btn btn-ghost" onClick={() => onInfo(t)}><Icon name="info" />Details</button>
                    </div>
                    {it.pos > 0 && it.ep.dur > 0 && (
                        <div className="resume-meta">
                            <div className="track"><i style={{ width: `${((it.pos / it.ep.dur) * 100).toFixed(1)}%` }} /></div>
                            {left(it.pos, it.ep.dur)}
                        </div>
                    )}
                </div>
            </div>

            <div className="strip-wrap">
                <div className="strip-head">
                    <span className="label">{items.some((x) => x.pos) ? "Pick up where you left off" : "From your library"}</span>
                    <div className="strip-nav">
                        <button className="icon-btn" aria-label="Previous" onClick={() => focus(idx - 1)}><Icon name="left" /></button>
                        <button className="icon-btn" aria-label="Next" onClick={() => focus(idx + 1)}><Icon name="right" /></button>
                    </div>
                </div>
                <div
                    className="strip"
                    ref={stripRef}
                    tabIndex={0}
                    aria-label="Filmstrip — use arrow keys"
                    onKeyDown={(e) => {
                        if (e.key === "ArrowRight") { e.preventDefault(); focus(idx + 1); }
                        if (e.key === "ArrowLeft") { e.preventDefault(); focus(idx - 1); }
                        if (e.key === "Enter") onPlay(it);
                    }}
                >
                    {items.map((x, i) => (
                        <button
                            key={x.t.id}
                            className={`frame${i === idx ? " active" : ""}`}
                            aria-current={i === idx}
                            style={{ ["--glow" as string]: palette(x.t.id).glow }}
                            aria-label={x.t.name}
                            onClick={() => {
                                if (dragged.current) return;
                                if (i === idx) onPlay(x);
                                else focus(i);
                            }}
                        >
                            <Art t={x.t} />
                            <div className="cap">
                                <b>{x.t.type === "series" ? `${code(x.ep)} · ${x.ep.name}` : x.t.name}</b>
                                {x.pos && x.ep.dur ? (
                                    <div className="bar"><i style={{ width: `${((x.pos / x.ep.dur) * 100).toFixed(1)}%` }} /></div>
                                ) : (
                                    <span>{x.kicker}</span>
                                )}
                            </div>
                        </button>
                    ))}
                </div>
                <div className="autoplay-line"><i ref={lineRef} /></div>
            </div>
        </section>
    );
}
