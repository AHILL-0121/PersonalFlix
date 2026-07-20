import { db } from "@/lib/db";
import TmdbConfigClient from "./TmdbConfigClient";

export const dynamic = "force-dynamic";

export default async function TmdbConfigPage() {
    const titles = await db.title.findMany({
        orderBy: { name: "asc" },
        select: {
            id: true,
            name: true,
            type: true,
            tmdbId: true,
            posterUrl: true,
            year: true,
            tmdbEpisodeSync: true,
        },
    });

    return (
        <div className="min-h-screen bg-[#141414] text-white p-6 pb-20">
            <TmdbConfigClient initialTitles={titles} />
        </div>
    );
}
