"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Search, Save, Check, RefreshCw, ArrowLeft } from "lucide-react";
import Link from "next/link";
import Image from "next/image";

type Title = {
    id: string;
    name: string;
    type: string;
    tmdbId: number | null;
    posterUrl: string | null;
    year: number | null;
    tmdbEpisodeSync: boolean;
};

export default function TmdbConfigClient({ initialTitles }: { initialTitles: Title[] }) {
    const [titles, setTitles] = useState<Title[]>(initialTitles);
    const [search, setSearch] = useState("");
    const [updating, setUpdating] = useState<string | null>(null);
    const [updatedId, setUpdatedId] = useState<string | null>(null);
    const [activeTab, setActiveTab] = useState<"movies" | "series">("movies");

    const router = useRouter();

    const filteredTitles = titles.filter(t =>
        t.name.toLowerCase().includes(search.toLowerCase()) &&
        (activeTab === "movies" ? t.type === "movie" : t.type === "series")
    );

    const handleSave = async (titleId: string, newId: string, syncEpisodes?: boolean) => {
        const parsed = parseInt(newId, 10);
        if (isNaN(parsed) && newId !== "") {
            alert("Please enter a valid numeric TMDB ID.");
            return;
        }

        setUpdating(titleId);
        try {
            const res = await fetch("/api/library/override", {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ titleId, tmdbId: isNaN(parsed) ? null : parsed, tmdbEpisodeSync: syncEpisodes }),
            });

            const data = await res.json();

            if (res.ok) {
                setTitles(prev =>
                    prev.map(t =>
                        t.id === titleId ? {
                            ...t,
                            tmdbId: data.updated.tmdbId,
                            posterUrl: data.updated.posterUrl,
                            name: data.updated.name,
                            year: data.updated.year,
                            tmdbEpisodeSync: data.updated.tmdbEpisodeSync
                        } : t
                    )
                );
                setUpdatedId(titleId);
                setTimeout(() => setUpdatedId(null), 3000); // clear checkmark after 3s
            } else {
                alert(`Error: ${data.error}`);
            }
        } catch (err) {
            console.error(err);
            alert("Failed to update.");
        } finally {
            setUpdating(null);
        }
    };

    return (
        <div className="max-w-6xl mx-auto space-y-6">
            {/* Header */}
            <div className="flex items-center justify-between gap-4 mb-8">
                <div className="flex items-center gap-4">
                    <Link
                        href="/"
                        className="p-2 bg-neutral-800 hover:bg-neutral-700 rounded-full transition"
                    >
                        <ArrowLeft className="w-5 h-5 text-white" />
                    </Link>
                    <div>
                        <h1 className="text-3xl font-bold text-white mb-2">TMDb Overrides</h1>
                        <p className="text-neutral-400">
                            Manually fix mismatched movies or series. Enter the correct TMDB ID and save.
                            The poster and title will update <strong>live</strong>. Run a library refresh later
                            to sync internal episode metadata.
                        </p>
                    </div>
                </div>

                <button
                    onClick={async (e) => {
                        const btn = e.currentTarget;
                        const originalText = btn.innerHTML;
                        btn.innerHTML = `<svg class="w-5 h-5 animate-spin" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg> Refreshing...`;
                        btn.disabled = true;
                        try {
                            const res = await fetch("/api/library/refresh", { method: "POST" });
                            if (res.ok) {
                                alert("Library Refreshed Successfully!");
                            } else {
                                alert("Refresh Error");
                            }
                        } catch (err) {
                            alert("Failed to refresh library.");
                        } finally {
                            btn.innerHTML = originalText;
                            btn.disabled = false;
                        }
                    }}
                    className="hidden sm:flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white font-medium rounded-lg transition-colors shadow-lg"
                >
                    <RefreshCw className="w-4 h-4" />
                    Run Library Refresh
                </button>
            </div>

            {/* Search and Tabs */}
            <div className="flex flex-col md:flex-row gap-4 mb-6">
                <div className="flex bg-neutral-900 rounded-lg p-1 overflow-hidden">
                    <button
                        onClick={() => setActiveTab("movies")}
                        className={`px-6 py-2 rounded-md font-semibold transition ${activeTab === "movies" ? "bg-white text-black" : "text-neutral-400 hover:text-white"}`}
                    >
                        Movies
                    </button>
                    <button
                        onClick={() => setActiveTab("series")}
                        className={`px-6 py-2 rounded-md font-semibold transition ${activeTab === "series" ? "bg-white text-black" : "text-neutral-400 hover:text-white"}`}
                    >
                        Series
                    </button>
                </div>
                <div className="relative flex-1">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-neutral-400" />
                    <input
                        type="text"
                        placeholder={`Search ${activeTab}...`}
                        value={search}
                        onChange={e => setSearch(e.target.value)}
                        className="w-full pl-10 pr-4 py-3 bg-neutral-900 border border-neutral-800 rounded-lg text-white focus:outline-none focus:border-neutral-700 transition"
                    />
                </div>
            </div>

            {/* Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-2 xl:grid-cols-3 gap-4">
                {filteredTitles.map(title => (
                    <div
                        key={title.id}
                        className="bg-neutral-900 border border-neutral-800 rounded-xl p-4 flex gap-4 overflow-hidden"
                    >
                        {/* Poster */}
                        <div className="w-20 h-32 flex-shrink-0 bg-neutral-800 rounded-md overflow-hidden relative">
                            {title.posterUrl ? (
                                <Image
                                    src={title.posterUrl}
                                    alt={title.name}
                                    fill
                                    className="object-cover"
                                />
                            ) : (
                                <div className="absolute inset-0 flex items-center justify-center text-xs text-neutral-500 text-center p-2">
                                    No Image / Cleared
                                </div>
                            )}
                        </div>

                        {/* Info & Form */}
                        <div className="flex-1 min-w-0 flex flex-col justify-between">
                            <div>
                                <h3 className="font-semibold text-white whitespace-nowrap overflow-hidden text-ellipsis" title={title.name}>
                                    {title.name}
                                </h3>
                                <p className="text-xs text-neutral-400 mt-1 uppercase tracking-wider font-semibold">
                                    {title.type} {title.year && `• ${title.year}`}
                                </p>
                            </div>

                            <form
                                className="mt-4 flex flex-col gap-2"
                                onSubmit={(e) => {
                                    e.preventDefault();
                                    const formData = new FormData(e.currentTarget);
                                    const newId = formData.get("tmdbId") as string;
                                    const syncEpisodes = formData.get("syncEpisodes") === "on";
                                    handleSave(title.id, newId, syncEpisodes);
                                }}
                            >
                                <label className="text-xs text-neutral-500 font-medium">TMDb ID</label>
                                <div className="flex gap-2">
                                    <input
                                        type="number"
                                        name="tmdbId"
                                        defaultValue={title.tmdbId ?? ""}
                                        placeholder="e.g. 578060"
                                        className="w-full bg-neutral-800 border border-neutral-700 text-white text-sm rounded px-3 py-1.5 focus:outline-none focus:border-blue-500"
                                    />
                                    <button
                                        type="submit"
                                        disabled={updating === title.id}
                                        className="bg-blue-600 hover:bg-blue-500 text-white px-3 rounded flex items-center justify-center transition disabled:opacity-50"
                                        title="Save Override"
                                    >
                                        {updating === title.id ? (
                                            <RefreshCw className="w-4 h-4 animate-spin" />
                                        ) : updatedId === title.id ? (
                                            <Check className="w-4 h-4 text-green-300" />
                                        ) : (
                                            <Save className="w-4 h-4" />
                                        )}
                                    </button>
                                </div>
                                {activeTab === "series" && (
                                    <label className="flex items-center gap-2 mt-2 select-none cursor-pointer">
                                        <input
                                            type="checkbox"
                                            name="syncEpisodes"
                                            defaultChecked={title.tmdbEpisodeSync}
                                            onChange={(e) => {
                                                e.currentTarget.form?.requestSubmit();
                                            }}
                                            className="w-4 h-4 rounded bg-neutral-700 border border-neutral-600 focus:ring-blue-500 checked:bg-blue-600"
                                        />
                                        <span className="text-xs text-neutral-300 font-medium">Sync TMDB Episode Data</span>
                                    </label>
                                )}
                            </form>
                        </div>
                    </div>
                ))}

                {filteredTitles.length === 0 && (
                    <div className="col-span-full py-12 text-center text-neutral-500">
                        No titles found.
                    </div>
                )}
            </div>
        </div>
    );
}
