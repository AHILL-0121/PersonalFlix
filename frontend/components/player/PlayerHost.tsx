"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { nextEp, playHref, type Ep, type TitleLite } from "@/lib/ui";
import Player from "./Player";

type Start = "start" | "resume" | "ask";

/**
 * Keeps the player page mounted across episodes: next / previous / auto-advance fetch just the new manifest
 * (prefetched for the next episode) and swap the Player in place instead of a server round-trip through
 * the router. The <html> element stays fullscreen across the swap.
 */
export default function PlayerHost({
    title: initialTitle,
    episodeId,
    mpd,
    start,
}: {
    title: TitleLite;
    episodeId: string;
    mpd: string;
    start: Start;
}) {
    const router = useRouter();
    const [title, setTitle] = useState(initialTitle);
    const [cur, setCur] = useState({ id: episodeId, mpd, start, swapped: false });
    const mpds = useRef(new Map<string, Promise<string>>([[episodeId, Promise.resolve(mpd)]]));

    const fetchMpd = useCallback((id: string) => {
        let p = mpds.current.get(id);
        if (!p) {
            p = fetch(`/api/episode/${id}`, { cache: "no-store" }).then(async (res) => {
                const d = await res.json().catch(() => ({}));
                if (!res.ok || !d.mpd) throw new Error(d.error || `HTTP ${res.status}`);
                return d.mpd as string;
            });
            p.catch(() => mpds.current.delete(id)); // let a later attempt retry
            mpds.current.set(id, p);
        }
        return p;
    }, []);

    // have the next episode's manifest ready before it's needed
    useEffect(() => {
        const ep = title.eps.find((e) => e.id === cur.id);
        const n = ep && nextEp(title, ep);
        if (n) fetchMpd(n.id).catch(() => {});
    }, [cur.id, fetchMpd, title]);

    useEffect(() => {
        const ep = title.eps.find((e) => e.id === cur.id);
        if (!ep) return;
        document.title = `${ep.name === title.name ? title.name : `${ep.name} — ${title.name}`} · PersonalFlix`;
    }, [cur.id, title]);

    const go = useCallback(async (target: Ep, opts: { start?: boolean }, pos: number) => {
        // remember where the outgoing episode stopped (episode drawer, later resume prompts)
        setTitle((t) => ({ ...t, eps: t.eps.map((e) => (e.id === cur.id ? { ...e, pos, at: Date.now() } : e)) }));
        const href = playHref(target.id, opts);
        try {
            const m = await fetchMpd(target.id);
            window.history.replaceState(null, "", href);
            setCur({ id: target.id, mpd: m, start: opts.start ? "start" : "ask", swapped: true });
        } catch {
            router.replace(href); // fall back to a full page load of the episode
        }
    }, [cur.id, fetchMpd, router]);

    // keyed by episode so each one gets a fresh player
    return (
        <Player
            key={cur.id}
            title={title}
            episodeId={cur.id}
            mpd={cur.mpd}
            start={cur.start}
            swapped={cur.swapped}
            onGo={go}
        />
    );
}
