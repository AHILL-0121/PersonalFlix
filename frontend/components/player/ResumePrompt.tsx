"use client";

import { useEffect, useRef, useState } from "react";
import { formatTime } from "@/lib/progress";

interface ResumePromptProps {
    positionSec: number;
    onResume(): void;
    onStartOver(): void;
}

const AUTO_RESUME_DELAY_MS = 6000;

export default function ResumePrompt({
    positionSec,
    onResume,
    onStartOver,
}: ResumePromptProps) {
    const [countdown, setCountdown] = useState(
        Math.ceil(AUTO_RESUME_DELAY_MS / 1000)
    );
    const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

    useEffect(() => {
        timerRef.current = setInterval(() => {
            setCountdown((c) => {
                if (c <= 1) {
                    clearInterval(timerRef.current!);
                    onResume();
                    return 0;
                }
                return c - 1;
            });
        }, 1000);

        return () => {
            if (timerRef.current) clearInterval(timerRef.current);
        };
    }, [onResume]);

    return (
        <div
            id="resume-prompt"
            className="absolute inset-0 flex items-center justify-center z-20 pointer-events-none"
        >
            <div className="glass rounded-2xl px-8 py-6 flex flex-col items-center gap-4 shadow-2xl animate-fade-in pointer-events-auto max-w-xs w-full mx-4">
                <p className="text-text-primary text-base font-medium text-center">
                    Resume from{" "}
                    <span className="text-accent font-semibold">{formatTime(positionSec)}</span>?
                </p>
                <p className="text-text-muted text-xs">
                    Auto-resuming in {countdown}s…
                </p>
                <div className="flex gap-3 w-full">
                    <button
                        id="btn-start-over"
                        onClick={onStartOver}
                        className="btn-ghost flex-1"
                    >
                        Start Over
                    </button>
                    <button
                        id="btn-resume"
                        onClick={onResume}
                        className="btn-accent flex-1"
                    >
                        Resume
                    </button>
                </div>
            </div>
        </div>
    );
}
