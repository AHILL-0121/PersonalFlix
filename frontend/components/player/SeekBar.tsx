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
    const [isTouching, setIsTouching] = useState(false);
    const isDragging = useRef(false);
    // Track the last committed time so we don't re-fire identical seeks
    const lastCommitRef = useRef<number>(-1);

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

    // ── Mouse handlers ────────────────────────────────────────────────────────
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
        const startT = getTimeFromClientX(e.clientX);
        onSeek(startT);

        const onMove = (ev: MouseEvent) => {
            const t = getTimeFromClientX(ev.clientX);
            onSeek(t);
            setHoverTime(t);
        };
        const onUp = (ev: MouseEvent) => {
            isDragging.current = false;
            setHoverTime(null);
            const t = getTimeFromClientX(ev.clientX);
            if (onSeekCommit) {
                onSeekCommit(t);
            } else {
                onSeek(t);
            }
            window.removeEventListener("mousemove", onMove);
            window.removeEventListener("mouseup", onUp);
        };
        window.addEventListener("mousemove", onMove);
        window.addEventListener("mouseup", onUp);
    }

    function handleClick(e: React.MouseEvent<HTMLDivElement>) {
        e.stopPropagation();
        if (isDragging.current) return; // handled in mouseup
        const t = getTimeFromClientX(e.clientX);
        onSeek(t);
        if (onSeekCommit) onSeekCommit(t);
    }

    // ── Touch handlers (mobile) ───────────────────────────────────────────────
    // Mobile Edge fires: touchstart → touchmove* → touchend
    // We must call onSeekCommit on touchend, otherwise the stream never restarts.
    function handleTouchStart(e: React.TouchEvent<HTMLDivElement>) {
        e.stopPropagation();
        setIsTouching(true);
        const t = getTimeFromClientX(e.touches[0].clientX);
        const el = trackRef.current;
        if (el) {
            const rect = el.getBoundingClientRect();
            setHoverX(e.touches[0].clientX - rect.left);
        }
        setHoverTime(t);
        onSeek(t); // optimistic preview update
    }

    function handleTouchMove(e: React.TouchEvent<HTMLDivElement>) {
        e.stopPropagation();
        const t = getTimeFromClientX(e.touches[0].clientX);
        const el = trackRef.current;
        if (el) {
            const rect = el.getBoundingClientRect();
            setHoverX(e.touches[0].clientX - rect.left);
        }
        setHoverTime(t);
        onSeek(t); // live scrub preview (doesn't restart stream, just updates UI)
    }

    function handleTouchEnd(e: React.TouchEvent<HTMLDivElement>) {
        e.stopPropagation();
        setIsTouching(false);
        setHoverTime(null);

        // Get the final touch position from changedTouches (touches is empty on end)
        const touch = e.changedTouches[0];
        if (!touch) return;
        const t = getTimeFromClientX(touch.clientX);

        // Guard: don't re-commit same position
        if (Math.abs(t - lastCommitRef.current) < 1) return;
        lastCommitRef.current = t;

        // THIS IS THE CRITICAL FIX: commit the seek → triggers stream restart
        if (onSeekCommit) {
            onSeekCommit(t);
        } else {
            onSeek(t);
        }
    }

    const playedPct = duration ? (currentTime / duration) * 100 : 0;
    const bufferedPct = duration ? (buffered / duration) * 100 : 0;
    const hoverPct = duration && hoverTime !== null ? (hoverTime / duration) * 100 : 0;
    // On mobile, always show the handle. On desktop, show on hover.
    const showHandle = isTouching || hoverTime !== null;

    return (
        <div
            className="relative w-full py-3 cursor-pointer"
            onClick={handleClick}
            // Expand touch area vertically so it's easy to hit on mobile
            style={{ touchAction: "none" }}
        >
            {/* Hover / touch time tooltip */}
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
                style={{ height: showHandle ? "6px" : "3px" }}
                onMouseMove={handleMouseMove}
                onMouseLeave={handleMouseLeave}
                onMouseDown={handleMouseDown}
                onTouchStart={handleTouchStart}
                onTouchMove={handleTouchMove}
                onTouchEnd={handleTouchEnd}
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

            {/* Scrub handle — always visible on mobile touch, hover-only on desktop */}
            <div
                className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 rounded-full shadow-lg pointer-events-none transition-opacity duration-150"
                style={{
                    left: `${playedPct}%`,
                    // Larger on mobile for easier grabbing
                    width: isTouching ? "18px" : "14px",
                    height: isTouching ? "18px" : "14px",
                    background: "#F0A500",
                    boxShadow: "0 0 8px #F0A50099",
                    opacity: showHandle ? 1 : 0,
                }}
            />
        </div>
    );
}
