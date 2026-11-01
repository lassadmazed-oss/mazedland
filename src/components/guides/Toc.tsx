import type { Heading } from "@/lib/guides/markdown";

/**
 * A guide's table of contents: its second- and third-level headings as
 * anchors. Shown in a sticky column on a desktop and folded under the title
 * on a phone (the page decides); only from `guides_toc_min` headings on.
 */
export function Toc({ headings, title, lang }: { headings: readonly Heading[]; title: string; lang: "fr" | "ar" }) {
  return (
    <nav aria-label={title} className="text-[13px]">
      <p className="text-[11px] font-extrabold uppercase tracking-[0.14em] text-subtle">{title}</p>
      <ol lang={lang} dir={lang === "ar" ? "rtl" : "ltr"} className={`mt-3 space-y-2 border-s border-border ${lang === "ar" ? "font-arabic" : ""}`}>
        {headings.map((h) => (
          <li key={h.id} className={h.level === 3 ? "ps-7" : "ps-4"}>
            <a
              href={`#${h.id}`}
              className={`block leading-snug transition hover:text-foreground ${h.level === 3 ? "text-[12.5px] text-subtle" : "font-semibold text-muted"}`}
            >
              {h.text}
            </a>
          </li>
        ))}
      </ol>
    </nav>
  );
}
