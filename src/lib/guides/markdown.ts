/**
 * The guides' Markdown, read into a tree the page renders itself.
 *
 * A guide is written in the console as Markdown (headings, paragraphs, lists,
 * bold, links, a table for the fees) and shown on /guides. Nothing here ever
 * produces HTML: the tree is rendered as React elements
 * (src/components/guides/Markdown.tsx), so a `<script>` pasted into the
 * editor is text on the page and nothing else, and a link only becomes a link
 * when its address is one we would send a reader to (`safeHref`).
 *
 * The dialect is the common part of Markdown, enough for an article and small
 * enough to be read in one sitting:
 *
 *   # / ## / ### / ####    headings — `#` is shown as a second-level heading,
 *                          since the guide's title is already the page's h1
 *   paragraphs             blank-line separated; a single newline is a space
 *   - item · 1. item       lists, one level of nesting by two spaces
 *   > quote                a callout (« À vérifier auprès du notaire »)
 *   | a | b |              a table with a `| --- |` line under its header
 *   ---                    a rule
 *   ```                    a code block (kept literal)
 *   **bold** *italic* `code` [text](https://…)  bare https://… links
 *
 * Pure: no React, no DOM, so the rules are tested on strings.
 */

export type Inline =
  | { t: "text"; v: string }
  | { t: "strong"; c: Inline[] }
  | { t: "em"; c: Inline[] }
  | { t: "code"; v: string }
  | { t: "link"; href: string; c: Inline[] }
  | { t: "br" };

export type ListItem = { c: Inline[]; sub?: { ordered: boolean; items: Inline[][] } };

export type Block =
  | { t: "heading"; level: 2 | 3 | 4; id: string; text: string; c: Inline[] }
  | { t: "paragraph"; c: Inline[] }
  | { t: "list"; ordered: boolean; items: ListItem[] }
  | { t: "quote"; c: Block[] }
  | { t: "table"; head: Inline[][]; rows: Inline[][][] }
  | { t: "rule" }
  | { t: "code"; v: string };

export type Heading = { id: string; text: string; level: 2 | 3 | 4 };

// ─── Links ──────────────────────────────────────────────────────────────────

/**
 * The address a link may point at, or null. Web pages, e-mail and phone
 * links, the site's own paths and anchors; never `javascript:`, `data:` or a
 * protocol-relative `//host` that would leave the site unnoticed.
 */
export function safeHref(raw: string): string | null {
  const s = raw.trim();
  if (!s || s.length > 600 || /[\s<>"']/.test(s)) return null;
  if (s.startsWith("#")) return s.length > 1 ? s : null;
  if (s.startsWith("/")) return s.startsWith("//") ? null : s;
  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(s)?.[1]?.toLowerCase();
  if (!scheme) return null;
  if (scheme === "http" || scheme === "https") {
    try {
      const u = new URL(s);
      if (u.username || u.password || !u.hostname.includes(".")) return null;
      return u.href;
    } catch {
      return null;
    }
  }
  if (scheme === "mailto") return /^mailto:[^@\s]+@[^@\s]+\.[^@\s]+$/i.test(s) ? s : null;
  if (scheme === "tel") return /^tel:\+?[\d\s().-]{6,20}$/.test(s) ? s : null;
  return null;
}

/** Whether a safe href leaves the site (opens in a new tab, with `rel`). */
export function isExternalHref(href: string): boolean {
  return /^https?:/i.test(href);
}

// ─── Inline parsing ─────────────────────────────────────────────────────────

const BARE_URL = /^https?:\/\/[^\s<>()[\]"']+/i;

function pushText(out: Inline[], text: string): void {
  if (!text) return;
  const last = out[out.length - 1];
  if (last && last.t === "text") last.v += text;
  else out.push({ t: "text", v: text });
}

/** Where `close` next occurs in `s` from `from`, outside of a backtick span; -1 when absent. */
function findClose(s: string, close: string, from: number): number {
  let i = from;
  while (i < s.length) {
    if (s[i] === "\\") {
      i += 2;
      continue;
    }
    if (s[i] === "`") {
      const end = s.indexOf("`", i + 1);
      if (end < 0) return -1;
      i = end + 1;
      continue;
    }
    if (s.startsWith(close, i)) return i;
    i++;
  }
  return -1;
}

const isWordChar = (ch: string | undefined) => !!ch && /[\p{L}\p{N}]/u.test(ch);

export function parseInline(src: string): Inline[] {
  const out: Inline[] = [];
  let buf = "";
  let i = 0;
  const flush = () => {
    pushText(out, buf);
    buf = "";
  };

  while (i < src.length) {
    const ch = src[i];

    // Escapes: a backslash before punctuation keeps the character itself.
    if (ch === "\\" && i + 1 < src.length && /[\\`*_{}[\]()#+\-.!|>~]/.test(src[i + 1])) {
      buf += src[i + 1];
      i += 2;
      continue;
    }

    // A hard line break: a backslash or two spaces before a newline.
    if (ch === "\n") {
      if (buf.endsWith("  ") || buf.endsWith("\\")) {
        buf = buf.replace(/( {2}|\\)$/, "");
        flush();
        out.push({ t: "br" });
      } else {
        buf += " ";
      }
      i++;
      continue;
    }

    if (ch === "`") {
      const end = src.indexOf("`", i + 1);
      if (end > i + 1) {
        flush();
        out.push({ t: "code", v: src.slice(i + 1, end) });
        i = end + 1;
        continue;
      }
    }

    if (ch === "*" || ch === "_") {
      const double = src[i + 1] === ch;
      const mark = double ? ch + ch : ch;
      // `_` only marks emphasis at a word's edge, so snake_case stays itself.
      const edgeOk = ch === "*" || !isWordChar(src[i - 1]);
      const after = src[i + mark.length];
      if (edgeOk && after !== undefined && !/\s/.test(after) && after !== ch) {
        const end = findClose(src, mark, i + mark.length);
        if (end > i + mark.length && !/\s/.test(src[end - 1]) && (ch === "*" || !isWordChar(src[end + mark.length]))) {
          flush();
          const inner = parseInline(src.slice(i + mark.length, end));
          out.push(double ? { t: "strong", c: inner } : { t: "em", c: inner });
          i = end + mark.length;
          continue;
        }
      }
    }

    if (ch === "[") {
      const close = findClose(src, "]", i + 1);
      if (close > i && src[close + 1] === "(") {
        // The address ends at the parenthesis that closes the link's own —
        // `javascript:alert(1)` keeps its inner pair, and nothing of it leaks as text.
        let end = -1;
        for (let k = close + 2, depth = 0; k < src.length; k++) {
          const c = src[k];
          if (c === "\n") break;
          if (c === "(") depth++;
          else if (c === ")") {
            if (depth === 0) {
              end = k;
              break;
            }
            depth--;
          }
        }
        if (end > close + 1) {
          const target = src.slice(close + 2, end).trim().replace(/\s+["'].*$/, "");
          const href = safeHref(target);
          const label = src.slice(i + 1, close);
          flush();
          if (href) out.push({ t: "link", href, c: parseInline(label) });
          else out.push(...parseInline(label));
          i = end + 1;
          continue;
        }
      }
    }

    if (ch === "<" ) {
      const m = /^<(https?:\/\/[^\s<>]+)>/i.exec(src.slice(i));
      if (m) {
        const href = safeHref(m[1]);
        flush();
        if (href) out.push({ t: "link", href, c: [{ t: "text", v: m[1] }] });
        else buf += m[1];
        i += m[0].length;
        continue;
      }
    }

    if (ch === "h" && (src.startsWith("https://", i) || src.startsWith("http://", i)) && !isWordChar(src[i - 1])) {
      const m = BARE_URL.exec(src.slice(i));
      if (m) {
        // A sentence's full stop or comma after the address is not part of it.
        const raw = m[0].replace(/[.,;:!?]+$/, "");
        const href = safeHref(raw);
        if (href) {
          flush();
          out.push({ t: "link", href, c: [{ t: "text", v: raw }] });
          i += raw.length;
          continue;
        }
      }
    }

    buf += ch;
    i++;
  }
  flush();
  return out;
}

// ─── Block parsing ──────────────────────────────────────────────────────────

const HEADING = /^(#{1,6})\s+(.+?)\s*#*\s*$/;
const RULE = /^(?:-{3,}|\*{3,}|_{3,})\s*$/;
const LIST_ITEM = /^(\s*)(?:([-*+])|(\d{1,3})[.)])\s+(.*)$/;
const FENCE = /^```/;
const TABLE_SEP = /^\s*\|?\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)*\|?\s*$/;

function isBlank(line: string): boolean {
  return line.trim() === "";
}

function startsBlock(line: string): boolean {
  return HEADING.test(line) || RULE.test(line) || LIST_ITEM.test(line) || FENCE.test(line) || line.trimStart().startsWith(">");
}

/** Table cells of one row, outside-pipe optional, `\|` kept as a pipe. */
function splitCells(line: string): string[] {
  const cells: string[] = [];
  let cur = "";
  const s = line.trim().replace(/^\|/, "").replace(/\|$/, "");
  for (let i = 0; i < s.length; i++) {
    if (s[i] === "\\" && s[i + 1] === "|") {
      cur += "|";
      i++;
    } else if (s[i] === "|") {
      cells.push(cur.trim());
      cur = "";
    } else cur += s[i];
  }
  cells.push(cur.trim());
  return cells;
}

/** The text of inline nodes, for ids, reading time and snippets. */
export function inlineText(nodes: readonly Inline[]): string {
  return nodes
    .map((n) => {
      switch (n.t) {
        case "text":
        case "code":
          return n.v;
        case "br":
          return " ";
        default:
          return inlineText(n.c);
      }
    })
    .join("");
}

/**
 * A heading's anchor: its words, lowercased, joined by dashes — in whichever
 * script they are written (an Arabic heading keeps its letters, which an
 * address fragment carries fine). Unique within the article.
 */
export function headingId(text: string, taken: Set<string>): string {
  const base =
    text
      // Latin accents fold (« Étape » → etape); Arabic letters recompose
      // (NFC) so a hamza stays part of its letter, and the vowel marks go.
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .normalize("NFC")
      .replace(/[ً-ْٰـ]/g, "")
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60)
      .replace(/-+$/g, "") || "section";
  let id = base;
  for (let n = 2; taken.has(id); n++) id = `${base}-${n}`;
  taken.add(id);
  return id;
}

export function parseMarkdown(src: string): Block[] {
  const lines = src.replace(/\r\n?/g, "\n").replace(/\t/g, "    ").split("\n");
  const taken = new Set<string>();
  return parseBlocks(lines, taken);
}

function parseBlocks(lines: string[], taken: Set<string>): Block[] {
  const out: Block[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    if (isBlank(line)) {
      i++;
      continue;
    }

    if (FENCE.test(line)) {
      const buf: string[] = [];
      i++;
      while (i < lines.length && !FENCE.test(lines[i])) buf.push(lines[i++]);
      i++; // the closing fence, if any
      out.push({ t: "code", v: buf.join("\n") });
      continue;
    }

    const h = HEADING.exec(line);
    if (h) {
      const level = Math.min(4, Math.max(2, h[1].length)) as 2 | 3 | 4;
      const c = parseInline(h[2]);
      const text = inlineText(c).trim();
      out.push({ t: "heading", level, id: headingId(text, taken), text, c });
      i++;
      continue;
    }

    if (RULE.test(line)) {
      out.push({ t: "rule" });
      i++;
      continue;
    }

    if (line.trimStart().startsWith(">")) {
      const buf: string[] = [];
      while (i < lines.length && (lines[i].trimStart().startsWith(">") || (!isBlank(lines[i]) && buf.length > 0 && !startsBlock(lines[i])))) {
        buf.push(lines[i].trimStart().replace(/^>\s?/, ""));
        i++;
      }
      out.push({ t: "quote", c: parseBlocks(buf, taken) });
      continue;
    }

    const li = LIST_ITEM.exec(line);
    if (li) {
      const ordered = li[3] !== undefined;
      const items: ListItem[] = [];
      while (i < lines.length) {
        const m = LIST_ITEM.exec(lines[i]);
        if (!m) {
          // A continuation line indented under the item, or lazy text.
          if (!isBlank(lines[i]) && /^\s{2,}/.test(lines[i]) && items.length > 0 && !startsBlock(lines[i].trim())) {
            const last = items[items.length - 1];
            if (last.sub && last.sub.items.length > 0) {
              const subLast = last.sub.items[last.sub.items.length - 1];
              subLast.push(...parseInline(" " + lines[i].trim()));
            } else last.c.push(...parseInline(" " + lines[i].trim()));
            i++;
            continue;
          }
          break;
        }
        const indent = m[1].length;
        const itemOrdered = m[3] !== undefined;
        if (indent >= 2 && items.length > 0) {
          const parent = items[items.length - 1];
          parent.sub ??= { ordered: itemOrdered, items: [] };
          parent.sub.items.push(parseInline(m[4]));
        } else {
          if (itemOrdered !== ordered && items.length > 0) break; // a new list of the other kind
          items.push({ c: parseInline(m[4]) });
        }
        i++;
      }
      out.push({ t: "list", ordered, items });
      continue;
    }

    if (line.includes("|") && i + 1 < lines.length && TABLE_SEP.test(lines[i + 1]) && lines[i + 1].includes("-")) {
      const head = splitCells(line).map(parseInline);
      i += 2;
      const rows: Inline[][][] = [];
      while (i < lines.length && !isBlank(lines[i]) && lines[i].includes("|")) {
        const cells = splitCells(lines[i]).map(parseInline);
        // Ragged rows are squared to the header: never a cell too many.
        while (cells.length < head.length) cells.push([]);
        rows.push(cells.slice(0, head.length));
        i++;
      }
      out.push({ t: "table", head, rows });
      continue;
    }

    // A paragraph: until a blank line or the start of another block.
    const buf = [line.trim()];
    i++;
    while (i < lines.length && !isBlank(lines[i]) && !startsBlock(lines[i]) && !(lines[i].includes("|") && i + 1 < lines.length && TABLE_SEP.test(lines[i + 1]))) {
      buf.push(lines[i].trim());
      i++;
    }
    out.push({ t: "paragraph", c: parseInline(buf.join("\n")) });
  }
  return out;
}

// ─── Reading the tree ───────────────────────────────────────────────────────

/** Every word of the article, for the reading time and a fallback snippet. */
export function plainText(blocks: readonly Block[]): string {
  const parts: string[] = [];
  const walk = (bs: readonly Block[]) => {
    for (const b of bs) {
      switch (b.t) {
        case "heading":
        case "paragraph":
          parts.push(inlineText(b.c));
          break;
        case "list":
          for (const it of b.items) {
            parts.push(inlineText(it.c));
            for (const s of it.sub?.items ?? []) parts.push(inlineText(s));
          }
          break;
        case "quote":
          walk(b.c);
          break;
        case "table":
          for (const row of [b.head, ...b.rows]) parts.push(row.map(inlineText).join(" "));
          break;
        case "code":
          parts.push(b.v);
          break;
        default:
          break;
      }
    }
  };
  walk(blocks);
  return parts.join("\n").replace(/\s+/g, " ").trim();
}

/** The headings a table of contents lists, in order. */
export function outline(blocks: readonly Block[]): Heading[] {
  return blocks.flatMap((b) => (b.t === "heading" ? [{ id: b.id, text: b.text, level: b.level }] : []));
}

export function wordCount(text: string): number {
  return text.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
}

/** How long a reader takes — at about 200 words a minute, never under one. */
export function readingMinutes(text: string, wordsPerMinute = 200): number {
  return Math.max(1, Math.round(wordCount(text) / wordsPerMinute));
}
