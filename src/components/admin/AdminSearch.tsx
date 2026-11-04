"use client";

import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Link, useRouter } from "@/i18n/navigation";
import {
  BookOpen, ChevronRight, FileText, FolderTree, GalleryHorizontalEnd, Inbox, LayoutDashboard, Loader2,
  Megaphone, Receipt, Search, Settings2, Store, Tag, Users, X,
  type LucideIcon,
} from "lucide-react";
import { useCanOpen } from "./AdminScopes";
import { NAV, SITE } from "./kit/consoleNav";
import { SITE_TABS } from "./kit/SiteTabs";
import { SETTINGS, SETTING_GROUPS, type SettingKey } from "@/lib/settings/registry";
import {
  SEARCH_MIN_CHARS, labelScore, searchHref,
  type SearchGroup, type SearchHit, type SearchSource,
} from "@/lib/admin/search";
import { cn } from "@/lib/utils";

/**
 * The console's search box (the owner, 2026-11-04): instead of walking the
 * screens to find what to change, type it — a reference, a name, a phone, a
 * payment's reference, an invoice number, a setting — and open it where it is
 * changed. Ctrl K (or « / ») opens it from anywhere in the console.
 *
 * The console's own pages and the settings are found here, from the labels
 * the rail and the settings show; the rows come from /api/admin/search, each
 * section only for the members who may open it.
 */

const ICON: Record<SearchSource | "pages" | "settings", LucideIcon> = {
  pages: LayoutDashboard,
  listings: Inbox,
  shops: Store,
  sellers: Users,
  payments: Receipt,
  invoices: FileText,
  social: Megaphone,
  ads: GalleryHorizontalEnd,
  products: Tag,
  articles: BookOpen,
  categories: FolderTree,
  settings: Settings2,
};

const PAGES_SHOWN = 4;
const SETTINGS_SHOWN = 6;
const DEBOUNCE_MS = 220;

type Section = { key: SearchSource | "pages" | "settings"; hits: SearchHit[] };

const OpenContext = createContext<() => void>(() => {});

/** Opens the box: the rail's field, the phone bar's magnifier. */
export function AdminSearchButton({ variant }: { variant: "field" | "icon" }) {
  const open = useContext(OpenContext);
  const t = useTranslations("adminSearch");
  if (variant === "icon") {
    return (
      <button
        type="button"
        onClick={open}
        aria-label={t("open")}
        className="tap-target grid size-9 place-items-center rounded text-muted transition hover:text-foreground"
      >
        <Search className="size-5" strokeWidth={2.2} />
      </button>
    );
  }
  return (
    <button
      type="button"
      onClick={open}
      className="flex h-9 w-full items-center gap-2 rounded-lg border border-border bg-surface px-2.5 text-[12.5px] text-muted transition hover:border-[var(--gold-soft)] hover:text-foreground"
    >
      <Search className="size-4 shrink-0" strokeWidth={2} />
      <span className="min-w-0 flex-1 truncate text-start">{t("open")}</span>
      <kbd dir="ltr" className="shrink-0 rounded border border-border px-1 font-sans text-[10px] font-semibold text-subtle">
        {t("shortcut")}
      </kbd>
    </button>
  );
}

/** Holds the box once for the console: the rail and the phone bar both open it. */
export function AdminSearchProvider({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  // Kept between openings: back from a wrong result, the same list is there.
  const [q, setQ] = useState("");

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = e.target instanceof HTMLElement && (e.target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName));
      if ((e.key === "k" || e.key === "K") && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        setOpen(true);
      } else if (e.key === "/" && !typing && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        setOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <OpenContext.Provider value={() => setOpen(true)}>
      {children}
      {open && <SearchDialog q={q} setQ={setQ} onClose={() => setOpen(false)} />}
    </OpenContext.Provider>
  );
}

function SearchDialog({ q, setQ, onClose }: { q: string; setQ: (v: string) => void; onClose: () => void }) {
  const t = useTranslations("adminSearch");
  const tNav = useTranslations("admin.nav");
  const tSite = useTranslations("admin.siteTabs");
  const tSet = useTranslations("settingsRegistry");
  const locale = useLocale();
  const router = useRouter();
  const canOpen = useCanOpen();
  const input = useRef<HTMLInputElement>(null);

  const term = q.trim();
  const searching = term.length >= SEARCH_MIN_CHARS;

  // The rows, for the term they answer: while the next term is on its way the
  // box says so instead of showing the previous term's rows as this one's.
  const [remote, setRemote] = useState<{ term: string; groups: SearchGroup[]; failed: boolean } | null>(null);
  const loading = searching && remote?.term !== term;

  useEffect(() => {
    if (!searching) return;
    const ctrl = new AbortController();
    const id = setTimeout(async () => {
      try {
        const res = await fetch(`/api/admin/search?q=${encodeURIComponent(term)}&locale=${locale}`, { signal: ctrl.signal });
        const j = (await res.json().catch(() => ({}))) as { groups?: SearchGroup[]; partial?: boolean };
        if (!res.ok) throw new Error(String(res.status));
        setRemote({ term, groups: j.groups ?? [], failed: !!j.partial });
      } catch {
        if (!ctrl.signal.aborted) setRemote({ term, groups: [], failed: true });
      }
    }, DEBOUNCE_MS);
    return () => {
      clearTimeout(id);
      ctrl.abort();
    };
  }, [term, searching, locale]);

  // The console's own screens and settings, by the names they are shown with.
  const local = useMemo(() => {
    if (!searching) return { pages: [] as SearchHit[], settings: [] as SearchHit[] };
    const scored = <T,>(items: T[], score: (x: T) => number) =>
      items.map((x) => ({ x, s: score(x) })).filter((r) => r.s > 0).sort((a, b) => b.s - a.s).map((r) => r.x);

    const screens: SearchHit[] = [
      ...NAV.filter((n) => canOpen(n.section)).map((n) => ({ id: n.href, title: tNav(n.key), meta: [tNav(`${n.key}Hint`)], href: n.href })),
      ...(SITE_TABS.some((tab) => canOpen(tab.section)) ? [{ id: SITE.href, title: tNav(SITE.key), meta: [tNav(`${SITE.key}Hint`)], href: SITE.href }] : []),
      ...SITE_TABS.filter((tab) => canOpen(tab.section)).map((tab) => ({ id: tab.href, title: tSite(tab.key), meta: [tSite("site")], href: tab.href })),
      ...(canOpen("settings")
        ? SETTING_GROUPS.map((g) => ({ id: `g:${g}`, title: tSet(`groups.${g}.title`), meta: [tSite("settings")], href: `/admin/settings?g=${g}` }))
        : []),
    ];
    const pages = scored(screens, (h) => labelScore(term, h.title, h.meta.join(" "))).slice(0, PAGES_SHOWN);

    const settings = canOpen("settings")
      ? scored(
          (Object.keys(SETTINGS) as SettingKey[]).map((key) => {
            const group = SETTINGS[key].group;
            return {
              hit: { id: `s:${key}`, title: tSet(`${key}.label`), meta: [t("settingGroup", { group: tSet(`groups.${group}.title`) })], href: searchHref.setting(group, key) },
              extra: `${tSet(`${key}.hint`)} ${key.replace(/_/g, " ")}`,
            };
          }),
          (r) => labelScore(term, r.hit.title, r.extra),
        ).slice(0, SETTINGS_SHOWN).map((r) => r.hit)
      : [];
    return { pages, settings };
  }, [searching, term, canOpen, tNav, tSite, tSet, t]);

  const rows = remote?.term === term ? remote.groups : [];
  const sections: Section[] = searching
    ? [
        { key: "pages" as const, hits: local.pages },
        ...rows.map((g) => ({ key: g.source, hits: g.hits })),
        { key: "settings" as const, hits: local.settings },
      ].filter((s) => s.hits.length > 0)
    : [];
  const flat = sections.flatMap((s) => s.hits);

  // The highlighted row, for the term it was chosen on: a new term starts at the top.
  const [cursor, setCursor] = useState({ term: "", i: 0 });
  const active = cursor.term === term ? Math.min(cursor.i, Math.max(flat.length - 1, 0)) : 0;
  const optionId = (i: number) => `admin-search-option-${i}`;

  function go(href: string) {
    onClose();
    router.push(href as "/admin");
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    } else if ((e.key === "ArrowDown" || e.key === "ArrowUp") && flat.length) {
      e.preventDefault();
      const next = (active + (e.key === "ArrowDown" ? 1 : flat.length - 1)) % flat.length;
      setCursor({ term, i: next });
      document.getElementById(optionId(next))?.scrollIntoView({ block: "nearest" });
    } else if (e.key === "Enter" && flat[active]) {
      e.preventDefault();
      go(flat[active].href);
    }
  }

  const failed = remote?.term === term && remote.failed;
  let index = -1;

  return (
    <div className="fixed inset-0 z-[60]" role="dialog" aria-modal="true" aria-label={t("label")}>
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} aria-hidden />
      <div className="relative mx-auto mt-[7vh] flex max-h-[82dvh] w-[min(640px,calc(100vw-24px))] flex-col overflow-hidden rounded-2xl bg-background shadow-2xl ring-1 ring-border animate-fade-in">
        <div className="flex items-center gap-2.5 border-b border-border px-4">
          <Search className="size-5 shrink-0 text-muted" strokeWidth={2} />
          <input
            ref={input}
            autoFocus
            onFocus={(e) => e.currentTarget.select()}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder={t("placeholder")}
            aria-label={t("label")}
            role="combobox"
            aria-expanded={flat.length > 0}
            aria-controls="admin-search-results"
            aria-activedescendant={flat.length ? optionId(active) : undefined}
            autoComplete="off"
            spellCheck={false}
            enterKeyHint="search"
            // The dialog is the field: the site-wide :focus-visible ring (unlayered
            // in globals.css, so stronger than a utility) would draw a box in a box.
            style={{ outline: "none" }}
            className="h-14 min-w-0 flex-1 bg-transparent text-[16px] text-foreground placeholder:text-subtle"
          />
          {loading && <Loader2 className="size-4 shrink-0 animate-spin text-muted" aria-label={t("loading")} />}
          <button
            type="button"
            onClick={onClose}
            aria-label={t("close")}
            className="tap-target grid size-8 shrink-0 place-items-center rounded text-muted transition hover:text-foreground"
          >
            <X className="size-5" strokeWidth={2.2} />
          </button>
        </div>

        <div id="admin-search-results" role="listbox" aria-label={t("label")} className="min-h-0 flex-1 overflow-y-auto p-2">
          {!searching && <p className="px-2 py-3 text-[12.5px] leading-relaxed text-muted">{t("hint")}</p>}

          {sections.map((s) => {
            const Icon = ICON[s.key];
            return (
              <div key={s.key} role="group" aria-label={t(`groups.${s.key}`)} className="pb-1">
                <p className="flex items-center gap-1.5 px-2 pb-1 pt-2.5 text-[10.5px] font-bold uppercase tracking-[0.14em] text-subtle">
                  <Icon className="size-3.5" strokeWidth={2.2} />
                  {t(`groups.${s.key}`)}
                </p>
                {s.hits.map((hit) => {
                  index += 1;
                  const i = index;
                  const on = i === active;
                  return (
                    <Link
                      key={`${s.key}:${hit.id}`}
                      id={optionId(i)}
                      href={hit.href as "/admin"}
                      role="option"
                      aria-selected={on}
                      onMouseMove={() => !on && setCursor({ term, i })}
                      onClick={onClose}
                      className={cn("flex items-center gap-3 rounded-lg px-2.5 py-2 transition", on ? "bg-surface-2" : "hover:bg-surface-2")}
                    >
                      <span className="min-w-0 flex-1">
                        <span dir="auto" className="block truncate text-[13.5px] font-semibold text-foreground">{hit.title}</span>
                        {hit.meta.length > 0 && (
                          <span className="block truncate text-[11.5px] text-muted">
                            {hit.meta.map((m, k) => (
                              <span key={k}>
                                {k > 0 && " · "}
                                <bdi>{m}</bdi>
                              </span>
                            ))}
                          </span>
                        )}
                      </span>
                      <ChevronRight className={cn("size-4 shrink-0 rtl:-scale-x-100", on ? "text-[var(--gold)]" : "text-transparent")} />
                    </Link>
                  );
                })}
              </div>
            );
          })}

          {searching && !loading && flat.length === 0 && !failed && (
            <p className="px-2 py-3 text-[13px] text-muted">{t("empty", { q: term })}</p>
          )}
          {failed && <p className="px-2 py-2 text-[12px] font-semibold text-[var(--tone-warn)]">{t("failed")}</p>}
        </div>

        <footer className="hidden border-t border-border px-4 py-2 text-[11px] text-subtle sm:block">{t("keys")}</footer>
      </div>
    </div>
  );
}
