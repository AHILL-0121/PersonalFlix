"use client";

import { useRef, useCallback } from "react";

interface SeekBarProps {
    currentTime: number;
    duration: number;
    buffered: number;
    onSeek(t: number): void;
}

export default function SeekBar({
    currentTime,
    duration,
    buffered,
    onSeek,
}: SeekBarProps) {
    const trackRef = useRef<HTMLDivElement>(null);

    const getTimeFromEvent = useCallback(
        (clientX: number): number => {
            const el = trackRef.current;
            if (!el || !duration) return 0;
            const rect = el.getBoundingClientRect();
            const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
            return ratio * duration;
        },
        [duration]
    );

    function handleClick(e: React.MouseEvent<HTMLDivElement>) {
        e.stopPropagation();
        onSeek(getTimeFromEvent(e.clientX));
    }

    function handleMouseDown(e: React.MouseEvent<HTMLDivElement>) {
        e.stopPropagation();
        const onMove = (ev: MouseEvent) => onSeek(getTimeFromEvent(ev.clientX));
        const onUp = () => {
            window.removeEventListener("mousemove", onMove);
            window.removeEventListener("mouseup", onUp);
        };
        window.addEventListener("mousemove", onMove);
        window.addEventListener("mouseup", onUp);
    }

    function handleTouchMove(e: React.TouchEvent<HTMLDivElement>) {
        e.stopPropagation();
        onSeek(getTimeFromEvent(e.touches[0].clientX));
    }

    const playedPct = duration ? (currentTime / duration) * 100 : 0;
    const bufferedPct = duration ? (buffered / duration) * 100 : 0;

    return (
        <div
            ref={trackRef}
            id="seek-bar"
            className="seek-track group cursor-pointer"
            role="slider"
            aria-label="Seek"
            aria-valuemin={0}
            aria-valuemax={Math.floor(duration)}
            aria-valuenow={Math.floor(currentTime)}
            onClick={handleClick}
            onMouseDown={handleMouseDown}
            onTouchMove={handleTouchMove}
        >
            {/* Buffered fill */}
            <div
                className="absolute inset-y-0 left-0 bg-white/20 rounded-full transition-[width] duration-100"
                style={{ width: `${bufferedPct}%` }}
            />
            {/* Played fill */}
            <div
                className="absolute inset-y-0 left-0 bg-accent rounded-full transition-[width] duration-100"
                style={{ width: `${playedPct}%` }}
            />
            {/* Scrub handle — visible on hover */}
            <div
                className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-3 h-3 rounded-full bg-white shadow
                   opacity-0 group-hover:opacity-100 transition-opacity duration-150 pointer-events-none"
                style={{ left: `${playedPct}%` }}
            />
        </div>
    );
}
