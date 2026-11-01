import { requireAdmin } from "@/lib/admin/session";
import { getLocale, getTranslations } from "next-intl/server";
import Image from "next/image";
import { Link } from "@/i18n/navigation";
import { getServiceSupabase } from "@/lib/supabase/admin";
import { getSettings } from "@/lib/settings/server";
import { adminBtn } from "@/components/admin/AdminButton";
import { FullBleed, EmptyState, QueueKeys, StatusPill, Toolbar, type Tab, type Tone } from "@/components/admin/kit";
import { ROW_BASE, ROW_IDLE, ROW_SELECTED, ROW_FOCUS } from "@/components/admin/kit/surface";
import { propertyPhotoUrl } from "@/lib/imageUrl";
import { formatDate } from "@/lib/utils";
import { ARTICLE_LANGS, langState, type Article, type ArticleStatus, type LangState } from "@/lib/guides/articles";
import { readStarterGuides } from "@/lib/guides/starterServer";
import { ArticleEditor } from "./ArticleEditor";
import { ImportStarter } from "./ImportStarter";
import { BookOpen, Plus } from "lucide-react";

export const dynamic = "force-dynamic";
export const revalidate = 0;

/**
 * Contenu — the guides (0208), written here and read on /guides.
 *
 * The list on the left is every guide, drafts and published, each with its
 * two languages' state (whole, begun, empty); on the right the open guide's
 * editor, or a new one (`?a=new`). « Importer les guides de départ » brings
 * the ten guides written for Tunisia in as drafts, once, for the owner to
 * read and publish one by one.
 */

const TABS = ["all", "draft", "published"] as const;
type TabKey = (typeof TABS)[number];
const BASE = "/admin/contenu";

const TONE: Record<ArticleStatus, Tone> = { published: "ok", draft: "neutral" };
const LANG_TONE: Record<LangState, Tone> = { complete: "ok", partial: "warn", empty: "neutral" };

/** The tab's title: every page of this section used to carry the site's home title. */
export async function generateMetadata() {
  const t = await getTranslations("adminContent");
  return { title: t("title") };
}

export default async function AdminContentPage({
  searchParams,
}: {
  searchParams: Promise<{ a?: string; status?: string }>;
}) {
  await requireAdmin("content");
  const sp = await searchParams;
  const t = await getTranslations("adminContent");
  const locale = await getLocale();
  const admin = getServiceSupabase();
  if (!admin) return <p className="p-6 text-[13px] text-muted">{t("unavailable")}</p>;

  const [{ data, error }, settings] = await Promise.all([
    admin.from("articles").select("*").order("updated_at", { ascending: false }),
    getSettings(),
  ]);
  if (error) return <p className="p-6 text-[13px] text-muted">{t("unavailable")}</p>;
  const all = (data ?? []) as Article[];

  // The starter guides still to import: not yet in the table, by key or by address.
  let starterTotal = 0;
  let starterRemaining = 0;
  try {
    const starters = readStarterGuides();
    starterTotal = starters.length;
    starterRemaining = starters.filter((s) => !all.some((a) => a.source_key === s.slug || a.slug === s.slug)).length;
  } catch {
    starterTotal = 0;
  }

  const tally = Object.fromEntries(TABS.map((k) => [k, 0])) as Record<TabKey, number>;
  for (const a of all) {
    tally.all += 1;
    tally[a.status] += 1;
  }
  const tab: TabKey = (TABS as readonly string[]).includes(sp.status ?? "") ? (sp.status as TabKey) : "all";
  const tabs: Tab[] = TABS.map((k) => ({ value: k, label: t(`tabs.${k}`), count: tally[k] }));
  const rows = tab === "all" ? all : all.filter((a) => a.status === tab);

  const listQs = tab === "all" ? "" : `status=${tab}&`;
  const href = (extra: string) => `${BASE}?${listQs}${extra}` as typeof BASE;
  const listHref = tab === "all" ? BASE : `${BASE}?status=${tab}`;

  const openId = sp.a ?? null;
  const creating = openId === "new";
  const selected = creating ? null : all.find((a) => a.id === openId) ?? null;
  const showPane = creating || selected !== null;

  const titleOf = (a: Article) => a.title_fr?.trim() || a.title_ar?.trim() || a.slug;

  return (
    <FullBleed>
      <header className="flex h-12 shrink-0 items-center gap-4 border-b border-border px-4">
        <h1 className="shrink-0 text-[13px] font-semibold tracking-tight text-foreground">{t("title")}</h1>
        <Toolbar tabs={tabs} defaultTab="all" search={false} resetParams={["a"]} />
        <div className="ms-auto flex shrink-0 items-center gap-1.5">
          <ImportStarter total={starterTotal} remaining={starterRemaining} />
          <Link href={`${BASE}?a=new` as typeof BASE} className={adminBtn("primary", "sm")}>
            <Plus className="size-3.5" strokeWidth={2.8} />
            <span className="hidden sm:inline">{t("newGuide")}</span>
          </Link>
        </div>
      </header>

      <QueueKeys />

      {!settings.guides_enabled && (
        <p className="shrink-0 border-b border-border bg-[var(--tone-warn-bg)] px-4 py-2 text-[12px] text-[var(--tone-warn)]">
          {t("featureOff")}{" "}
          <Link href="/admin/settings" className="font-semibold underline">
            {t("featureOffLink")}
          </Link>
        </p>
      )}

      <div className="flex min-h-0 flex-1">
        <div
          className={`flex min-h-0 w-full flex-col border-border lg:w-[380px] lg:shrink-0 lg:border-e xl:w-[420px] ${
            showPane ? "hidden lg:flex" : "flex"
          }`}
        >
          <p className="shrink-0 border-b border-border px-4 py-1.5 text-[11.5px] text-subtle">
            {t("summary", { published: tally.published, total: tally.all })}
          </p>
          {rows.length === 0 ? (
            <div className="p-5">
              <EmptyState
                Icon={BookOpen}
                tone={all.length === 0 ? "idle" : "filtered"}
                title={all.length === 0 ? t("emptyTitle") : t("emptyTab")}
                hint={all.length === 0 ? t("emptyHint") : undefined}
              />
            </div>
          ) : (
            <ul className="min-h-0 flex-1 divide-y divide-border/70 overflow-y-auto overscroll-contain">
              {rows.map((a) => {
                const sel = a.id === openId;
                return (
                  <li key={a.id}>
                    <Link
                      href={href(`a=${a.id}`)}
                      data-row-id={a.id}
                      aria-current={sel ? "true" : undefined}
                      prefetch={false}
                      className={`${ROW_BASE} ${ROW_FOCUS} ${sel ? ROW_SELECTED : ROW_IDLE}`}
                    >
                      <span className="relative mt-0.5 h-10 w-[64px] shrink-0 overflow-hidden rounded bg-surface-2 ring-1 ring-border">
                        {a.cover_path ? (
                          <Image src={propertyPhotoUrl(a.cover_path)} alt="" fill sizes="64px" className="object-cover" />
                        ) : (
                          <span className="grid size-full place-items-center text-subtle">
                            <BookOpen className="size-4" strokeWidth={1.8} />
                          </span>
                        )}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span
                          dir="auto"
                          className={`block truncate text-[13px] ${sel ? "font-semibold text-foreground" : "font-medium text-foreground/90"}`}
                        >
                          {titleOf(a)}
                        </span>
                        <span className="mt-0.5 block truncate text-[11.5px] text-subtle" dir="ltr">
                          /guides/{a.slug}
                        </span>
                        <span className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5">
                          <StatusPill tone={TONE[a.status]}>{t(`status.${a.status}`)}</StatusPill>
                          {ARTICLE_LANGS.map((lang) => {
                            const state = langState(a, lang);
                            return (
                              <StatusPill key={lang} tone={LANG_TONE[state]} className="uppercase">
                                <span title={t(`langState.${state}`)}>{t(`langs.${lang}`)}</span>
                              </StatusPill>
                            );
                          })}
                        </span>
                      </span>
                      <span className="shrink-0 text-end text-[11px] text-subtle">
                        {formatDate(a.status === "published" && a.published_at ? a.published_at : a.updated_at, locale, "medium")}
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <div className={`min-w-0 flex-1 ${showPane ? "flex" : "hidden lg:flex"}`}>
          {creating || selected ? (
            <div className="w-full">
              <ArticleEditor
                // The form seeds its state once; another guide needs another form.
                key={selected?.id ?? "new"}
                article={selected}
                baseHref={`/${locale}${BASE}`}
                cancelHref={`/${locale}${listHref}`}
                siteBase={`/${locale}/guides`}
                aiAssist={settings.guides_ai_assist}
              />
            </div>
          ) : (
            <div className="grid w-full place-items-center px-6">
              <p className="max-w-xs text-center text-[12.5px] text-subtle">
                {t("pickOne")}
                <br />
                <span className="text-[11.5px]">{t("pickOneHint")}</span>
              </p>
            </div>
          )}
        </div>
      </div>
    </FullBleed>
  );
}
