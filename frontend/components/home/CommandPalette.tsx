"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Art from "@/components/ui/Art";
import { code, isNew, left, type Ep, type TitleLite, type UpNextItem } from "@/lib/ui";

type Hit = { kind: "title" | "ep"; t: TitleLite; ep?: Ep; label: string; sub: string; hi: [number, number][]; score: number };

function fuzzy(q: string, s: string): { score: number; hi: [number, number][] } | null {
    q = q.toLowerCase();
    const l = s.toLowerCase();
    const idx = l.indexOf(q);
    if (idx >= 0) return { score: 100 - idx, hi: [[idx, idx + q.length]] };
    let qi = 0, score = 0, last = -2;
    const hi: [number, number][] = [];
    for (let i = 0; i < l.length && qi < q.length; i++) {
        if (l[i] === q[qi]) {
            score += i === last + 1 ? 5 : 1;
            if (i === last + 1 && hi.length) hi[hi.length - 1][1] = i + 1;
            else hi.push([i, i + 1]);
            last = i;
            qi++;
        }
    }
    return qi === q.length ? { score, hi } : null;
}

function Marked({ s, hi }: { s: string; hi: [number, number][] }) {
    const out: React.ReactNode[] = [];
    let p = 0;
    hi.forEach(([a, b], i) => {
        out.push(s.slice(p, a), <mark key={i}>{s.slice(a, b)}</mark>);
        p = b;
    });
    out.push(s.slice(p));
    return <>{out}</>;
}

/** Ctrl K search across titles and episodes. Enter opens, Shift+Enter plays. */
export default function CommandPalette({
    open,
    titles,
    upNext,
    onClose,
    onOpenTitle,
    onPlayTitle,
    onPlayEp,
}: {
    open: boolean;
    titles: TitleLite[];
    upNext: UpNextItem[];
    onClose: () => void;
    onOpenTitle: (t: TitleLite) => void;
    onPlayTitle: (t: TitleLite) => void;
    onPlayEp: (t: TitleLite, ep: Ep) => void;
}) {
    const [q, setQ] = useState("");
    const [sel, setSel] = useState(0);
    const inputRef = useRef<HTMLInputElement>(null);
    const listRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (!open) return;
        setQ("");
        setSel(0);
        const f = setTimeout(() => inputRef.current?.focus(), 30);
        return () => clearTimeout(f);
    }, [open]);

    const groups = useMemo((): [string, Hit[]][] => {
        const query = q.trim();
        if (!query) {
            const up: Hit[] = upNext.slice(0, 4).map((u) => ({
                kind: "ep", t: u.t, ep: u.ep, label: u.t.name, hi: [], score: 0,
                sub: `${u.kicker} · ${u.t.type === "series" ? code(u.ep) : u.pos && u.ep.dur ? left(u.pos, u.ep.dur) : "Film"}`,
            }));
            const fresh: Hit[] = titles.filter((t) => isNew(t)).sort((a, b) => b.added - a.added).slice(0, 6)
                .map((t) => ({ kind: "title", t, label: t.name, sub: `New${t.year ? ` · ${t.year}` : ""}`, hi: [], score: 0 }));
            return [["Jump back in", up], ["Recently added", fresh]];
        }
        const ts: Hit[] = [], es: Hit[] = [];
        for (const t of titles) {
            const m = fuzzy(query, t.name) || (t.year && String(t.year).startsWith(query) ? { score: 50, hi: [] } : null);
            if (m) ts.push({
                kind: "title", t, label: t.name, hi: m.hi, score: m.score,
                sub: [t.type === "movie" ? "Film" : "Series", t.year, t.rating ? `★ ${t.rating.toFixed(1)}` : ""].filter(Boolean).join(" · "),
            });
            if (t.type === "series" && query.length > 1) {
                for (const ep of t.eps) {
                    const byName = fuzzy(query, ep.name);
                    const m2 = byName || fuzzy(query.replace(/\s+/g, ""), `s${ep.s}e${ep.e}`) || fuzzy(query, `s${String(ep.s).padStart(2, "0")}e${String(ep.e).padStart(2, "0")}`);
                    if (m2) es.push({ kind: "ep", t, ep, label: ep.name, sub: `${t.name} · ${code(ep)}`, hi: byName?.hi ?? [], score: m2.score - 10 });
                }
            }
        }
        ts.sort((a, b) => b.score - a.score);
        es.sort((a, b) => b.score - a.score);
        return [["Titles", ts.slice(0, 6)], ["Episodes", es.slice(0, 6)]];
    }, [q, titles, upNext]);

    const nonEmpty = groups.filter((g) => g[1].length);
    const flat = nonEmpty.flatMap((g) => g[1]);
    const cur = Math.min(sel, Math.max(0, flat.length - 1));

    const choose = (h: Hit | undefined, play: boolean) => {
        if (!h) return;
        onClose();
        if (h.kind === "ep" && h.ep) onPlayEp(h.t, h.ep);
        else if (play) onPlayTitle(h.t);
        else onOpenTitle(h.t);
    };

    useEffect(() => {
        listRef.current?.querySelector(".res[aria-selected='true']")?.scrollIntoView({ block: "nearest" });
    }, [cur]);

    let k = 0;
    return (
        <div className={`palette${open ? " open" : ""}`} role="dialog" aria-modal="true" aria-label="Search" aria-hidden={!open}>
            <div className="palette-in">
                <svg viewBox="0 0 24 24" className="ic" style={{ color: "var(--text-3)" }} aria-hidden="true">
                    <g fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></g>
                </svg>
                <input
                    ref={inputRef}
                    value={q}
                    placeholder="Search titles, episodes, years…"
                    autoComplete="off"
                    aria-controls="presults"
                    onChange={(e) => { setQ(e.target.value); setSel(0); }}
                    onKeyDown={(e) => {
                        if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                            e.preventDefault();
                            if (flat.length) setSel((cur + (e.key === "ArrowDown" ? 1 : -1) + flat.length) % flat.length);
                        }
                        if (e.key === "Enter") { e.preventDefault(); choose(flat[cur], e.shiftKey); }
                    }}
                />
                <kbd>Esc</kbd>
            </div>
            <div className="results" id="presults" role="listbox" ref={listRef}>
                {nonEmpty.length ? nonEmpty.map(([h, arr]) => (
                    <div key={h}>
                        <div className="res-h">{h}</div>
                        {arr.map((it) => {
                            const i = k++;
                            return (
                                <button
                                    key={`${it.kind}-${it.ep?.id ?? it.t.id}`}
                                    className="res"
                                    role="option"
                                    aria-selected={i === cur}
                                    onMouseEnter={() => setSel(i)}
                                    onClick={() => choose(it, false)}
                                >
                                    <span className={`mini${it.kind === "ep" ? " wide" : ""}`}>
                                        <Art t={it.t} kind={it.kind === "ep" ? "backdrop" : "poster"} src={it.ep?.thumb} label={false} />
                                    </span>
                                    <span className="rt"><b><Marked s={it.label} hi={it.hi} /></b><span>{it.sub}</span></span>
                                    <span className="go">{it.kind === "ep" ? "Play ↵" : "Open ↵"}</span>
                                </button>
                            );
                        })}
                    </div>
                )) : (
                    <div className="empty">
                        <p>{q.trim() ? <>No matches for “{q}”.<br /><span style={{ fontSize: 12 }}>Try a year, or S2E4.</span></> : "Start typing to search your library."}</p>
                    </div>
                )}
            </div>
            <div className="palette-foot">
                <span><kbd>↑</kbd> <kbd>↓</kbd> navigate</span><span><kbd>Enter</kbd> open</span><span><kbd>Shift</kbd>+<kbd>Enter</kbd> play</span>
            </div>
        </div>
    );
}
