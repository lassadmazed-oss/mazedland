"use client";

import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { AdminButton, adminBtn } from "@/components/admin/AdminButton";
import { TextField, TextareaField, Confirm, StatusPill, useAdminAction, EYEBROW } from "@/components/admin/kit";
import { useToast } from "@/components/ui/Toast";
import { useApiError } from "@/lib/useApiError";
import { propertyPhotoUrl } from "@/lib/imageUrl";
import { formatDate } from "@/lib/utils";
import {
  ARTICLE_COVER,
  ARTICLE_LANGS,
  ARTICLE_LIMITS,
  ARTICLE_TAGS,
  SEO_ADVICE,
  articleCoverExt,
  canPublish,
  isArticleSlug,
  isArticleTag,
  langState,
  slugFromTitle,
  type Article,
  type ArticleLang,
  type ArticleTag,
} from "@/lib/guides/articles";
import { parseMarkdown } from "@/lib/guides/markdown";
import { SUGGESTED_HEADINGS } from "@/lib/guides/assist";
import { MarkdownBody } from "@/components/guides/Markdown";
import {
  Bold, ChevronLeft, ExternalLink, Eye, EyeOff, Heading2, ImagePlus, Link2, List, Loader2, Quote, Save, Sparkles, Trash2, X,
} from "lucide-react";

/**
 * Write a guide (0208): the two languages as tabs, the Markdown with its
 * preview beside it, the tags as chips, the cover dropped straight into
 * storage, the search snippet with its counters — and « Aide à la rédaction »,
 * which drafts a section the editor reads before anything is published.
 *
 * The address (slug) is made from the French title as it is typed and can be
 * changed until the guide is created; after that it is fixed, so no link,
 * no sitemap entry and no search result ever breaks.
 */

type LangText = { title: string; excerpt: string; body: string; seoTitle: string; seoDescription: string };

function fromArticle(a: Article | null, lang: ArticleLang): LangText {
  return {
    title: (lang === "fr" ? a?.title_fr : a?.title_ar) ?? "",
    excerpt: (lang === "fr" ? a?.excerpt_fr : a?.excerpt_ar) ?? "",
    body: (lang === "fr" ? a?.body_fr : a?.body_ar) ?? "",
    seoTitle: (lang === "fr" ? a?.seo_title_fr : a?.seo_title_ar) ?? "",
    seoDescription: (lang === "fr" ? a?.seo_description_fr : a?.seo_description_ar) ?? "",
  };
}

const LABEL = "block text-[11.5px] font-semibold uppercase tracking-[0.08em] text-subtle";
const INPUT =
  "w-full rounded-lg border border-border bg-surface-2 px-3 text-[13px] text-foreground placeholder:text-subtle transition focus:border-gold focus:outline-none disabled:opacity-50";

function chip(on: boolean): string {
  return `inline-flex h-8 items-center rounded-full px-3 text-[12px] font-semibold transition ${
    on ? "bg-[var(--gold)] text-[var(--background)]" : "border border-border text-muted hover:border-[var(--gold-soft)] hover:text-[var(--gold)]"
  }`;
}

const TOOL = "inline-flex size-7 items-center justify-center rounded text-muted transition hover:bg-surface-2 hover:text-foreground disabled:opacity-40";

export function ArticleEditor({
  article,
  baseHref,
  cancelHref,
  siteBase,
  aiAssist,
}: {
  /** null = a new guide. */
  article: Article | null;
  /** /<locale>/admin/contenu — next/navigation's router takes it as is. */
  baseHref: string;
  cancelHref: string;
  /** /<locale>/guides, for « Voir la page ». */
  siteBase: string;
  aiAssist: boolean;
}) {
  const t = useTranslations("adminContent");
  const tTags = useTranslations("guides.tags");
  const router = useRouter();
  const { toast } = useToast();
  const apiError = useApiError();
  const { run, pending } = useAdminAction();
  const isNew = article === null;

  const [texts, setTexts] = useState<Record<ArticleLang, LangText>>({ fr: fromArticle(article, "fr"), ar: fromArticle(article, "ar") });
  const [lang, setLang] = useState<ArticleLang>(() =>
    article && langState(article, "fr") === "empty" && langState(article, "ar") !== "empty" ? "ar" : "fr",
  );
  const [slug, setSlug] = useState(article?.slug ?? "");
  const [slugTouched, setSlugTouched] = useState(false);
  const [tags, setTags] = useState<ArticleTag[]>((article?.tags ?? []).filter(isArticleTag));
  const [cover, setCover] = useState<{ path: string; src: string } | null>(
    article?.cover_path ? { path: article.cover_path, src: propertyPhotoUrl(article.cover_path) } : null,
  );
  const [uploading, setUploading] = useState(false);
  const [preview, setPreview] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [assistOpen, setAssistOpen] = useState(false);
  const [assistHeading, setAssistHeading] = useState("");
  const [assistInstruction, setAssistInstruction] = useState("");
  const [assistPending, setAssistPending] = useState(false);
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const caret = useRef<number | null>(null);

  const cur = texts[lang];
  const update = (patch: Partial<LangText>, forLang: ArticleLang = lang) =>
    setTexts((prev) => ({ ...prev, [forLang]: { ...prev[forLang], ...patch } }));

  const effectiveSlug = isNew && !slugTouched ? slugFromTitle(texts.fr.title) : slug;
  const shape = {
    slug: effectiveSlug,
    title_fr: texts.fr.title || null,
    body_fr: texts.fr.body || null,
    title_ar: texts.ar.title || null,
    body_ar: texts.ar.body || null,
  };
  const publishable = canPublish(shape);
  const blocks = useMemo(() => parseMarkdown(cur.body), [cur.body]);
  const maxMb = Math.round(ARTICLE_COVER.maxBytes / 1024 / 1024);

  const missing = isNew && !isArticleSlug(effectiveSlug)
    ? t("editor.missing.slug")
    : uploading
      ? t("editor.missing.uploading")
      : null;

  function payload() {
    return {
      ...(isNew ? { slug: effectiveSlug } : {}),
      title_fr: texts.fr.title,
      excerpt_fr: texts.fr.excerpt,
      body_fr: texts.fr.body,
      seo_title_fr: texts.fr.seoTitle,
      seo_description_fr: texts.fr.seoDescription,
      title_ar: texts.ar.title,
      excerpt_ar: texts.ar.excerpt,
      body_ar: texts.ar.body,
      seo_title_ar: texts.ar.seoTitle,
      seo_description_ar: texts.ar.seoDescription,
      tags,
      cover_path: cover?.path ?? null,
    };
  }

  async function save(status?: "draft" | "published") {
    const created = { id: "" };
    const ok = await run({
      url: isNew ? "/api/admin/content" : `/api/admin/content/${article.id}`,
      method: isNew ? "POST" : "PATCH",
      body: { ...payload(), ...(status ? { status } : {}) },
      success:
        status === "published" ? t("editor.publishedToast") : status === "draft" ? t("editor.unpublishedToast") : isNew ? t("editor.created") : t("editor.saved"),
      onSuccess: (data) => {
        created.id = (data as { id?: string }).id ?? "";
      },
    });
    if (ok && isNew && created.id) router.push(`${baseHref}?a=${created.id}`);
  }

  async function remove() {
    if (isNew) return;
    const ok = await run({ url: `/api/admin/content/${article.id}`, method: "DELETE", success: t("editor.deleted") });
    setConfirmDelete(false);
    if (ok) router.push(cancelHref);
  }

  async function upload(file: File) {
    const ext = articleCoverExt(file.type || file.name);
    if (!ext) return toast(t("editor.badType"), "error");
    if (file.size > ARTICLE_COVER.maxBytes) return toast(t("editor.tooBig", { max: maxMb }), "error");
    setUploading(true);
    try {
      const res = await fetch("/api/admin/content/upload-url", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ext, size: file.size }),
      });
      const j = (await res.json().catch(() => ({}))) as { path?: string; signedUrl?: string; detail?: string };
      if (!res.ok || !j.path || !j.signedUrl) return toast(j.detail ?? t("editor.uploadFailed"), "error");
      // Multipart with an empty field name is what a signed upload expects
      // (see PhotoUploader); the path is unique, so the file can be cached a year.
      const form = new FormData();
      form.append("cacheControl", "31536000");
      form.append("", file);
      const put = await fetch(j.signedUrl, { method: "PUT", body: form });
      if (!put.ok) return toast(t("editor.uploadFailed"), "error");
      const src = URL.createObjectURL(file);
      setCover((prev) => {
        if (prev?.src.startsWith("blob:")) URL.revokeObjectURL(prev.src);
        return { path: j.path!, src };
      });
    } catch {
      toast(t("editor.uploadFailed"), "error");
    } finally {
      setUploading(false);
    }
  }

  /** Puts `md` where the caret last was in the body, else at its end. */
  function insertMarkdown(md: string) {
    const body = cur.body;
    const at = caret.current ?? body.length;
    const before = body.slice(0, at).replace(/\s+$/, "");
    const after = body.slice(at).replace(/^\s+/, "");
    update({ body: [before, md.trim(), after].filter(Boolean).join("\n\n") });
  }

  /** Wraps the selection, or prefixes the line, in the body textarea. */
  function tool(kind: "h2" | "bold" | "list" | "quote" | "link") {
    const ta = bodyRef.current;
    const body = cur.body;
    const start = ta?.selectionStart ?? body.length;
    const end = ta?.selectionEnd ?? body.length;
    const sel = body.slice(start, end);
    let next: string;
    let caretAt: number;
    if (kind === "bold") {
      const word = sel || t("editor.tools.boldSample");
      next = `${body.slice(0, start)}**${word}**${body.slice(end)}`;
      caretAt = start + word.length + 4;
    } else if (kind === "link") {
      const word = sel || t("editor.tools.linkSample");
      next = `${body.slice(0, start)}[${word}](https://)${body.slice(end)}`;
      caretAt = start + word.length + 3;
    } else {
      const prefix = kind === "h2" ? "## " : kind === "list" ? "- " : "> ";
      const lineStart = body.lastIndexOf("\n", start - 1) + 1;
      const needsGap = lineStart > 0 && body[lineStart - 1] === "\n" && body[lineStart - 2] !== "\n" && kind === "h2";
      next = `${body.slice(0, lineStart)}${needsGap ? "\n" : ""}${prefix}${body.slice(lineStart)}`;
      caretAt = start + prefix.length + (needsGap ? 1 : 0);
    }
    update({ body: next });
    caret.current = caretAt;
    requestAnimationFrame(() => {
      ta?.focus();
      ta?.setSelectionRange(caretAt, caretAt);
    });
  }

  async function assist(whole: boolean) {
    const title = cur.title.trim() || texts.fr.title.trim() || texts.ar.title.trim();
    if (!title) return toast(t("editor.assist.needTitle"), "error");
    if (!whole && !assistHeading.trim()) return toast(t("editor.assist.needHeading"), "error");
    setAssistPending(true);
    try {
      const res = await fetch("/api/admin/content/assist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          language: lang,
          title,
          tags,
          heading: whole ? null : assistHeading.trim(),
          instruction: assistInstruction.trim() || null,
          existing: cur.body,
        }),
      });
      const j = (await res.json().catch(() => ({}))) as { markdown?: string };
      if (!res.ok || !j.markdown) return toast(apiError(j, t("editor.assist.failed")), "error");
      insertMarkdown(j.markdown);
      setAssistOpen(false);
      setAssistHeading("");
      setAssistInstruction("");
      toast(t("editor.assist.inserted"), "success");
    } catch {
      toast(t("editor.assist.failed"), "error");
    } finally {
      setAssistPending(false);
    }
  }

  const counter = (n: number, max: number, advice?: number) =>
    advice ? t("editor.counterAdvice", { n, max, advice }) : t("editor.counter", { n, max });

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="shrink-0 border-b border-border px-5 py-3.5">
        <a href={cancelHref} className="mb-2 inline-flex items-center gap-1 text-[12px] font-medium text-subtle transition hover:text-foreground lg:hidden">
          <ChevronLeft className="size-3.5 rtl:-scale-x-100" strokeWidth={2.4} />
          {t("editor.back")}
        </a>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <h2 dir="auto" className="truncate text-[16px] font-semibold tracking-tight text-foreground">
            {isNew ? t("editor.newTitle") : cur.title || texts.fr.title || texts.ar.title || article.slug}
          </h2>
          {!isNew && <StatusPill tone={article.status === "published" ? "ok" : "neutral"}>{t(`status.${article.status}`)}</StatusPill>}
        </div>
        {!isNew && (
          <p className="mt-1 text-[11.5px] text-subtle">
            {article.status === "published" && article.published_at
              ? t("publishedOn", { date: formatDate(article.published_at, "fr", "medium") })
              : t("updated", { date: formatDate(article.updated_at, "fr", "medium") })}
            {" · "}
            <a href={`${siteBase}/${article.slug}`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 font-medium text-foreground/80 hover:text-[var(--gold)] hover:underline">
              <span dir="ltr">/guides/{article.slug}</span>
              <ExternalLink className="size-3" />
            </a>
          </p>
        )}
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-4">
        <div className="space-y-5">
          {/* Which language is being written: both are kept, one is shown. */}
          <div role="tablist" aria-label={t("editor.language")} className="mazed-segment inline-flex rounded-full bg-surface-2 p-1 ring-1 ring-border">
            {ARTICLE_LANGS.map((l) => {
              const state = langState(shape, l);
              return (
                <button
                  key={l}
                  type="button"
                  role="tab"
                  aria-selected={l === lang}
                  onClick={() => setLang(l)}
                  className={`inline-flex h-8 items-center gap-1.5 rounded-full px-3.5 text-[12.5px] font-semibold transition ${
                    l === lang ? "bg-[var(--gold)] text-[var(--background)]" : "text-muted hover:text-foreground"
                  }`}
                >
                  {t(`editor.langTab.${l}`)}
                  <span
                    aria-label={t(`langState.${state}`)}
                    title={t(`langState.${state}`)}
                    className={`size-[6px] rounded-full ${state === "complete" ? "bg-[var(--tone-ok)]" : state === "partial" ? "bg-[var(--tone-warn)]" : "bg-[var(--foreground-subtle)]"}`}
                  />
                </button>
              );
            })}
          </div>

          <TextField
            label={t("editor.title")}
            value={cur.title}
            onChange={(v) => update({ title: v })}
            required
            dir={lang === "ar" ? "rtl" : "ltr"}
            placeholder={t(`editor.titlePlaceholder.${lang}`)}
            hint={counter(cur.title.length, ARTICLE_LIMITS.title)}
          />

          {/* The address: from the French title until the guide exists. */}
          {isNew ? (
            <TextField
              label={t("editor.slug")}
              type="text"
              dir="ltr"
              value={effectiveSlug}
              onChange={(v) => {
                setSlugTouched(true);
                setSlug(v.toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/-{2,}/g, "-").replace(/^-+/, ""));
              }}
              required
              placeholder={t("editor.slugPlaceholder")}
              error={effectiveSlug && !isArticleSlug(effectiveSlug) ? t("editor.slugInvalid") : null}
              hint={<span dir="ltr">{siteBase}/{effectiveSlug || "…"}</span>}
            />
          ) : null}

          <TextareaField
            label={t("editor.excerpt")}
            value={cur.excerpt}
            onChange={(v) => update({ excerpt: v })}
            rows={2}
            dir={lang === "ar" ? "rtl" : "ltr"}
            placeholder={t(`editor.excerptPlaceholder.${lang}`)}
            hint={`${t("editor.excerptHint")} · ${counter(cur.excerpt.length, ARTICLE_LIMITS.excerpt)}`}
          />

          {/* The body: Markdown, with its tools, the preview and the AI beside it. */}
          <section>
            <div className="flex flex-wrap items-center gap-1">
              <p className={LABEL}>
                {t("editor.body")}
                <span className="ms-1 text-[var(--tone-bad)]">*</span>
              </p>
              <div className="ms-auto flex items-center gap-0.5">
                <button type="button" className={TOOL} title={t("editor.tools.h2")} aria-label={t("editor.tools.h2")} onClick={() => tool("h2")}>
                  <Heading2 className="size-4" />
                </button>
                <button type="button" className={TOOL} title={t("editor.tools.bold")} aria-label={t("editor.tools.bold")} onClick={() => tool("bold")}>
                  <Bold className="size-4" />
                </button>
                <button type="button" className={TOOL} title={t("editor.tools.list")} aria-label={t("editor.tools.list")} onClick={() => tool("list")}>
                  <List className="size-4" />
                </button>
                <button type="button" className={TOOL} title={t("editor.tools.quote")} aria-label={t("editor.tools.quote")} onClick={() => tool("quote")}>
                  <Quote className="size-4" />
                </button>
                <button type="button" className={TOOL} title={t("editor.tools.link")} aria-label={t("editor.tools.link")} onClick={() => tool("link")}>
                  <Link2 className="size-4" />
                </button>
                <span className="mx-1 h-4 w-px bg-border" aria-hidden />
                {aiAssist && (
                  <button
                    type="button"
                    onClick={() => setAssistOpen((o) => !o)}
                    aria-expanded={assistOpen}
                    className={`inline-flex h-7 items-center gap-1.5 rounded-full px-2.5 text-[12px] font-semibold transition ${
                      assistOpen ? "bg-[var(--gold)] text-[var(--background)]" : "border border-border text-foreground hover:border-[var(--gold-soft)]"
                    }`}
                  >
                    <Sparkles className="size-3.5" strokeWidth={2.2} />
                    {t("editor.assist.button")}
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setPreview((p) => !p)}
                  aria-pressed={preview}
                  className="inline-flex h-7 items-center gap-1.5 rounded-full border border-border px-2.5 text-[12px] font-semibold text-foreground transition hover:border-[var(--gold-soft)]"
                >
                  {preview ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
                  {preview ? t("editor.hidePreview") : t("editor.preview")}
                </button>
              </div>
            </div>

            {assistOpen && aiAssist && (
              <div className="mt-2 rounded-xl border border-border bg-surface-2/60 p-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-[13px] font-semibold text-foreground">{t("editor.assist.title")}</p>
                    <p className="mt-0.5 text-[11.5px] text-muted">{t("editor.assist.hint")}</p>
                  </div>
                  <button type="button" onClick={() => setAssistOpen(false)} aria-label={t("editor.assist.close")} className={TOOL}>
                    <X className="size-4" />
                  </button>
                </div>
                <p className={`${LABEL} mt-3`}>{t("editor.assist.heading")}</p>
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {SUGGESTED_HEADINGS[lang].map((h) => (
                    <button key={h} type="button" onClick={() => setAssistHeading(h)} className={chip(assistHeading === h)} dir={lang === "ar" ? "rtl" : "ltr"}>
                      {h}
                    </button>
                  ))}
                </div>
                <input
                  type="text"
                  value={assistHeading}
                  onChange={(e) => setAssistHeading(e.target.value)}
                  dir={lang === "ar" ? "rtl" : "ltr"}
                  placeholder={t("editor.assist.headingPlaceholder")}
                  className={`${INPUT} mt-2 h-9`}
                />
                <textarea
                  value={assistInstruction}
                  onChange={(e) => setAssistInstruction(e.target.value)}
                  rows={2}
                  dir="auto"
                  placeholder={t("editor.assist.instructionPlaceholder")}
                  className={`${INPUT} mt-2 resize-y py-2`}
                />
                <div className="mt-2 flex flex-wrap items-center gap-1.5">
                  <AdminButton variant="primary" pending={assistPending} icon={<Sparkles className="size-3.5" />} onClick={() => assist(false)} disabled={!assistHeading.trim()} disabledReason={t("editor.assist.needHeading")}>
                    {t("editor.assist.writeSection")}
                  </AdminButton>
                  {!cur.body.trim() && (
                    <AdminButton variant="default" pending={assistPending} onClick={() => assist(true)}>
                      {t("editor.assist.writeAll")}
                    </AdminButton>
                  )}
                  {assistPending && <span className="text-[11.5px] text-subtle">{t("editor.assist.pending")}</span>}
                </div>
              </div>
            )}

            <div className={`mt-2 grid gap-3 ${preview ? "xl:grid-cols-2" : ""}`}>
              <textarea
                ref={bodyRef}
                value={cur.body}
                onChange={(e) => {
                  caret.current = e.target.selectionStart;
                  update({ body: e.target.value });
                }}
                onSelect={(e) => {
                  caret.current = (e.target as HTMLTextAreaElement).selectionEnd;
                }}
                onBlur={(e) => {
                  caret.current = e.target.selectionEnd;
                }}
                rows={18}
                dir={lang === "ar" ? "rtl" : "ltr"}
                spellCheck
                placeholder={t(`editor.bodyPlaceholder.${lang}`)}
                className={`${INPUT} min-h-[360px] resize-y py-3 leading-relaxed ${lang === "ar" ? "font-arabic" : ""}`}
              />
              {preview && (
                <div className="min-h-[360px] overflow-y-auto rounded-lg border border-border bg-background px-5 py-4" aria-label={t("editor.preview")}>
                  {cur.body.trim() ? (
                    <MarkdownBody blocks={blocks} lang={lang} />
                  ) : (
                    <p className="text-[12.5px] text-subtle">{t("editor.previewEmpty")}</p>
                  )}
                </div>
              )}
            </div>
            <p className="mt-1 text-[11.5px] text-muted">
              {t("editor.bodyHint")} · {counter(cur.body.length, ARTICLE_LIMITS.body)}
            </p>
          </section>

          <section className="border-t border-border pt-4">
            <h3 className={EYEBROW}>{t("editor.tags")}</h3>
            <p className="mt-0.5 text-[11.5px] text-muted">{t("editor.tagsHint")}</p>
            <div role="group" aria-label={t("editor.tags")} className="mt-2 flex flex-wrap gap-1.5">
              {ARTICLE_TAGS.map((tag) => {
                const on = tags.includes(tag);
                return (
                  <button
                    key={tag}
                    type="button"
                    aria-pressed={on}
                    onClick={() => setTags((prev) => (on ? prev.filter((x) => x !== tag) : prev.length < ARTICLE_LIMITS.tags ? [...prev, tag] : prev))}
                    className={chip(on)}
                  >
                    {tTags(tag)}
                  </button>
                );
              })}
            </div>
          </section>

          <section className="border-t border-border pt-4">
            <h3 className={EYEBROW}>{t("editor.cover")}</h3>
            <p className="mt-0.5 text-[11.5px] text-muted">{t("editor.coverHint", { width: ARTICLE_COVER.width, height: ARTICLE_COVER.height, max: maxMb })}</p>
            <div className="mt-2 max-w-md">
              <div className="relative aspect-[16/9] overflow-hidden rounded-lg bg-surface-2 ring-1 ring-border">
                {cover ? (
                  // A blob: preview of the file just picked, or the stored cover —
                  // next/image cannot take the first.
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={cover.src} alt="" className="size-full object-cover" />
                ) : (
                  <button
                    type="button"
                    onClick={() => fileRef.current?.click()}
                    disabled={uploading}
                    className="flex size-full flex-col items-center justify-center gap-1 text-[12px] font-semibold text-subtle transition hover:text-foreground disabled:opacity-50"
                  >
                    <ImagePlus className="size-4" strokeWidth={2} />
                    {t("editor.choose")}
                  </button>
                )}
                {uploading && (
                  <span className="absolute inset-0 grid place-items-center bg-black/50 text-[12px] font-semibold text-white">
                    <span className="inline-flex items-center gap-1.5">
                      <Loader2 className="size-3.5 animate-spin" />
                      {t("editor.uploading")}
                    </span>
                  </span>
                )}
              </div>
              <input
                ref={fileRef}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  e.target.value = "";
                  if (f) void upload(f);
                }}
              />
              {cover && (
                <div className="mt-1.5 flex gap-1.5">
                  <button type="button" onClick={() => fileRef.current?.click()} disabled={uploading} className={adminBtn("default", "sm")}>
                    {t("editor.replace")}
                  </button>
                  <button type="button" onClick={() => setCover(null)} disabled={uploading} className={adminBtn("quiet", "sm")}>
                    {t("editor.remove")}
                  </button>
                </div>
              )}
            </div>
          </section>

          <section className="border-t border-border pt-4">
            <h3 className={EYEBROW}>{t("editor.seo")}</h3>
            <p className="mt-0.5 text-[11.5px] text-muted">{t("editor.seoHint")}</p>
            <div className="mt-3 space-y-4">
              <TextField
                label={t("editor.seoTitle")}
                value={cur.seoTitle}
                onChange={(v) => update({ seoTitle: v })}
                dir={lang === "ar" ? "rtl" : "ltr"}
                placeholder={cur.title || t(`editor.titlePlaceholder.${lang}`)}
                hint={counter(cur.seoTitle.length, ARTICLE_LIMITS.seoTitle, SEO_ADVICE.title)}
              />
              <TextareaField
                label={t("editor.seoDescription")}
                value={cur.seoDescription}
                onChange={(v) => update({ seoDescription: v })}
                rows={2}
                dir={lang === "ar" ? "rtl" : "ltr"}
                placeholder={cur.excerpt || t(`editor.excerptPlaceholder.${lang}`)}
                hint={counter(cur.seoDescription.length, ARTICLE_LIMITS.seoDescription, SEO_ADVICE.description)}
              />
            </div>
          </section>
        </div>
      </div>

      <footer className="flex shrink-0 flex-wrap items-center gap-1.5 border-t border-border px-5 py-3">
        <AdminButton
          variant="primary"
          pending={pending}
          disabled={missing !== null}
          disabledReason={missing ?? undefined}
          icon={<Save className="size-3.5" strokeWidth={2.4} />}
          onClick={() => save()}
        >
          {isNew ? t("editor.create") : t("editor.save")}
        </AdminButton>
        {!isNew && article.status === "draft" && (
          <AdminButton
            variant="default"
            pending={pending}
            disabled={!publishable || missing !== null}
            disabledReason={!publishable ? t("editor.missing.complete") : missing ?? undefined}
            onClick={() => save("published")}
          >
            {t("editor.publish")}
          </AdminButton>
        )}
        {!isNew && article.status === "published" && (
          <AdminButton variant="default" pending={pending} onClick={() => save("draft")}>
            {t("editor.unpublish")}
          </AdminButton>
        )}
        <a href={cancelHref} className={adminBtn("quiet", "sm")}>
          {t("editor.cancel")}
        </a>
        {!isNew && (
          <button type="button" onClick={() => setConfirmDelete(true)} className={`${adminBtn("danger", "sm")} ms-auto`}>
            <Trash2 className="size-3.5" strokeWidth={2.2} />
            {t("editor.delete")}
          </button>
        )}
        {!publishable && (isNew || article.status === "draft") && (
          <span className="basis-full text-[11.5px] text-subtle">{t("editor.missing.complete")}</span>
        )}
      </footer>

      <Confirm
        open={confirmDelete}
        title={t("editor.deleteTitle")}
        body={t("editor.deleteBody")}
        confirmLabel={t("editor.delete")}
        pending={pending}
        onConfirm={remove}
        onCancel={() => setConfirmDelete(false)}
      />
    </div>
  );
}
