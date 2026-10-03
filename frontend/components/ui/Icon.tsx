import type { CSSProperties } from "react";

const S = { fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round" } as const;

const ICONS = {
    play: <path fill="currentColor" d="M7 4.5v15a1 1 0 0 0 1.5.86l12.5-7.5a1 1 0 0 0 0-1.72L8.5 3.64A1 1 0 0 0 7 4.5Z" />,
    pause: <path fill="currentColor" d="M6 4h4v16H6zM14 4h4v16h-4z" />,
    search: <g {...S}><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></g>,
    info: <g {...S}><circle cx="12" cy="12" r="9" /><path d="M12 11v5M12 8h.01" /></g>,
    x: <path {...S} d="M6 6l12 12M18 6 6 18" />,
    back: <path {...S} d="M15 18l-6-6 6-6" />,
    left: <path {...S} d="M15 18l-6-6 6-6" />,
    right: <path {...S} d="M9 6l6 6-6 6" />,
    rw: <path {...S} d="M3 12a9 9 0 1 0 3-6.7M3 4v5h5" />,
    fw: <path {...S} d="M21 12a9 9 0 1 1-3-6.7M21 4v5h-5" />,
    prev: <path fill="currentColor" d="M6 5h2v14H6zM20 5.5v13a.8.8 0 0 1-1.2.7L9.5 12.7a.8.8 0 0 1 0-1.4l9.3-6.5a.8.8 0 0 1 1.2.7Z" />,
    next: <path fill="currentColor" d="M16 5h2v14h-2zM4 5.5v13a.8.8 0 0 0 1.2.7l9.3-6.5a.8.8 0 0 0 0-1.4L5.2 4.8A.8.8 0 0 0 4 5.5Z" />,
    vol: <g {...S}><path d="M11 5 6 9H3v6h3l5 4V5Z" /><path d="M15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13" /></g>,
    mute: <g {...S}><path d="M11 5 6 9H3v6h3l5 4V5Z" /><path d="m22 9-6 6M16 9l6 6" /></g>,
    list: <path {...S} d="M4 6h16M4 12h16M4 18h10" />,
    gear: (
        <g fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z" />
        </g>
    ),
    pip: <g {...S}><rect x="2" y="4" width="20" height="16" rx="3" /><rect x="12" y="11" width="7" height="6" rx="1" fill="currentColor" /></g>,
    full: <path {...S} d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />,
    home: <path {...S} d="M3 11 12 3l9 8v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1v-9Z" />,
    film: <g {...S}><rect x="3" y="3" width="18" height="18" rx="2" /><path d="M7 3v18M17 3v18M3 8h4M3 16h4M17 8h4M17 16h4" /></g>,
    tv: <g {...S}><rect x="2" y="6" width="20" height="14" rx="2" /><path d="m8 2 4 4 4-4" /></g>,
    refresh: <path {...S} d="M21 12a9 9 0 1 1-2.6-6.4M21 3v6h-6" />,
    out: <path {...S} d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9" />,
    check: <path {...S} strokeWidth={2.5} d="m5 12 5 5 9-10" />,
    kbd: <g {...S}><rect x="2" y="6" width="20" height="12" rx="2" /><path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M7 14h10" /></g>,
    upload: <path {...S} d="M12 16V4M7 9l5-5 5 5M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3" />,
    folder: <path {...S} d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z" />,
    file: <g {...S}><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8l-5-5Z" /><path d="M14 3v5h5" /></g>,
    audio: <g {...S}><path d="M3 18v-6a9 9 0 0 1 18 0v6" /><path d="M21 19a2 2 0 0 1-2 2h-1v-6h3zM3 19a2 2 0 0 0 2 2h1v-6H3z" /></g>,
} as const;

export type IconName = keyof typeof ICONS;

export default function Icon({ name, className = "ic", style }: { name: IconName; className?: string; style?: CSSProperties }) {
    return (
        <svg viewBox="0 0 24 24" className={className} style={style} aria-hidden="true">
            {ICONS[name]}
        </svg>
    );
}
