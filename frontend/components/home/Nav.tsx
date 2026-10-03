"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useClerk } from "@clerk/nextjs";
import Icon from "@/components/ui/Icon";
import { useToast } from "@/components/ui/Toasts";

export type View = "home" | "movie" | "series";

export interface SyncInfo {
    syncedAt: number | null;
    libraryUpdatedAt: string | null;
    episodes: number;
    titles: number;
}

const ago = (ms: number | null) => {
    if (!ms) return "never";
    const m = Math.round((Date.now() - ms) / 60000);
    if (m < 1) return "just now";
    if (m < 60) return `${m}m ago`;
    const h = Math.round(m / 60);
    return h < 48 ? `${h}h ago` : `${Math.round(h / 24)}d ago`;
};

export default function Nav({
    view,
    setView,
    onSearch,
    sync,
}: {
    view: View;
    setView: (v: View) => void;
    onSearch: () => void;
    sync: SyncInfo;
}) {
    const router = useRouter();
    const toast = useToast();
    const { signOut } = useClerk();
    const [scrolled, setScrolled] = useState(false);
    const [popOpen, setPopOpen] = useState(false);
    const [busy, setBusy] = useState(false);
    const [err, setErr] = useState<string | null>(null);
    const [, tick] = useState(0);
    const tabsRef = useRef<HTMLElement>(null);
    const pillRef = useRef<HTMLSpanElement>(null);
    const popRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const onScroll = () => setScrolled(window.scrollY > 20);
        onScroll();
        window.addEventListener("scroll", onScroll, { passive: true });
        const t = setInterval(() => tick((n) => n + 1), 60000); // keep "12m ago" honest
        return () => { window.removeEventListener("scroll", onScroll); clearInterval(t); };
    }, []);

    // sliding pill under the selected tab
    useLayoutEffect(() => {
        const move = () => {
            const act = tabsRef.current?.querySelector<HTMLElement>(".tab[aria-selected='true']");
            if (!act || !pillRef.current) return;
            pillRef.current.style.left = act.offsetLeft + "px";
            pillRef.current.style.width = act.offsetWidth + "px";
        };
        move();
        document.fonts?.ready.then(move);
        window.addEventListener("resize", move);
        return () => window.removeEventListener("resize", move);
    }, [view]);

    useEffect(() => {
        if (!popOpen) return;
        const close = (e: MouseEvent) => { if (!popRef.current?.contains(e.target as Node)) setPopOpen(false); };
        document.addEventListener("click", close);
        return () => document.removeEventListener("click", close);
    }, [popOpen]);

    async function rescan() {
        setPopOpen(false);
        setBusy(true);
        setErr(null);
        try {
            const res = await fetch("/api/library/refresh", { method: "POST" });
            const d = await res.json();
            if (!res.ok) throw new Error(d.error || `HTTP ${res.status}`);
            const bits = [`${d.changed} updated`, d.newTitles ? `${d.newTitles} new titles` : "", d.prunedEpisodes ? `${d.prunedEpisodes} removed` : ""];
            toast(`Library synced · ${bits.filter(Boolean).join(", ")}`, true);
            if (d.errors?.length) setErr(`${d.errors.length} title(s) failed: ${d.errors[0]}`);
            router.refresh();
        } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            setErr(msg);
            toast(`Sync failed — ${msg.slice(0, 80)}`);
        } finally {
            setBusy(false);
        }
    }

    const tabs: [View, string][] = [["home", "Home"], ["movie", "Movies"], ["series", "Series"]];

    return (
        <>
            <header className={`nav${scrolled ? " scrolled" : ""}`}>
                <div className="logo" aria-label="PersonalFlix">Personal<i>Flix</i></div>
                <nav className="tabs" role="tablist" aria-label="Library" ref={tabsRef}>
                    <span className="tab-pill" ref={pillRef} />
                    {tabs.map(([v, label]) => (
                        <button key={v} className="tab" role="tab" aria-selected={view === v} onClick={() => setView(v)}>{label}</button>
                    ))}
                </nav>
                <div className="nav-spacer" />
                <button className="search-trigger" onClick={onSearch} aria-label="Search library">
                    <Icon name="search" /><span>Search titles, episodes…</span><kbd>Ctrl K</kbd>
                </button>
                <div style={{ position: "relative" }} ref={popRef}>
                    <button
                        className={`sync${busy ? " busy" : ""}`}
                        aria-haspopup="dialog"
                        aria-expanded={popOpen}
                        onClick={(e) => { e.stopPropagation(); setPopOpen((o) => !o); }}
                    >
                        <span className="dot" />
                        <span className="sync-label" suppressHydrationWarning>{busy ? "Syncing library…" : `Synced ${ago(sync.syncedAt)}`}</span>
                    </button>
                    <div className={`popover${popOpen ? " open" : ""}`} role="dialog" aria-label="Library status">
                        <div className="pop-h" style={{ marginTop: 0 }}>Google Drive · STREAM/library.json</div>
                        <div className="pop-row">Last sync <b suppressHydrationWarning>{ago(sync.syncedAt)}</b></div>
                        <div className="pop-row">Library <b>{sync.titles} titles · {sync.episodes} files</b></div>
                        {sync.libraryUpdatedAt && (
                            <div className="pop-row">Last conversion <b suppressHydrationWarning>{ago(Date.parse(sync.libraryUpdatedAt))}</b></div>
                        )}
                        <div className="pop-h">Artwork</div>
                        <div className="pop-row">Wrong poster or title? <Link className="pop-link" href="/tmdb-config">Fix TMDB matches</Link></div>
                        {err && <div className="pop-err">{err}</div>}
                        <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
                            <button className="btn btn-ghost btn-sm" style={{ flex: 1 }} onClick={rescan} disabled={busy}>
                                <Icon name="refresh" />Sync library
                            </button>
                        </div>
                    </div>
                </div>
                <Link className="icon-btn" href="/upload" aria-label="Upload to library" title="Upload">
                    <Icon name="upload" />
                </Link>
                <button className="icon-btn" aria-label="Keyboard shortcuts" onClick={() => toast("Ctrl K or / to search · in the player press ? for all shortcuts")}>
                    <Icon name="kbd" />
                </button>
                <button className="icon-btn" aria-label="Sign out" onClick={() => signOut({ redirectUrl: "/sign-in" })}>
                    <Icon name="out" />
                </button>
            </header>

            <nav className="tabbar" aria-label="Primary">
                <button aria-selected={view === "home"} onClick={() => setView("home")}><Icon name="home" />Home</button>
                <button aria-selected={false} onClick={onSearch}><Icon name="search" />Search</button>
                <button aria-selected={view === "movie"} onClick={() => setView("movie")}><Icon name="film" />Movies</button>
                <button aria-selected={view === "series"} onClick={() => setView("series")}><Icon name="tv" />Series</button>
                <button aria-selected={false} onClick={() => router.push("/upload")}><Icon name="upload" />Upload</button>
            </nav>
        </>
    );
}
