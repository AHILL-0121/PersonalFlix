"use client";

import Art from "@/components/ui/Art";
import Icon from "@/components/ui/Icon";
import { code, left, runtime, type UpNextItem } from "@/lib/ui";

export default function UpNextRow({
    items,
    onPlay,
    onRemove,
}: {
    items: UpNextItem[];
    onPlay: (it: UpNextItem) => void;
    onRemove: (it: UpNextItem) => void;
}) {
    if (!items.length) return null;
    return (
        <section className="section">
            <div className="section-head"><h2>Up Next<span>{items.length}</span></h2></div>
            <div className="row">
                {items.map((it) => (
                    <div
                        key={it.t.id}
                        className="next-card"
                        role="button"
                        tabIndex={0}
                        aria-label={`${it.kicker} ${it.t.name}`}
                        onClick={() => onPlay(it)}
                        onKeyDown={(e) => { if (e.key === "Enter") onPlay(it); }}
                    >
                        <div style={{ position: "absolute", inset: 0 }}>
                            <Art t={it.t} kind="backdrop" src={it.ep.thumb} label={false} />
                        </div>
                        {it.kicker === "Up next" && <span className="badge-new">UP NEXT</span>}
                        <button
                            className="x"
                            aria-label="Remove from Up Next"
                            onClick={(e) => { e.stopPropagation(); onRemove(it); }}
                        >
                            <Icon name="x" style={{ width: 14, height: 14 }} />
                        </button>
                        <div className="shade" />
                        <div className="play-orb"><Icon name="play" style={{ width: 20, height: 20 }} /></div>
                        <div className="info">
                            <div className="kicker">{it.t.name}</div>
                            <div className="t">{it.t.type === "series" ? `${code(it.ep)} · ${it.ep.name}` : it.t.name}</div>
                            <div className="sub">
                                {it.pos && it.ep.dur ? (
                                    <>
                                        <div className="bar"><i style={{ width: `${((it.pos / it.ep.dur) * 100).toFixed(1)}%` }} /></div>
                                        <span>{left(it.pos, it.ep.dur)}</span>
                                    </>
                                ) : (
                                    <span>{it.ep.dur ? `${runtime(it.ep.dur)} · ` : ""}starts from the beginning</span>
                                )}
                            </div>
                        </div>
                    </div>
                ))}
            </div>
        </section>
    );
}
