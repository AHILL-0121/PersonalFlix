import type { CSSProperties } from "react";
import { palette, type TitleLite } from "@/lib/ui";

/**
 * Artwork for a title: the TMDB poster/backdrop/still when there is one, otherwise generated art in the
 * title's own colours (so a title without metadata still looks intentional).
 */
export default function Art({
    t,
    kind = "poster",
    src,
    label = true,
    big = false,
    style,
}: {
    t: Pick<TitleLite, "id" | "name" | "type" | "year" | "poster" | "backdrop">;
    kind?: "poster" | "backdrop";
    src?: string | null; // explicit image (episode still)
    label?: boolean;
    big?: boolean;
    style?: CSSProperties;
}) {
    const p = palette(t.id);
    const img = src ?? (kind === "backdrop" ? t.backdrop ?? t.poster : t.poster ?? t.backdrop);
    return (
        <div
            className={`art grain ${p.motif}${img ? " has-img" : ""}`}
            style={{ ["--a" as string]: p.a, ["--b" as string]: p.b, ["--c" as string]: p.c, ...style }}
        >
            {img && (
                // eslint-disable-next-line @next/next/no-img-element -- TMDB serves sized images already
                <img className="art-img" src={img} alt="" loading="lazy" decoding="async" draggable={false} />
            )}
            {label && (
                <>
                    <span className="art-type">{t.type === "movie" ? "Film" : "Series"}</span>
                    <div className="art-title" style={big ? { fontSize: "clamp(28px,8cqi,54px)" } : undefined}>
                        {t.name}
                        {t.year ? <small>{t.year}</small> : null}
                    </div>
                </>
            )}
        </div>
    );
}
