import type { Metadata } from "next";
import Home from "@/components/home/Home";
import { loadCatalog, loadSyncState } from "@/lib/catalog";

export const metadata: Metadata = {
    title: "Home",
    description: "Browse your personal movie and series library.",
};

// progress changes every time something is watched, so always render fresh
export const dynamic = "force-dynamic";

export default async function HomePage() {
    const [titles, sync] = await Promise.all([loadCatalog(), loadSyncState()]);
    return <Home titles={titles} sync={sync} />;
}
