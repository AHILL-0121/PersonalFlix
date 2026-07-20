import { db } from "@/lib/db";
import { notFound } from "next/navigation";
import VideoPlayer from "@/components/player/VideoPlayer";
import type { Metadata } from "next";

interface Props {
    params: { episodeId: string };
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
    const ep = await db.episode.findUnique({
        where: { id: params.episodeId },
        include: { title: true },
    });
    return {
        title: ep ? `${ep.name} — ${ep.title.name}` : "Player",
        description: ep
            ? `Watch ${ep.name} from ${ep.title.name}`
            : "Video player",
    };
}

async function getEpisodeData(episodeId: string) {
    return db.episode.findUnique({
        where: { id: episodeId },
        include: {
            title: true,
            season: {
                include: {
                    episodes: {
                        orderBy: { order: "asc" },
                        select: { id: true, name: true, order: true },
                    },
                },
            },
            subtitleTracks: true,
            audioTracks: true,
            watchProgress: true,
        },
    });
}

export default async function PlayerPage({ params }: Props) {
    const episode = await getEpisodeData(params.episodeId);

    if (!episode) notFound();

    // Build prev/next episode IDs from the season episode list
    const siblings = episode.season?.episodes ?? [];
    const currentIdx = siblings.findIndex((e) => e.id === episode.id);
    const prevEpisode = currentIdx > 0 ? siblings[currentIdx - 1] : null;
    const nextEpisode =
        currentIdx >= 0 && currentIdx < siblings.length - 1
            ? siblings[currentIdx + 1]
            : null;

    return (
        <div className="h-screen w-screen bg-black overflow-hidden">
            <VideoPlayer
                episode={episode}
                prevEpisodeId={prevEpisode?.id ?? null}
                nextEpisodeId={nextEpisode?.id ?? null}
                savedPositionSec={episode.watchProgress?.positionSec ?? 0}
                durationSec={episode.durationSec ?? null}
            />
        </div>
    );
}
