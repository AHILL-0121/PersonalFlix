"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import Icon from "@/components/ui/Icon";
import { useToast } from "@/components/ui/Toasts";
import { extOf, normTitle, parseEpisode, previewPath, specError, type Kind, type UploadSpec } from "@/lib/naming";
import { fingerprint, forgetSession, rememberSession, savedSession, uploadResumable, UploadAborted, UploadGone } from "@/lib/resumableUpload";
import { fromDrop, fromInput, groupFiles, type DraftGroup, type Picked } from "./scan";
import type { LookupResult } from "@/app/api/upload/lookup/route";
import type { UploadStatusItem } from "@/app/api/upload/status/route";

type Status = "ready" | "queued" | "starting" | "uploading" | "done" | "error" | "conflict" | "canceled";

interface Item {
    id: string;
    file: File;
    rel: string;
    season: string;
    episode: string;
    status: Status;
    error?: string;
    /** where the server actually put it (may reuse an existing folder) */
    path?: string;
    existing?: string[];
    replace?: boolean;
}

interface Group {
    id: string;
    key: string;
    kind: Kind;
    title: string;
    year: string;
    items: Item[];
    lookup?: { q: string; busy: boolean; results: LookupResult[]; n: number };
}

interface StatusData {
    items: UploadStatusItem[];
    waiting: number;
    syncedAt: string | null;
}

const PARALLEL = 2;
const ACTIVE: Status[] = ["queued", "starting", "uploading"];
const LOCKED: Status[] = [...ACTIVE, "done"];

let n = 0;
const uid = () => `u${Date.now().toString(36)}${(n++).toString(36)}`;
const toNum = (s: string) => (s.trim() === "" ? null : Number(s));
const fileKey = (f: File) => `${f.name}|${f.size}|${f.lastModified}`;
const lookupQ = (g: Group) => `${g.kind}|${g.title.trim()}|${g.year.trim()}`;

const specOf = (g: Group, it: Item): UploadSpec => ({
    kind: g.kind,
    title: g.title.trim(),
    year: toNum(g.year),
    season: g.kind === "series" ? toNum(it.season) : null,
    episode: g.kind === "series" ? toNum(it.episode) : null,
    ext: extOf(it.file.name),
    size: it.file.size,
});

function bytes(b: number) {
    if (b < 1e6) return `${Math.max(1, Math.round(b / 1e3))} KB`;
    if (b < 1e9) return `${(b / 1e6).toFixed(b < 1e8 ? 1 : 0)} MB`;
    return `${(b / 1e9).toFixed(2)} GB`;
}

function duration(sec: number) {
    if (!isFinite(sec) || sec <= 0) return "";
    if (sec < 90) return `${Math.round(sec)} s`;
    if (sec < 5400) return `${Math.round(sec / 60)} min`;
    return `${(sec / 3600).toFixed(1)} h`;
}

const sortItems = (items: Item[]) =>
    [...items].sort((a, b) => (toNum(a.season) ?? 0) - (toNum(b.season) ?? 0) || (toNum(a.episode) ?? 1e4) - (toNum(b.episode) ?? 1e4) || a.rel.localeCompare(b.rel));

/** Episode numbers used twice in one series. */
function duplicateIds(g: Group): Set<string> {
    const seen = new Map<string, string[]>();
    if (g.kind === "series") {
        for (const it of g.items) {
            const k = `${toNum(it.season)}x${toNum(it.episode)}`;
            seen.set(k, [...(seen.get(k) ?? []), it.id]);
        }
    }
    return new Set(Array.from(seen.values()).filter((ids) => ids.length > 1).flat());
}

function merge(groups: Group[], drafts: DraftGroup[]): { groups: Group[]; added: number } {
    const out = groups.map((g) => ({ ...g, items: [...g.items] }));
    const known = new Set(out.flatMap((g) => g.items.map((i) => fileKey(i.file))));
    let added = 0;
    for (const d of drafts) {
        const items: Item[] = d.items
            .filter((i) => !known.has(fileKey(i.file)))
            .map((i) => ({
                id: uid(), file: i.file, rel: i.rel, status: "ready",
                season: i.season?.toString() ?? "", episode: i.episode?.toString() ?? "",
            }));
        items.forEach((i) => known.add(fileKey(i.file)));
        if (!items.length) continue;
        added += items.length;
        const same = d.kind === "series" ? out.find((g) => g.kind === "series" && (g.key === d.key || normTitle(g.title) === normTitle(d.title))) : undefined;
        if (same) same.items = sortItems([...same.items, ...items]);
        else out.push({ id: uid(), key: d.key, kind: d.kind, title: d.title, year: d.year?.toString() ?? "", items });
    }
    return { groups: out, added };
}

/** The TMDB result to take without asking: same title (ignoring punctuation), and same year if one was given. */
function autoPick(g: Group, results: LookupResult[]): LookupResult | null {
    const t = normTitle(g.title);
    const y = toNum(g.year);
    return (
        results.find((r) => normTitle(r.title) === t && (y === null || r.year === y)) ??
        (y !== null && results[0]?.year === y ? results[0] : null)
    );
}

export default function Uploader({ colabUrl }: { colabUrl: string | null }) {
    const toast = useToast();
    const [groups, setGroups] = useState<Group[]>([]);
    const ref = useRef(groups);
    ref.current = groups;
    const [dragging, setDragging] = useState(false);
    const [scanning, setScanning] = useState(false);
    const [status, setStatus] = useState<StatusData | null>(null);
    const [statusErr, setStatusErr] = useState<string | null>(null);
    const [syncing, setSyncing] = useState(false);
    const [, setTick] = useState(0);
    const fileInput = useRef<HTMLInputElement>(null);
    const folderInput = useRef<HTMLInputElement>(null);

    // upload engine state lives in refs: it changes many times a second and outlives renders
    const claimed = useRef(new Set<string>());
    const aborts = useRef(new Map<string, AbortController>());
    const progress = useRef(new Map<string, number>());
    const chain = useRef<Promise<unknown>>(Promise.resolve());
    const speed = useRef({ last: 0, at: 0, bps: 0 });

    const patchItem = useCallback((id: string, p: Partial<Item>) => {
        setGroups((gs) => gs.map((g) => (g.items.some((i) => i.id === id) ? { ...g, items: g.items.map((i) => (i.id === id ? { ...i, ...p } : i)) } : g)));
    }, []);
    const patchGroup = useCallback((id: string, p: Partial<Group> | ((g: Group) => Partial<Group>)) => {
        setGroups((gs) => gs.map((g) => (g.id === id ? { ...g, ...(typeof p === "function" ? p(g) : p) } : g)));
    }, []);

    useEffect(() => {
        for (const el of [folderInput.current]) {
            el?.setAttribute("webkitdirectory", "");
            el?.setAttribute("directory", "");
        }
    }, []);

    // ── adding files ───────────────────────────────────────────────────────────
    const add = useCallback(
        (picked: Picked[]) => {
            const { groups: drafts, skipped } = groupFiles(picked);
            const result = merge(ref.current, drafts);
            setGroups(result.groups);
            if (!result.added) toast(skipped ? "No video files in that — only mkv, mp4, avi, mov, webm, ts…" : "Those files are already in the list");
            else toast(`Added ${result.added} video${result.added === 1 ? "" : "s"}${skipped ? ` · skipped ${skipped} other file${skipped === 1 ? "" : "s"}` : ""}`, true);
        },
        [toast]
    );

    async function onDrop(e: React.DragEvent) {
        e.preventDefault();
        setDragging(false);
        setScanning(true);
        try {
            add(await fromDrop(e.dataTransfer));
        } catch (err) {
            toast(`Couldn't read that drop: ${err instanceof Error ? err.message : err}`);
        } finally {
            setScanning(false);
        }
    }

    // ── TMDB naming ────────────────────────────────────────────────────────────
    const runLookup = useCallback(
        async (id: string) => {
            const g = ref.current.find((x) => x.id === id);
            if (!g) return;
            const q = lookupQ(g);
            patchGroup(id, { lookup: { q, busy: true, results: g.lookup?.results ?? [], n: g.lookup?.n ?? 0 } });
            const params = new URLSearchParams({ type: g.kind, q: g.title.trim(), year: g.year.trim() });
            const d = await fetch(`/api/upload/lookup?${params}`).then((r) => r.json()).catch(() => ({ results: [] }));
            const results = (d.results ?? []) as LookupResult[];
            patchGroup(id, (x) => {
                const first = (x.lookup?.n ?? 0) === 0;
                const next: Partial<Group> = { lookup: { q, busy: false, results, n: (x.lookup?.n ?? 0) + 1 } };
                // the first lookup of a freshly dropped title fixes its name; after that it only suggests
                const pick = first && lookupQ(x) === q && !x.items.some((i) => LOCKED.includes(i.status)) ? autoPick(x, results) : null;
                if (pick) {
                    next.title = pick.title;
                    next.year = pick.year?.toString() ?? x.year;
                    next.lookup = { ...next.lookup!, q: lookupQ({ ...x, title: pick.title, year: next.year }) };
                }
                return next;
            });
        },
        [patchGroup]
    );

    const lookupSig = groups.map((g) => `${g.id}:${lookupQ(g)}:${g.lookup?.q ?? ""}:${g.lookup?.busy ?? ""}`).join("|");
    useEffect(() => {
        const timers = ref.current
            .filter((g) => g.title.trim() && !g.lookup?.busy && g.lookup?.q !== lookupQ(g))
            .map((g) => setTimeout(() => runLookup(g.id), g.lookup ? 700 : 0));
        return () => timers.forEach(clearTimeout);
    }, [lookupSig, runLookup]);

    // ── uploading ──────────────────────────────────────────────────────────────
    const serial = useCallback(<T,>(fn: () => Promise<T>): Promise<T> => {
        // one session request at a time, so two episodes of a new show don't both create its folder
        const p = chain.current.then(fn, fn);
        chain.current = p.catch(() => {});
        return p;
    }, []);

    const run = useCallback(
        async (id: string) => {
            const find = () => {
                for (const g of ref.current) {
                    const it = g.items.find((i) => i.id === id);
                    if (it) return { g, it };
                }
                return null;
            };
            const f = find();
            if (!f || f.it.status !== "queued") return;
            const spec = specOf(f.g, f.it);
            const invalid = specError(spec);
            if (invalid) return patchItem(id, { status: "error", error: invalid });
            const fp = fingerprint(f.it.file, previewPath(spec));
            const ac = new AbortController();
            aborts.current.set(id, ac);
            patchItem(id, { status: "starting", error: undefined });
            try {
                for (let attempt = 0; attempt < 2; attempt++) {
                    const saved = f.it.replace ? null : savedSession(fp);
                    let url = saved?.url ?? "";
                    let path = saved?.path ?? "";
                    if (!saved) {
                        const res = await serial(() =>
                            fetch("/api/upload/session", {
                                method: "POST",
                                headers: { "Content-Type": "application/json" },
                                body: JSON.stringify({ ...spec, replace: !!f.it.replace }),
                                signal: ac.signal,
                            })
                        );
                        const d = await res.json().catch(() => ({}));
                        if (res.status === 409) return patchItem(id, { status: "conflict", path: d.path, existing: d.existing });
                        if (!res.ok) throw new Error(d.error || `HTTP ${res.status}`);
                        url = d.uploadUrl;
                        path = d.path;
                        rememberSession(fp, url, path);
                    }
                    patchItem(id, { status: "uploading", path });
                    try {
                        await uploadResumable(url, f.it.file, (b) => progress.current.set(id, b), ac.signal, !!saved);
                        forgetSession(fp);
                        progress.current.delete(id);
                        return patchItem(id, { status: "done", replace: false });
                    } catch (e) {
                        if (!(e instanceof UploadGone)) throw e;
                        forgetSession(fp); // expired link: open a fresh session and start over
                    }
                }
                throw new Error("The upload link kept expiring");
            } catch (e) {
                if (e instanceof UploadAborted || ac.signal.aborted) patchItem(id, { status: "canceled" });
                else patchItem(id, { status: "error", error: e instanceof Error ? e.message : String(e) });
            } finally {
                aborts.current.delete(id);
            }
        },
        [patchItem, serial]
    );

    // after every render: start queued items while there's a free slot
    useEffect(() => {
        const queued = ref.current.flatMap((g) => g.items).filter((i) => i.status === "queued" && !claimed.current.has(i.id));
        for (const it of queued.slice(0, Math.max(0, PARALLEL - claimed.current.size))) {
            claimed.current.add(it.id);
            run(it.id).finally(() => {
                claimed.current.delete(it.id);
                setTick((t) => t + 1);
            });
        }
    });

    const all = groups.flatMap((g) => g.items.map((it) => ({ g, it })));
    const active = all.filter(({ it }) => ACTIVE.includes(it.status));
    const busy = active.length > 0;
    const sentOf = (it: Item) => (it.status === "done" ? it.file.size : progress.current.get(it.id) ?? 0);
    const batch = all.filter(({ it }) => ACTIVE.includes(it.status) || it.status === "done");
    const batchSize = batch.reduce((s, { it }) => s + it.file.size, 0);
    const batchSent = batch.reduce((s, { it }) => s + sentOf(it), 0);

    // while uploading: keep the screen on, warn before closing the tab, refresh progress + speed every second
    useEffect(() => {
        if (!busy) return;
        let lock: { release: () => Promise<void> } | null = null;
        let dead = false;
        const wakeLock = (navigator as Navigator & { wakeLock?: { request: (t: "screen") => Promise<{ release: () => Promise<void> }> } }).wakeLock;
        const grab = () => wakeLock?.request("screen").then((l) => { if (dead) l.release(); else lock = l; }).catch(() => {});
        grab();
        const onVis = () => document.visibilityState === "visible" && grab(); // hidden tabs lose the lock
        const onLeave = (e: BeforeUnloadEvent) => {
            e.preventDefault();
            e.returnValue = "";
        };
        document.addEventListener("visibilitychange", onVis);
        window.addEventListener("beforeunload", onLeave);
        speed.current = { last: -1, at: Date.now(), bps: 0 };
        const t = setInterval(() => {
            const total = ref.current.flatMap((g) => g.items).reduce((s, it) => s + (it.status === "done" ? it.file.size : progress.current.get(it.id) ?? 0), 0);
            const now = Date.now();
            const sp = speed.current;
            if (sp.last >= 0 && total >= sp.last) {
                const bps = ((total - sp.last) * 1000) / Math.max(1, now - sp.at);
                sp.bps = sp.bps ? sp.bps * 0.8 + bps * 0.2 : bps;
            }
            sp.last = total;
            sp.at = now;
            setTick((x) => x + 1);
        }, 1000);
        return () => {
            dead = true;
            lock?.release().catch(() => {});
            document.removeEventListener("visibilitychange", onVis);
            window.removeEventListener("beforeunload", onLeave);
            clearInterval(t);
        };
    }, [busy]);

    // ── status of earlier uploads ──────────────────────────────────────────────
    const loadStatus = useCallback(async () => {
        try {
            const res = await fetch("/api/upload/status", { cache: "no-store" });
            const d = await res.json();
            if (!res.ok) throw new Error(d.error || `HTTP ${res.status}`);
            setStatus(d);
            setStatusErr(null);
        } catch (e) {
            setStatusErr(e instanceof Error ? e.message : String(e));
        }
    }, []);
    useEffect(() => {
        loadStatus();
    }, [loadStatus]);

    const wasBusy = useRef(false);
    useEffect(() => {
        if (wasBusy.current && !busy) {
            const done = ref.current.flatMap((g) => g.items).filter((i) => i.status === "done").length;
            if (done) toast(`Upload finished · ${done} file${done === 1 ? "" : "s"} ready for the convert notebook`, true);
            loadStatus();
        }
        wasBusy.current = busy;
    }, [busy, loadStatus, toast]);

    async function syncNow() {
        setSyncing(true);
        try {
            const res = await fetch("/api/library/refresh", { method: "POST" });
            const d = await res.json();
            if (!res.ok) throw new Error(d.error || `HTTP ${res.status}`);
            toast(`Library synced · ${d.changed} updated${d.newTitles ? `, ${d.newTitles} new titles` : ""}`, true);
            await loadStatus();
        } catch (e) {
            toast(`Sync failed — ${(e instanceof Error ? e.message : String(e)).slice(0, 80)}`);
        } finally {
            setSyncing(false);
        }
    }

    // ── actions ────────────────────────────────────────────────────────────────
    const invalid = new Map<string, string>();
    for (const g of groups) {
        const dupes = duplicateIds(g);
        for (const it of g.items) {
            const err = specError(specOf(g, it)) ?? (dupes.has(it.id) ? "Same episode number twice" : null);
            if (err) invalid.set(it.id, err);
        }
    }
    const startable = all.filter(({ it }) => ["ready", "canceled", "error"].includes(it.status) && !invalid.has(it.id));
    const blocked = all.filter(({ it }) => ["ready", "canceled", "error"].includes(it.status) && invalid.has(it.id));

    function uploadAll() {
        const ids = new Set(startable.map(({ it }) => it.id));
        setGroups((gs) => gs.map((g) => ({ ...g, items: g.items.map((i) => (ids.has(i.id) ? { ...i, status: "queued" as const, error: undefined } : i)) })));
        if (blocked.length) toast(`${blocked.length} file${blocked.length === 1 ? " needs" : "s need"} fixing first — see the red notes`);
    }
    const cancel = (id: string) => {
        aborts.current.get(id)?.abort();
        setGroups((gs) => gs.map((g) => ({ ...g, items: g.items.map((i) => (i.id === id && i.status === "queued" ? { ...i, status: "canceled" as const } : i)) })));
    };
    const cancelAll = () => {
        setGroups((gs) => gs.map((g) => ({ ...g, items: g.items.map((i) => (i.status === "queued" ? { ...i, status: "canceled" as const } : i)) })));
        aborts.current.forEach((a) => a.abort());
    };
    const removeItem = (id: string) => setGroups((gs) => gs.map((g) => ({ ...g, items: g.items.filter((i) => i.id !== id) })).filter((g) => g.items.length));
    const removeGroup = (id: string) => setGroups((gs) => gs.filter((g) => g.id !== id));
    const clearDone = () => setGroups((gs) => gs.map((g) => ({ ...g, items: g.items.filter((i) => i.status !== "done") })).filter((g) => g.items.length));
    const retry = (id: string, replace = false) => patchItem(id, { status: "queued", error: undefined, replace });

    function switchKind(g: Group) {
        const kind: Kind = g.kind === "movie" ? "series" : "movie";
        patchGroup(g.id, {
            kind,
            lookup: undefined,
            items: g.items.map((i) => {
                const ep = parseEpisode(i.file.name);
                return { ...i, season: i.season || String(ep.season ?? 1), episode: i.episode || String(ep.episode ?? 1) };
            }),
        });
    }

    const doneCount = all.filter(({ it }) => it.status === "done").length;
    const queueSize = all.reduce((s, { it }) => s + it.file.size, 0);
    const bps = speed.current.bps;
    const waiting = status?.waiting ?? 0;
    const ready = status?.items.filter((i) => i.ready).length ?? 0;

    return (
        <div className="up">
            <header className="up-top">
                <Link href="/" className="logo" aria-label="PersonalFlix home">Personal<i>Flix</i></Link>
                <div className="nav-spacer" />
                <Link href="/" className="btn btn-ghost btn-sm"><Icon name="back" />Library</Link>
            </header>

            <main className="up-main">
                <div className="up-head">
                    <div className="eyebrow">Add to library</div>
                    <h1>Upload</h1>
                    <p>
                        Drop movies, or whole series folders. Each file is renamed and filed into <code>MOVIE/</code> or <code>SERIES/</code> in
                        Drive, straight from this device. The next convert run turns it into a stream in <code>STREAM/</code>.
                    </p>
                </div>

                <div
                    className={`up-drop${dragging ? " over" : ""}${scanning ? " busy" : ""}`}
                    onDragEnter={(e) => { e.preventDefault(); setDragging(true); }}
                    onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = "copy"; }}
                    onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragging(false); }}
                    onDrop={onDrop}
                >
                    <div className="up-drop-orb"><Icon name="upload" /></div>
                    <b>{scanning ? "Reading folders…" : dragging ? "Drop to add" : "Drop video files or folders here"}</b>
                    <span>mkv, mp4, avi, mov, webm, ts · any size · subtitles and artwork are skipped</span>
                    <div className="up-drop-btns">
                        <button className="btn btn-primary btn-sm" onClick={() => fileInput.current?.click()}><Icon name="file" />Choose files</button>
                        <button className="btn btn-ghost btn-sm up-folder-btn" onClick={() => folderInput.current?.click()}><Icon name="folder" />Choose a folder</button>
                    </div>
                    <input ref={fileInput} type="file" multiple hidden onChange={(e) => { if (e.target.files?.length) add(fromInput(e.target.files)); e.target.value = ""; }} />
                    <input ref={folderInput} type="file" multiple hidden onChange={(e) => { if (e.target.files?.length) add(fromInput(e.target.files)); e.target.value = ""; }} />
                </div>

                {groups.length > 0 && (
                    <section className="up-queue" aria-label="Files to upload">
                        {groups.map((g) => {
                            const locked = g.items.some((i) => LOCKED.includes(i.status));
                            const match = g.lookup?.results.find((r) => normTitle(r.title) === normTitle(g.title) && r.year === toNum(g.year));
                            const others = (g.lookup?.results ?? []).filter((r) => r !== match).slice(0, match ? 2 : 3);
                            return (
                                <article key={g.id} className="up-card">
                                    <div className="up-card-head">
                                        <div className={`up-poster${match?.poster ? "" : " none"}`}>
                                            {match?.poster ? <img src={match.poster} alt="" /> : <Icon name={g.kind === "movie" ? "film" : "tv"} />}
                                        </div>
                                        <div className="up-fields">
                                            <div className="up-kind">
                                                {g.items.length === 1 && !locked ? (
                                                    <button className="up-kind-btn" onClick={() => switchKind(g)} title="Switch between movie and series">
                                                        <Icon name={g.kind === "movie" ? "film" : "tv"} />{g.kind === "movie" ? "Movie" : "Series"}<span>switch</span>
                                                    </button>
                                                ) : (
                                                    <span className="up-kind-btn static"><Icon name={g.kind === "movie" ? "film" : "tv"} />{g.kind === "movie" ? "Movie" : `Series · ${g.items.length} episodes`}</span>
                                                )}
                                                {g.lookup?.busy ? <span className="up-tmdb">Checking TMDB…</span> : match ? <span className="up-tmdb ok"><Icon name="check" />TMDB match</span> : g.lookup?.n ? <span className="up-tmdb">No exact TMDB match</span> : null}
                                            </div>
                                            <div className="up-row2">
                                                <label className="up-field grow">
                                                    <span>Title</span>
                                                    <input value={g.title} disabled={locked} onChange={(e) => patchGroup(g.id, { title: e.target.value })} spellCheck={false} />
                                                </label>
                                                <label className="up-field year">
                                                    <span>Year</span>
                                                    <input value={g.year} disabled={locked} inputMode="numeric" maxLength={4} placeholder="—" onChange={(e) => patchGroup(g.id, { year: e.target.value.replace(/\D/g, "") })} />
                                                </label>
                                            </div>
                                            {!locked && others.length > 0 && (
                                                <div className="up-suggest">
                                                    <span>{match ? "Or" : "Did you mean"}</span>
                                                    {others.map((r) => (
                                                        <button key={r.tmdbId} onClick={() => patchGroup(g.id, { title: r.title, year: r.year?.toString() ?? "" })}>
                                                            {r.poster && <img src={r.poster} alt="" />}{r.title}{r.year ? ` (${r.year})` : ""}
                                                        </button>
                                                    ))}
                                                </div>
                                            )}
                                            {g.kind === "movie" && !g.year && <div className="up-warn">No year — add one so the right poster is found and remakes don&apos;t collide.</div>}
                                        </div>
                                        {!locked && (
                                            <button className="icon-btn" aria-label={`Remove ${g.title}`} onClick={() => removeGroup(g.id)}><Icon name="x" /></button>
                                        )}
                                    </div>

                                    <ul className="up-items">
                                        {g.items.map((it) => {
                                            const err = invalid.get(it.id);
                                            const editable = !LOCKED.includes(it.status);
                                            const sent = sentOf(it);
                                            const pct = it.file.size ? Math.min(100, (sent / it.file.size) * 100) : 0;
                                            return (
                                                <li key={it.id} className={`up-item s-${it.status}${g.kind === "series" ? " has-se" : ""}`}>
                                                    {g.kind === "series" && (
                                                        <div className="up-se">
                                                            <label><span>S</span><input value={it.season} disabled={!editable} inputMode="numeric" maxLength={2} aria-label="Season" onChange={(e) => patchItem(it.id, { season: e.target.value.replace(/\D/g, "") })} /></label>
                                                            <label><span>E</span><input value={it.episode} disabled={!editable} inputMode="numeric" maxLength={3} aria-label="Episode" onChange={(e) => patchItem(it.id, { episode: e.target.value.replace(/\D/g, "") })} /></label>
                                                        </div>
                                                    )}
                                                    <div className="up-names">
                                                        <div className="up-src" title={it.rel}>{it.rel}</div>
                                                        <div className="up-dest mono" title="Where it goes in Drive">
                                                            → {it.path ?? (err ? "…" : previewPath(specOf(g, it)))}
                                                        </div>
                                                    </div>
                                                    <div className="up-size mono">{bytes(it.file.size)}</div>
                                                    <div className="up-state">
                                                        {it.status === "ready" && (err ? <span className="up-err">{err}</span> : <span className="up-muted">Ready</span>)}
                                                        {it.status === "queued" && <span className="up-muted">Waiting…</span>}
                                                        {it.status === "starting" && <span className="up-muted">Preparing folders…</span>}
                                                        {it.status === "uploading" && (
                                                            <div className="up-prog">
                                                                <div className="mini-bar"><i style={{ width: `${pct}%` }} /></div>
                                                                <span className="mono">{pct.toFixed(pct < 10 ? 1 : 0)}%</span>
                                                            </div>
                                                        )}
                                                        {it.status === "done" && <span className="up-ok"><Icon name="check" />Uploaded</span>}
                                                        {it.status === "error" && <span className="up-err" title={it.error}>{err ?? it.error}</span>}
                                                        {it.status === "canceled" && <span className="up-muted">Canceled</span>}
                                                        {it.status === "conflict" && (
                                                            <span className="up-err" title={it.existing?.join(", ")}>Already in the library{it.existing?.length ? `: ${it.existing[0]}` : ""}</span>
                                                        )}
                                                    </div>
                                                    <div className="up-acts">
                                                        {ACTIVE.includes(it.status) && <button className="btn btn-ghost btn-sm" onClick={() => cancel(it.id)}>Cancel</button>}
                                                        {(it.status === "error" || it.status === "canceled") && !err && (
                                                            <button className="btn btn-ghost btn-sm" onClick={() => retry(it.id)}>{it.status === "canceled" ? "Resume" : "Retry"}</button>
                                                        )}
                                                        {it.status === "conflict" && (
                                                            <button className="btn btn-ghost btn-sm" onClick={() => retry(it.id, true)} title="Moves the old file to Drive's bin, then uploads this one">Replace</button>
                                                        )}
                                                        {!ACTIVE.includes(it.status) && it.status !== "done" && g.items.length > 1 && (
                                                            <button className="icon-btn sm" aria-label="Remove file" onClick={() => removeItem(it.id)}><Icon name="x" /></button>
                                                        )}
                                                    </div>
                                                </li>
                                            );
                                        })}
                                    </ul>
                                </article>
                            );
                        })}
                    </section>
                )}

                {groups.length > 0 && (
                    <div className="up-bar">
                        {busy || batch.length ? (
                            <div className="up-bar-prog">
                                <div className="up-bar-line">
                                    <b>{busy ? `Uploading ${doneCount + 1 > batch.length ? batch.length : doneCount + 1} of ${batch.length}` : `Uploaded ${doneCount} of ${batch.length}`}</b>
                                    <span className="mono">
                                        {bytes(batchSent)} / {bytes(batchSize)}
                                        {busy && bps > 0 ? ` · ${bytes(bps)}/s · ${duration((batchSize - batchSent) / bps)} left` : ""}
                                    </span>
                                </div>
                                <div className="mini-bar"><i style={{ width: `${batchSize ? (batchSent / batchSize) * 100 : 0}%` }} /></div>
                            </div>
                        ) : (
                            <div className="up-bar-prog">
                                <div className="up-bar-line">
                                    <b>{all.length} file{all.length === 1 ? "" : "s"} · {bytes(queueSize)}</b>
                                    <span>{blocked.length ? `${blocked.length} need fixing` : "Names look good"}</span>
                                </div>
                            </div>
                        )}
                        <div className="up-bar-btns">
                            {doneCount > 0 && !busy && <button className="btn btn-ghost btn-sm" onClick={clearDone}>Clear finished</button>}
                            {busy && <button className="btn btn-ghost btn-sm" onClick={cancelAll}>Cancel all</button>}
                            {startable.length > 0 && (
                                <button className="btn btn-ember btn-sm" onClick={uploadAll}>
                                    <Icon name="upload" />Upload {startable.length} file{startable.length === 1 ? "" : "s"}
                                </button>
                            )}
                        </div>
                    </div>
                )}

                <section className="up-pipe" aria-label="Conversion pipeline">
                    <div className="section-head"><h2>Pipeline</h2></div>
                    <ol className="up-steps">
                        <li className={busy ? "on" : ""}>
                            <span className="up-step-n">1</span>
                            <div><b>Upload</b><span>{busy ? `${active.length} in progress` : "From this page, straight into Drive"}</span></div>
                        </li>
                        <li className={waiting ? "on" : ""}>
                            <span className="up-step-n">2</span>
                            <div>
                                <b>Convert <small>Colab</small></b>
                                <span>{status ? (waiting ? `${waiting} waiting to convert` : "Nothing waiting") : "…"}</span>
                            </div>
                            {colabUrl && (
                                <a className={`btn btn-sm ${waiting ? "btn-ember" : "btn-ghost"}`} href={colabUrl} target="_blank" rel="noreferrer">Open notebook</a>
                            )}
                        </li>
                        <li>
                            <span className="up-step-n">3</span>
                            <div><b>Stream</b><span>{status ? `${ready} of the last ${status.items.length} uploads playable` : "…"}</span></div>
                            <button className="btn btn-ghost btn-sm" onClick={syncNow} disabled={syncing}><Icon name="refresh" />{syncing ? "Syncing…" : "Sync"}</button>
                        </li>
                    </ol>
                    <p className="up-note">
                        In the notebook, set <code>MODE = all</code> and use <b>Runtime → Run all</b>. It skips everything already converted.
                        Plain H.264 files work on a free CPU runtime; HEVC and AV1 need the T4 GPU runtime. With <code>SYNC_URL</code> filled in, the
                        app syncs itself when the run finishes.
                        {!colabUrl && <> Set <code>COLAB_NOTEBOOK_URL</code> to get an “Open notebook” button here.</>}
                    </p>

                    {statusErr && <div className="up-err block">Couldn&apos;t load recent uploads: {statusErr}</div>}
                    {status && status.items.length > 0 && (
                        <ul className="up-recent">
                            {status.items.map((u) => (
                                <li key={u.id}>
                                    <span className={`up-chip${u.ready ? " ok" : ""}`}>{u.ready ? "Streaming" : "Waiting to convert"}</span>
                                    <div className="up-names">
                                        <div className="up-src">{u.name}</div>
                                        <div className="up-dest mono">{u.key ?? ""} · {bytes(u.size)} · {new Date(u.createdTime).toLocaleDateString()}</div>
                                    </div>
                                    {u.ready && <Link className="btn btn-ghost btn-sm" href={`/player/${u.ready.episodeId}`}><Icon name="play" />Play</Link>}
                                </li>
                            ))}
                        </ul>
                    )}
                    {status && !status.items.length && <p className="up-note">Nothing uploaded from this page yet.</p>}
                </section>
            </main>
        </div>
    );
}
