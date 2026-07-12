import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import HomeGrid from "@/components/library/HomeGrid";
import type { Metadata } from "next";

export const metadata: Metadata = {
    title: "Home",
    description: "Browse your personal movie and series library.",
};

// Revalidate cached data every 15 minutes so the header doesn't call Drive live
export const revalidate = 900;

async function getLibrary() {
    const [movies, series, recentProgress] = await Promise.all([
        db.title.findMany({
            where: { type: "movie" },
            orderBy: { name: "asc" },
        }),
        db.title.findMany({
            where: { type: "series" },
            orderBy: { name: "asc" },
        }),
        // "Continue Watching": episodes with saved progress, most-recently updated first
        db.watchProgress.findMany({
            orderBy: { updatedAt: "desc" },
            take: 20,
            include: {
                episode: {
                    include: { title: true, season: true },
                },
            },
        }),
    ]);

    return { movies, series, recentProgress };
}

export default async function HomePage() {
    const { userId } = auth();
    if (!userId) redirect("/sign-in");

    const { movies, series, recentProgress } = await getLibrary();

    // Filter out progress entries where the user has finished (within last 30s)
    const continueWatching = recentProgress.filter((p) => {
        const { positionSec, episode } = p;
        const dur = episode.durationSec;
        if (!dur) return positionSec > 3;
        return positionSec > 3 && positionSec < dur - 30;
    });

    return (
        <main className="min-h-screen bg-background">
            <HomeGrid
                movies={movies}
                series={series}
                continueWatching={continueWatching}
            />
        </main>
    );
}
