import { db } from "@/lib/db";
import { notFound } from "next/navigation";
import TitleDetail from "@/components/library/TitleDetail";
import type { Metadata } from "next";

interface Props {
    params: { titleId: string };
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
    const title = await db.title.findUnique({ where: { id: params.titleId } });
    return {
        title: title?.name ?? "Title",
        description: `Watch ${title?.name ?? "this title"} in your Personal Netflix library.`,
    };
}

async function getTitleData(titleId: string) {
    return db.title.findUnique({
        where: { id: titleId },
        include: {
            seasons: {
                orderBy: { number: "asc" },
                include: {
                    episodes: {
                        orderBy: { order: "asc" },
                        include: {
                            watchProgress: true,
                        },
                    },
                },
            },
        },
    });
}

export default async function TitleDetailPage({ params }: Props) {
    const title = await getTitleData(params.titleId);

    if (!title) notFound();
    // Movies go straight to the player — this page is Series only
    if (title.type === "movie") {
        const episode = await db.episode.findFirst({
            where: { titleId: title.id },
        });
        if (episode) {
            const { redirect } = await import("next/navigation");
            redirect(`/player/${episode.id}`);
        }
    }

    return (
        <main className="min-h-screen bg-background">
            <TitleDetail title={title} />
        </main>
    );
}
