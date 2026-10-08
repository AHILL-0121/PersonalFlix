import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { cache } from "react";
import PlayerHost from "@/components/player/PlayerHost";
import { displayName, loadTitle } from "@/lib/catalog";
import { db } from "@/lib/db";

interface Props {
    params: { episodeId: string };
    searchParams: { resume?: string; start?: string };
}

export const dynamic = "force-dynamic";

// cached per request: generateMetadata and the page share one query
const getEpisode = cache(async (id: string) =>
    db.episode.findUnique({
        where: { id },
        select: { id: true, titleId: true, mpd: true, title: { select: { name: true } }, name: true },
    }),
);

export async function generateMetadata({ params }: Props): Promise<Metadata> {
    const ep = await getEpisode(params.episodeId);
    if (!ep) return { title: "Player" };
    const name = displayName(ep.title.name);
    return { title: ep.name === ep.title.name ? name : `${ep.name} — ${name}` };
}

export default async function PlayerPage({ params, searchParams }: Props) {
    const ep = await getEpisode(params.episodeId);
    if (!ep?.mpd) notFound();
    const title = await loadTitle(ep.titleId);
    if (!title) notFound();

    const start = searchParams.start !== undefined ? "start" : searchParams.resume ? "resume" : "ask";
    return <PlayerHost key={ep.id} title={title} episodeId={ep.id} mpd={ep.mpd} start={start} />;
}
