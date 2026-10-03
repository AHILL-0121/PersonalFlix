"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/ui/Toasts";
import { computeUpNext, isNew, playHref, regrade, resumeTarget, type Ep, type TitleLite, type UpNextItem } from "@/lib/ui";
import CommandPalette from "./CommandPalette";
import Hero, { type HeroItem } from "./Hero";
import LibraryGrid from "./LibraryGrid";
import Nav, { type SyncInfo, type View } from "./Nav";
import TitleSheet from "./TitleSheet";
import UpNextRow from "./UpNextRow";

export default function Home({ titles: initial, sync }: { titles: TitleLite[]; sync: Omit<SyncInfo, "titles"> }) {
    const router = useRouter();
    const toast = useToast();
    const [titles, setTitles] = useState(initial);
    const [view, setView] = useState<View>("home");
    const [sheetId, setSheetId] = useState<string | null>(null);
    const [sheetOpen, setSheetOpen] = useState(false);
    const [paletteOpen, setPaletteOpen] = useState(false);

    useEffect(() => setTitles(initial), [initial]);

    const upNext = useMemo(() => computeUpNext(titles), [titles]);

    // hero: what you're watching, then anything new; if there's neither, the best-rated titles
    const heroItems = useMemo((): HeroItem[] => {
        const items: HeroItem[] = upNext.map((u) => ({ t: u.t, ep: u.ep, pos: u.pos, kicker: u.kicker }));
        for (const t of [...titles].filter((x) => isNew(x)).sort((a, b) => b.added - a.added)) {
            if (items.length >= 12) break;
            if (!items.some((x) => x.t.id === t.id)) items.push({ t, ep: t.eps[0], pos: 0, kicker: "New in your library" });
        }
        if (items.length < 3) {
            for (const t of [...titles].sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0))) {
                if (items.length >= 8) break;
                if (!items.some((x) => x.t.id === t.id)) items.push({ t, ep: resumeTarget(t, upNext), pos: 0, kicker: "From your library" });
            }
        }
        return items;
    }, [titles, upNext]);

    const sheetTitle = titles.find((t) => t.id === sheetId) ?? null;
    const sheetTarget = sheetTitle ? resumeTarget(sheetTitle, upNext) : null;

    const play = useCallback((ep: Ep, opts: { resume?: boolean; start?: boolean } = {}) => {
        router.push(playHref(ep.id, opts));
    }, [router]);

    const openSheet = useCallback((t: TitleLite) => {
        setSheetId(t.id);
        setSheetOpen(true);
        regrade(t.id);
    }, []);
    const closeSheet = useCallback(() => setSheetOpen(false), []);
    const playTitle = useCallback((t: TitleLite) => {
        const ep = resumeTarget(t, upNext);
        play(ep, { resume: ep.pos > 3 });
    }, [play, upNext]);

    async function removeFromUpNext(it: UpNextItem) {
        const before = titles;
        setTitles((ts) => ts.map((t) => (t.id === it.t.id ? { ...t, eps: t.eps.map((e) => ({ ...e, pos: 0, at: 0 })) } : t)));
        const res = await fetch(`/api/progress?titleId=${encodeURIComponent(it.t.id)}`, { method: "DELETE" }).catch(() => null);
        if (res?.ok) toast(`Removed ${it.t.name} from Up Next`);
        else {
            setTitles(before);
            toast("Couldn't remove it — try again");
        }
    }

    // global keys: Ctrl K / "/" search, Esc closes the top layer
    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            const tag = (e.target as HTMLElement).tagName;
            if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
                e.preventDefault();
                setPaletteOpen((o) => !o);
                return;
            }
            if (e.key === "Escape") {
                if (paletteOpen) setPaletteOpen(false);
                else if (sheetOpen) setSheetOpen(false);
                return;
            }
            if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA") return;
            if (e.key === "/") { e.preventDefault(); setPaletteOpen(true); }
        };
        document.addEventListener("keydown", onKey);
        return () => document.removeEventListener("keydown", onKey);
    }, [paletteOpen, sheetOpen]);

    // lock page scroll behind the sheet/palette
    useEffect(() => {
        document.body.style.overflow = sheetOpen || paletteOpen ? "hidden" : "";
        return () => { document.body.style.overflow = ""; };
    }, [sheetOpen, paletteOpen]);

    const changeView = (v: View) => {
        setView(v);
        if (v !== "home") window.scrollTo({ top: 0, behavior: "smooth" });
    };

    return (
        <>
            <div className="ambient" aria-hidden="true" />
            <Nav view={view} setView={changeView} onSearch={() => setPaletteOpen(true)} sync={{ ...sync, titles: titles.length }} />

            <main>
                {view === "home" && (
                    <>
                        <Hero
                            items={heroItems}
                            active={!sheetOpen && !paletteOpen}
                            onPlay={(it) => play(it.ep, { resume: it.pos > 0 })}
                            onInfo={openSheet}
                        />
                        <UpNextRow items={upNext} onPlay={(it) => play(it.ep, { resume: it.pos > 0 })} onRemove={removeFromUpNext} />
                    </>
                )}
                {view !== "home" && <div style={{ height: 24 }} />}
                <LibraryGrid titles={titles} view={view} onOpen={openSheet} onPlay={playTitle} />
            </main>

            <footer>
                <span>PersonalFlix · streams straight from Google Drive</span>
                <span>Press <kbd>Ctrl K</kbd> to search · <kbd>?</kbd> in the player for shortcuts</span>
            </footer>

            <div
                className={`scrim${sheetOpen || paletteOpen ? " open" : ""}`}
                onClick={() => { setPaletteOpen(false); setSheetOpen(false); }}
            />
            <TitleSheet t={sheetTitle} target={sheetTarget} open={sheetOpen} onClose={closeSheet} onPlay={play} />
            <CommandPalette
                open={paletteOpen}
                titles={titles}
                upNext={upNext}
                onClose={() => setPaletteOpen(false)}
                onOpenTitle={openSheet}
                onPlayTitle={playTitle}
                onPlayEp={(_, ep) => play(ep, { resume: ep.pos > 3 && ep.dur > 0 && ep.pos < ep.dur - 30 })}
            />
        </>
    );
}
