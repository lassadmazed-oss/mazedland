import type { ReactNode } from "react";
import { Link } from "@/i18n/navigation";
import { isExternalHref, type Block, type Inline } from "@/lib/guides/markdown";

/**
 * A guide's body, from the tree src/lib/guides/markdown.ts reads — React
 * elements, never an HTML string, so what an editor pasted is text on the
 * page and nothing else. The same component draws the console's live
 * preview and the public page, in the site's own typography.
 */

const HEADING: Record<2 | 3 | 4, string> = {
  2: "mazed-h2 mt-10 scroll-mt-28 text-[22px] text-foreground first:mt-0 lg:text-[26px]",
  3: "mt-8 scroll-mt-28 text-[18px] font-extrabold leading-snug tracking-tight text-foreground lg:text-[20px]",
  4: "mt-6 scroll-mt-28 text-[16px] font-bold leading-snug text-foreground",
};

const TEXT = "text-[16px] leading-[1.8] text-foreground/85 [overflow-wrap:anywhere]";
const LINK = "font-semibold text-foreground underline decoration-foreground/30 underline-offset-4 transition hover:decoration-foreground";

export function renderInline(nodes: readonly Inline[]): ReactNode {
  return nodes.map((n, i) => {
    switch (n.t) {
      case "text":
        return n.v;
      case "br":
        return <br key={i} />;
      case "code":
        return (
          <code key={i} className="rounded bg-surface-2 px-1.5 py-0.5 text-[0.9em] ring-1 ring-border">
            {n.v}
          </code>
        );
      case "strong":
        return (
          <strong key={i} className="font-bold text-foreground">
            {renderInline(n.c)}
          </strong>
        );
      case "em":
        return <em key={i}>{renderInline(n.c)}</em>;
      case "link":
        if (isExternalHref(n.href)) {
          return (
            <a key={i} href={n.href} target="_blank" rel="noopener noreferrer" className={LINK}>
              {renderInline(n.c)}
            </a>
          );
        }
        if (n.href.startsWith("#")) {
          return (
            <a key={i} href={n.href} className={LINK}>
              {renderInline(n.c)}
            </a>
          );
        }
        if (n.href.startsWith("/")) {
          return (
            <Link key={i} href={n.href as never} className={LINK}>
              {renderInline(n.c)}
            </Link>
          );
        }
        // mailto:, tel:
        return (
          <a key={i} href={n.href} className={LINK}>
            {renderInline(n.c)}
          </a>
        );
    }
  });
}

function renderBlocks(blocks: readonly Block[]): ReactNode {
  return blocks.map((b, i) => {
    switch (b.t) {
      case "heading": {
        const Tag = `h${b.level}` as "h2" | "h3" | "h4";
        return (
          <Tag key={i} id={b.id} className={HEADING[b.level]}>
            {renderInline(b.c)}
          </Tag>
        );
      }
      case "paragraph":
        return (
          <p key={i} className={`mt-4 ${TEXT}`}>
            {renderInline(b.c)}
          </p>
        );
      case "list": {
        const Tag = b.ordered ? "ol" : "ul";
        const style = b.ordered ? "list-decimal" : "list-disc";
        return (
          <Tag key={i} className={`mt-4 ${style} space-y-2 ps-6 ${TEXT} marker:text-foreground/50`}>
            {b.items.map((it, j) => (
              <li key={j}>
                {renderInline(it.c)}
                {it.sub && it.sub.items.length > 0 && (
                  (() => {
                    const Sub = it.sub.ordered ? "ol" : "ul";
                    return (
                      <Sub className={`mt-1.5 ${it.sub.ordered ? "list-decimal" : "list-[circle]"} space-y-1 ps-5`}>
                        {it.sub.items.map((s, k) => (
                          <li key={k}>{renderInline(s)}</li>
                        ))}
                      </Sub>
                    );
                  })()
                )}
              </li>
            ))}
          </Tag>
        );
      }
      case "quote":
        return (
          <blockquote
            key={i}
            className="mazed-band-warm mt-6 rounded-2xl border-s-4 border-foreground px-5 py-4 text-[15px] leading-relaxed text-foreground/85 [&>*:first-child]:mt-0"
          >
            {renderBlocks(b.c)}
          </blockquote>
        );
      case "table":
        return (
          <div key={i} className="mt-6 overflow-x-auto rounded-2xl ring-1 ring-border">
            <table className="w-full text-[14px]">
              <thead>
                <tr>
                  {b.head.map((cell, j) => (
                    <th key={j} scope="col" className="bg-surface-2 px-4 py-2.5 text-start text-[11px] font-extrabold uppercase tracking-[0.08em] text-muted">
                      {renderInline(cell)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {b.rows.map((row, r) => (
                  <tr key={r}>
                    {row.map((cell, c) => (
                      <td key={c} className="border-t border-border px-4 py-2.5 align-top leading-relaxed text-foreground/85">
                        {renderInline(cell)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      case "rule":
        return <hr key={i} className="my-8 border-border" />;
      case "code":
        return (
          <pre key={i} className="mt-5 overflow-x-auto rounded-2xl bg-surface-2 p-4 text-[13px] leading-relaxed ring-1 ring-border" dir="ltr">
            <code>{b.v}</code>
          </pre>
        );
    }
  });
}

export function MarkdownBody({
  blocks,
  lang,
  className = "",
}: {
  blocks: readonly Block[];
  /** The text's language: sets the direction and, for Arabic, the font. */
  lang: "fr" | "ar";
  className?: string;
}) {
  return (
    <div lang={lang} dir={lang === "ar" ? "rtl" : "ltr"} className={`${lang === "ar" ? "font-arabic " : ""}${className}`}>
      {renderBlocks(blocks)}
    </div>
  );
}
