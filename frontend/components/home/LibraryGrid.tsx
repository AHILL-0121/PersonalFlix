"use client";

import { useMemo, useState } from "react";
import Art from "@/components/ui/Art";
import Icon from "@/components/ui/Icon";
import { isNew, palette, runtime, titleProgress, type TitleLite } from "@/lib/ui";
import type { View } from "./Nav";

type Filter = "all" | "progress" | "unwatched" | "new";
type Sort = "recent" | "az" | "year" | "rating";

export default function LibraryGrid({
    titles,
    view,
    onOpen,
    onPlay,
}: {
    titles: TitleLite[];
    view: View;
    onOpen: (t: TitleLite) => void;
    onPlay: (t: TitleLite) => void;
}) {
    const [filter, setFilter] = useState<Filter>("all");
    const [sort, setSort] = useState<Sort>("recent");

    const list = useMemo(() => {
        let l = titles.filter((t) => view === "home" || t.type === view);
        if (filter === "progress") l = l.filter((t) => titleProgress(t) !== null);
        if (filter === "unwatched") l = l.filter((t) => titleProgress(t) === null);
        if (filter === "new") l = l.filter((t) => isNew(t));
        return [...l].sort((a, b) =>
            sort === "az" ? a.name.localeCompare(b.name)
                : sort === "year" ? (b.year ?? 0) - (a.year ?? 0)
                    : sort === "rating" ? (b.rating ?? 0) - (a.rating ?? 0)
                        : b.added - a.added || a.name.localeCompare(b.name));
    }, [titles, view, filter, sort]);

    const tilt = typeof window !== "undefined"
        && !matchMedia("(prefers-reduced-motion: reduce)").matches && !matchMedia("(hover: none)").matches;

    return (
        <section className="section">
            <div className="section-head">
                <h2>{view === "home" ? "Library" : view === "movie" ? "Movies" : "Series"}<span>{list.length}</span></h2>
                <div className="controls">
                    <div className="controls" role="group" aria-label="Filter">
                        {([["all", "All"], ["progress", "In progress"], ["unwatched", "Unwatched"], ["new", "New"]] as [Filter, string][]).map(([f, label]) => (
                            <button key={f} className="chip-btn" aria-pressed={filter === f} onClick={() => setFilter(f)}>{label}</button>
                        ))}
                    </div>
                    <select className="select" aria-label="Sort" value={sort} onChange={(e) => setSort(e.target.value as Sort)}>
                        <option value="recent">Recently added</option>
                        <option value="az">A → Z</option>
                        <option value="year">Year</option>
                        <option value="rating">Rating</option>
                    </select>
                </div>
            </div>

            {list.length ? (
                <div className="poster-grid">
                    {list.map((t, i) => {
                        const p = titleProgress(t);
                        const fresh = isNew(t);
                        return (
                            <button
                                key={t.id}
                                className="poster"
                                style={{ ["--i" as string]: Math.min(i, 40), ["--glow" as string]: palette(t.id).glow }}
                                aria-label={`${t.name}${t.year ? `, ${t.year}` : ""}`}
                                onClick={(e) => {
                                    if ((e.target as HTMLElement).closest("[data-play]")) onPlay(t);
                                    else onOpen(t);
                                }}
                                onPointerMove={tilt ? (e) => {
                                    const el = e.currentTarget, r = el.getBoundingClientRect();
                                    const x = (e.clientX - r.left) / r.width, y = (e.clientY - r.top) / r.height;
                                    el.style.setProperty("--ry", ((x - 0.5) * 14).toFixed(2) + "deg");
                                    el.style.setProperty("--rx", ((0.5 - y) * 14).toFixed(2) + "deg");
                                    el.style.setProperty("--gx", x * 100 + "%");
                                    el.style.setProperty("--gy", y * 100 + "%");
                                } : undefined}
                                onPointerLeave={tilt ? (e) => {
                                    e.currentTarget.style.setProperty("--rx", "0deg");
                                    e.currentTarget.style.setProperty("--ry", "0deg");
                                } : undefined}
                            >
                                <Art t={t} />
                                {fresh ? <span className="p-flag new">NEW</span>
                                    : t.type === "series" ? <span className="p-flag">{t.seasons.length}S</span> : null}
                                {p !== null && <div className="p-progress"><i style={{ width: `${(p * 100).toFixed(0)}%` }} /></div>}
                                <span className="glare" />
                                <div className="reveal">
                                    <div className="r-meta">
                                        {t.rating ? <span style={{ color: "#ffc861" }}>★ {t.rating.toFixed(1)}</span> : null}
                                        {t.year ? <span>{t.year}</span> : null}
                                        <span>{t.type === "movie" ? (t.eps[0]?.dur ? runtime(t.eps[0].dur) : "Film") : `${t.seasons.length} season${t.seasons.length > 1 ? "s" : ""}`}</span>
                                    </div>
                                    <div className="r-actions">
                                        <span className="r-play" data-play>
                                            <Icon name="play" style={{ width: 12, height: 12 }} />{p !== null && p < 1 ? "Resume" : "Play"}
                                        </span>
                                        <span className="r-info"><Icon name="info" style={{ width: 14, height: 14 }} /></span>
                                    </div>
                                </div>
                            </button>
                        );
                    })}
                </div>
            ) : (
                <div className="empty">
                    <Icon name="search" className="" />
                    <p>{titles.length ? "Nothing here with this filter." : "Your library is empty — run the convert notebook, then press Sync library."}</p>
                </div>
            )}
        </section>
    );
}
