"use client";

import Art from "@/components/ui/Art";
import Icon from "@/components/ui/Icon";
import { isDone, left, runtime, type Ep, type TitleLite } from "@/lib/ui";

/** Episode list used by the title sheet and the player's episode drawer. */
export default function EpisodeRows({
    t,
    eps,
    currentId,
    onPick,
}: {
    t: TitleLite;
    eps: Ep[];
    currentId?: string | null;
    onPick: (ep: Ep) => void;
}) {
    return (
        <>
            {eps.map((ep) => {
                const done = isDone(ep);
                const cur = ep.id === currentId;
                return (
                    <button
                        key={ep.id}
                        className={`ep${cur ? " current" : ""}`}
                        data-current={cur || undefined}
                        onClick={() => onPick(ep)}
                        aria-label={`Episode ${ep.e}: ${ep.name}`}
                    >
                        <span className="n">{ep.e}</span>
                        <span className="thumb">
                            <Art t={t} kind="backdrop" src={ep.thumb} label={false} />
                            <span className="orb"><Icon name="play" /></span>
                            {ep.pos > 3 && ep.dur > 0 && (
                                <span className="p-progress"><i style={{ width: `${Math.min(100, (ep.pos / ep.dur) * 100).toFixed(1)}%` }} /></span>
                            )}
                        </span>
                        <span>
                            <div className="et">{ep.name}</div>
                            <div className="ed">
                                {ep.pos > 3 && !done && ep.dur > 0 && (
                                    <><span style={{ color: "var(--ember-2)" }}>{left(ep.pos, ep.dur)}</span> · </>
                                )}
                                {ep.overview || `Season ${ep.s}, episode ${ep.e}.`}
                            </div>
                        </span>
                        <span className="er">
                            {done ? <Icon name="check" className="ic done" /> : ep.dur ? runtime(ep.dur) : ""}
                        </span>
                    </button>
                );
            })}
        </>
    );
}
