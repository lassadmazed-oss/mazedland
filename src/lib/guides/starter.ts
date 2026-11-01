/**
 * The starter guides (docs/guides/*.md): how a file is read, and how the
 * French and Arabic files of one guide are paired.
 *
 * A file is `<slug>.<fr|ar>.md`: a header between two `---` lines (title,
 * excerpt, tags, and the search snippet) and the Markdown body under it.
 * « Importer les guides de départ » in the console reads them and inserts
 * DRAFTS — the owner reads, edits and publishes each one. Pure: the reading of
 * the folder is in starterServer.ts.
 */
import { ARTICLE_LIMITS, isArticleSlug, isArticleTag, type ArticleLang, type ArticleTag } from "./articles";

export type StarterFile = {
  slug: string;
  lang: ArticleLang;
  title: string;
  excerpt: string | null;
  tags: ArticleTag[];
  seoTitle: string | null;
  seoDescription: string | null;
  body: string;
};

export type StarterGuide = {
  slug: string;
  tags: ArticleTag[];
  fr: StarterFile | null;
  ar: StarterFile | null;
};

const NAME = /^([a-z0-9]+(?:-[a-z0-9]+)*)\.(fr|ar)\.md$/;

/** Whether a file of the folder is a guide (the README is not). */
export function starterFileName(name: string): { slug: string; lang: ArticleLang } | null {
  const m = NAME.exec(name);
  return m ? { slug: m[1], lang: m[2] as ArticleLang } : null;
}

/**
 * One file, checked: a title, a body, known tags, lengths within the table's.
 * Throws with the file's name and what is wrong — the test over the folder
 * fails loudly rather than the import inserting a half guide.
 */
export function parseStarter(name: string, text: string): StarterFile {
  const id = starterFileName(name);
  if (!id) throw new Error(`${name}: not a guide file (<slug>.<fr|ar>.md)`);
  if (!isArticleSlug(id.slug)) throw new Error(`${name}: bad slug`);
  const src = text.replace(/^﻿/, "").replace(/\r\n?/g, "\n");
  const m = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/.exec(src);
  if (!m) throw new Error(`${name}: no front matter`);
  const meta: Record<string, string> = {};
  for (const line of m[1].split("\n")) {
    if (!line.trim()) continue;
    const kv = /^([a-z_]+):\s*(.*)$/.exec(line);
    if (!kv) throw new Error(`${name}: bad header line « ${line} »`);
    meta[kv[1]] = kv[2].trim();
  }
  const title = meta.title?.trim();
  if (!title) throw new Error(`${name}: no title`);
  if (title.length > ARTICLE_LIMITS.title) throw new Error(`${name}: title too long`);
  const body = m[2].trim();
  if (!body) throw new Error(`${name}: empty body`);
  if (body.length > ARTICLE_LIMITS.body) throw new Error(`${name}: body too long`);
  const tags = (meta.tags ?? "")
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);
  for (const t of tags) if (!isArticleTag(t)) throw new Error(`${name}: unknown tag « ${t} »`);
  if (tags.length > ARTICLE_LIMITS.tags) throw new Error(`${name}: too many tags`);
  const excerpt = meta.excerpt?.trim() || null;
  if (excerpt && excerpt.length > ARTICLE_LIMITS.excerpt) throw new Error(`${name}: excerpt too long`);
  const seoTitle = meta.seo_title?.trim() || null;
  if (seoTitle && seoTitle.length > ARTICLE_LIMITS.seoTitle) throw new Error(`${name}: seo_title too long`);
  const seoDescription = meta.seo_description?.trim() || null;
  if (seoDescription && seoDescription.length > ARTICLE_LIMITS.seoDescription) throw new Error(`${name}: seo_description too long`);
  return { slug: id.slug, lang: id.lang, title, excerpt, tags: tags as ArticleTag[], seoTitle, seoDescription, body };
}

/**
 * The files of one slug together. The tags are the union of both files'
 * (they should agree; a test says so). Sorted by slug, so the import is the
 * same order every time.
 */
export function pairStarters(files: readonly StarterFile[]): StarterGuide[] {
  const bySlug = new Map<string, StarterGuide>();
  for (const f of files) {
    const g = bySlug.get(f.slug) ?? { slug: f.slug, tags: [], fr: null, ar: null };
    g[f.lang] = f;
    g.tags = [...new Set([...g.tags, ...f.tags])];
    bySlug.set(f.slug, g);
  }
  return [...bySlug.values()].sort((a, b) => a.slug.localeCompare(b.slug));
}

/** The row « Importer » inserts for a guide: a draft, both languages as they are. */
export function starterRow(g: StarterGuide) {
  return {
    slug: g.slug,
    status: "draft" as const,
    source_key: g.slug,
    tags: g.tags,
    title_fr: g.fr?.title ?? null,
    title_ar: g.ar?.title ?? null,
    excerpt_fr: g.fr?.excerpt ?? null,
    excerpt_ar: g.ar?.excerpt ?? null,
    body_fr: g.fr?.body ?? null,
    body_ar: g.ar?.body ?? null,
    seo_title_fr: g.fr?.seoTitle ?? null,
    seo_title_ar: g.ar?.seoTitle ?? null,
    seo_description_fr: g.fr?.seoDescription ?? null,
    seo_description_ar: g.ar?.seoDescription ?? null,
  };
}
