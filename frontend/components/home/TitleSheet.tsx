"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import Art from "@/components/ui/Art";
import Icon from "@/components/ui/Icon";
import { code, left, runtime, type Ep, type TitleLite } from "@/lib/ui";
import EpisodeRows from "./EpisodeRows";

/** Bottom sheet with the title's details, smart Play/Resume button and season tabs. */
export default function TitleSheet({
    t,
    target,
    open,
    onClose,
    onPlay,
}: {
    t: TitleLite | null;
    target: Ep | null; // what Play/Resume starts
    open: boolean;
    onClose: () => void;
    onPlay: (ep: Ep, opts: { resume?: boolean; start?: boolean }) => void;
}) {
    const [season, setSeason] = useState<number | null>(null);
    const scrollRef = useRef<HTMLDivElement>(null);
    const sheetRef = useRef<HTMLElement>(null);
    const tabsRef = useRef<HTMLDivElement>(null);
    const inkRef = useRef<HTMLSpanElement>(null);
    const playRef = useRef<HTMLButtonElement>(null);

    useEffect(() => {
        if (!open || !t) return;
        setSeason(target?.s ?? t.seasons[0] ?? null);
        if (scrollRef.current) scrollRef.current.scrollTop = 0;
        const f = setTimeout(() => playRef.current?.focus(), 60);
        return () => clearTimeout(f);
    }, [open, t, target]);

    useLayoutEffect(() => {
        const act = tabsRef.current?.querySelector<HTMLElement>(".season-tab[aria-selected='true']");
        if (act && inkRef.current) {
            inkRef.current.style.left = act.offsetLeft + "px";
            inkRef.current.style.width = act.offsetWidth + "px";
        }
    }, [season, t]);

    // swipe down to dismiss on touch
    useEffect(() => {
        const sheet = sheetRef.current;
        if (!sheet) return;
        let y0: number | null = null;
        const start = (e: TouchEvent) => { if ((scrollRef.current?.scrollTop ?? 0) <= 0) y0 = e.touches[0].clientY; };
        const move = (e: TouchEvent) => {
            if (y0 === null) return;
            const dy = e.touches[0].clientY - y0;
            if (dy > 0) sheet.style.transform = `translate(-50%, ${dy}px)`;
        };
        const end = (e: TouchEvent) => {
            if (y0 === null) return;
            const dy = e.changedTouches[0].clientY - y0;
            y0 = null;
            sheet.style.transform = "";
            if (dy > 120) onClose();
        };
        sheet.addEventListener("touchstart", start, { passive: true });
        sheet.addEventListener("touchmove", move, { passive: true });
        sheet.addEventListener("touchend", end);
        return () => {
            sheet.removeEventListener("touchstart", start);
            sheet.removeEventListener("touchmove", move);
            sheet.removeEventListener("touchend", end);
        };
    }, [onClose]);

    const isSeries = t?.type === "series";
    const pos = target && target.pos > 3 && target.dur && target.pos < target.dur - 30 ? target.pos : 0;
    const cta = pos ? `Resume${isSeries && target ? " " + code(target) : ""}` : isSeries && target ? `Play ${code(target)}` : "Play";
    const eps = t && season !== null ? t.eps.filter((e) => e.s === season) : [];

    return (
        <section className={`sheet${open ? " open" : ""}`} role="dialog" aria-modal="true" aria-labelledby="sheetTitle" ref={sheetRef} aria-hidden={!open}>
            <div className="sheet-scroll" ref={scrollRef}>
                {t && (
                    <>
                        <div className="sheet-hero">
                            <div className="sheet-grab" />
                            <Art t={t} kind="backdrop" label={false} />
                            <button className="icon-btn sheet-close" aria-label="Close" onClick={onClose}><Icon name="x" /></button>
                        </div>
                        <div className="sheet-head">
                            <span className="eyebrow">{isSeries ? "Series" : "Film"}</span>
                            <h2 id="sheetTitle">{t.name}</h2>
                            <div className="meta">
                                {t.rating ? <span className="star">★ {t.rating.toFixed(1)}</span> : null}
                                {t.year ? <span>{t.year}</span> : null}
                                <span className="chip">
                                    {isSeries
                                        ? `${t.seasons.length} Season${t.seasons.length > 1 ? "s" : ""} · ${t.eps.length} eps`
                                        : t.eps[0]?.dur ? runtime(t.eps[0].dur) : "Film"}
                                </span>
                                {t.height ? <span className="chip">{t.height}p</span> : null}
                            </div>
                        </div>
                        <div className="sheet-body">
                            <div className="hero-actions">
                                {target && (
                                    <button className="btn btn-primary" ref={playRef} onClick={() => onPlay(target, { resume: !!pos })}>
                                        <Icon name="play" />{cta}
                                    </button>
                                )}
                                {pos > 0 && target && (
                                    <button className="btn btn-ghost" onClick={() => onPlay(target, { start: true })}>Start from beginning</button>
                                )}
                            </div>
                            {pos > 0 && target && (
                                <div className="resume-meta">
                                    <div className="track"><i style={{ width: `${((pos / target.dur) * 100).toFixed(1)}%` }} /></div>
                                    {left(pos, target.dur)}
                                </div>
                            )}
                            {t.overview && <p className="overview">{t.overview}</p>}
                            {isSeries && (
                                <>
                                    <div className="season-tabs" role="tablist" ref={tabsRef}>
                                        {t.seasons.map((s) => (
                                            <button key={s} className="season-tab" role="tab" aria-selected={s === season} onClick={() => setSeason(s)}>
                                                Season {s}
                                            </button>
                                        ))}
                                        <span className="season-ink" ref={inkRef} />
                                    </div>
                                    <div role="tabpanel">
                                        <EpisodeRows t={t} eps={eps} currentId={target?.id} onPick={(ep) => onPlay(ep, {})} />
                                    </div>
                                </>
                            )}
                        </div>
                    </>
                )}
            </div>
        </section>
    );
}
