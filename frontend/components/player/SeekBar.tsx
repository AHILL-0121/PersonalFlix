"use client";

import { useRef, useCallback, useState } from "react";
import { formatTime } from "@/lib/progress";

interface SeekBarProps {
    currentTime: number;
    duration: number;
    buffered: number;
    onSeek(t: number): void;
    onSeekCommit?(t: number): void;
}

export default function SeekBar({ currentTime, duration, buffered, onSeek, onSeekCommit }: SeekBarProps) {
    const trackRef = useRef<HTMLDivElement>(null);
    const [hoverTime, setHoverTime] = useState<number | null>(null);
    const [hoverX, setHoverX] = useState(0);
    const isDragging = useRef(false);

    const getTimeFromClientX = useCallback(
        (clientX: number): number => {
            const el = trackRef.current;
            if (!el || !duration) return 0;
            const rect = el.getBoundingClientRect();
            const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
            return ratio * duration;
        },
        [duration]
    );

    function handleMouseMove(e: React.MouseEvent<HTMLDivElement>) {
        const t = getTimeFromClientX(e.clientX);
        const el = trackRef.current;
        if (!el) return;
        const rect = el.getBoundingClientRect();
        setHoverX(e.clientX - rect.left);
        setHoverTime(t);
        if (isDragging.current) {
            onSeek(t);
        }
    }

    function handleMouseLeave() {
        if (!isDragging.current) setHoverTime(null);
    }

    function handleMouseDown(e: React.MouseEvent<HTMLDivElement>) {
        e.stopPropagation();
        isDragging.current = true;
        onSeek(getTimeFromClientX(e.clientX));

        const onMove = (ev: MouseEvent) => {
            const t = getTimeFromClientX(ev.clientX);
            onSeek(t);
            setHoverTime(t);
        };
        const onUp = (ev: MouseEvent) => {
            isDragging.current = false;
            if (onSeekCommit) {
                onSeekCommit(getTimeFromClientX(ev.clientX));
            } else {
                onSeek(getTimeFromClientX(ev.clientX));
            }
            window.removeEventListener("mousemove", onMove);
            window.removeEventListener("mouseup", onUp);
        };
        window.addEventListener("mousemove", onMove);
        window.addEventListener("mouseup", onUp);
    }

    function handleTouchMove(e: React.TouchEvent<HTMLDivElement>) {
        e.stopPropagation();
        onSeek(getTimeFromClientX(e.touches[0].clientX));
    }

    function handleClick(e: React.MouseEvent<HTMLDivElement>) {
        e.stopPropagation();
        const t = getTimeFromClientX(e.clientX);
        onSeek(t);
        if (onSeekCommit) onSeekCommit(t);
    }

    const playedPct = duration ? (currentTime / duration) * 100 : 0;
    const bufferedPct = duration ? (buffered / duration) * 100 : 0;
    const hoverPct = duration && hoverTime !== null ? (hoverTime / duration) * 100 : 0;

    return (
        <div className="relative w-full group/seekbar py-2 cursor-pointer" onClick={handleClick}>
            {/* Hover time tooltip */}
            {hoverTime !== null && (
                <div
                    className="absolute -top-8 -translate-x-1/2 px-2 py-0.5 rounded bg-black/90 text-white text-xs font-mono pointer-events-none z-10 whitespace-nowrap"
                    style={{ left: hoverX }}
                >
                    {formatTime(hoverTime)}
                </div>
            )}

            {/* Track */}
            <div
                ref={trackRef}
                id="seek-bar"
                role="slider"
                aria-label="Seek"
                aria-valuemin={0}
                aria-valuemax={Math.floor(duration)}
                aria-valuenow={Math.floor(currentTime)}
                className="relative w-full rounded-full bg-white/15 overflow-hidden transition-all duration-150"
                style={{ height: hoverTime !== null ? "6px" : "3px" }}
                onMouseMove={handleMouseMove}
                onMouseLeave={handleMouseLeave}
                onMouseDown={handleMouseDown}
                onTouchMove={handleTouchMove}
            >
                {/* Hover preview tint */}
                {hoverTime !== null && (
                    <div
                        className="absolute inset-y-0 left-0 bg-white/10 pointer-events-none"
                        style={{ width: `${hoverPct}%` }}
                    />
                )}
                {/* Buffered */}
                <div
                    className="absolute inset-y-0 left-0 bg-white/25 rounded-full transition-[width] duration-200 pointer-events-none"
                    style={{ width: `${bufferedPct}%` }}
                />
                {/* Played — amber accent */}
                <div
                    className="absolute inset-y-0 left-0 rounded-full transition-[width] duration-100 pointer-events-none"
                    style={{ width: `${playedPct}%`, background: "#F0A500" }}
                />
            </div>

            {/* Scrub handle */}
            <div
                className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-3.5 h-3.5 rounded-full shadow-lg pointer-events-none
                           opacity-0 group-hover/seekbar:opacity-100 transition-opacity duration-150"
                style={{ left: `${playedPct}%`, background: "#F0A500", boxShadow: "0 0 6px #F0A50088" }}
            />
        </div>
    );
}
