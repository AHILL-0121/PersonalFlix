"use client";

import { useRef, useState } from "react";
import { fmt } from "@/lib/ui";

/** Seek bar: buffered range, hover time, drag to scrub (commits on release), ←/→ ±5 s. */
export default function SeekBar({
    time,
    dur,
    buf,
    onSeek,
    onDrag,
}: {
    time: number;
    dur: number;
    buf: number;
    onSeek: (t: number) => void;
    onDrag: (dragging: boolean) => void;
}) {
    const ref = useRef<HTMLDivElement>(null);
    const [drag, setDrag] = useState<number | null>(null);
    const [hover, setHover] = useState<{ x: number; t: number; px: number } | null>(null);

    const at = (clientX: number) => {
        const r = ref.current!.getBoundingClientRect();
        const x = Math.max(0, Math.min(1, (clientX - r.left) / r.width));
        return { x, t: x * dur, px: x * r.width, w: r.width };
    };

    const shown = drag ?? time;
    const pct = dur ? (shown / dur) * 100 : 0;
    const tipLeft = hover ? Math.max(40, Math.min((ref.current?.getBoundingClientRect().width ?? 0) - 40, hover.px)) : 0;

    return (
        <div
            ref={ref}
            className={`seek${drag !== null ? " drag" : ""}`}
            role="slider"
            tabIndex={0}
            aria-label="Seek"
            aria-valuemin={0}
            aria-valuemax={Math.floor(dur)}
            aria-valuenow={Math.floor(shown)}
            aria-valuetext={`${fmt(shown)} of ${fmt(dur)}`}
            onPointerMove={(e) => {
                const a = at(e.clientX);
                setHover(a);
                if (drag !== null) setDrag(a.t);
            }}
            onPointerLeave={() => { if (drag === null) setHover(null); }}
            onPointerDown={(e) => {
                if (!dur) return;
                ref.current!.setPointerCapture(e.pointerId);
                const a = at(e.clientX);
                setHover(a);
                setDrag(a.t);
                onDrag(true);
            }}
            onPointerUp={(e) => {
                if (drag === null) return;
                const t = at(e.clientX).t;
                setDrag(null);
                if (e.pointerType !== "mouse") setHover(null);
                onDrag(false);
                onSeek(t);
            }}
            onPointerCancel={() => { setDrag(null); setHover(null); onDrag(false); }}
            onKeyDown={(e) => {
                if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
                    e.preventDefault();
                    e.stopPropagation();
                    onSeek(time + (e.key === "ArrowRight" ? 5 : -5));
                }
            }}
        >
            <div className="seek-track">
                <div className="seek-buf" style={{ width: `${dur ? Math.min(100, (buf / dur) * 100) : 0}%` }} />
                <div className="seek-hover" style={{ width: `${hover ? hover.x * 100 : 0}%` }} />
                <div className="seek-fill" style={{ width: `${pct}%` }} />
                <div className="seek-knob" style={{ left: `${pct}%` }} />
            </div>
            <div className="seek-tip" style={{ left: tipLeft, opacity: hover || drag !== null ? undefined : 0 }}>
                <span>{fmt(drag ?? hover?.t ?? 0)}</span>
            </div>
        </div>
    );
}
