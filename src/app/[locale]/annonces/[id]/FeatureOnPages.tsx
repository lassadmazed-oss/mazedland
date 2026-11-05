"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Check, Loader2, Megaphone } from "lucide-react";
import { Link } from "@/i18n/navigation";
import { useToast } from "@/components/ui/Toast";
import { chipClass } from "@/lib/chips";
import { FEATURED_CHANNELS, SOCIAL_LANGUAGES, type SocialChannel, type SocialLanguage } from "@/lib/social/channels";

/** The promotion already open on this annonce, whoever asked for it. */
export type OpenFeature = { ref: string; status: string };

/**
 * « Publier sur nos pages » (0214) — for an admin only, on any annonce online:
 * the owner likes it, picks the pages, and the post waits in the console's
 * « À valider » with its texts to read before anything goes out.
 *
 * The seller's CGU stand for their consent; until they have accepted the
 * version that allows it, the card says so instead of offering the form.
 * Chips, not typing: the pages (« Mazed », Mazed Immo, Instagram, the groups
 * by hand) and the language.
 */
export function FeatureOnPages({
  listingId,
  open,
  sellerTerms,
  connected,
  hasPhotos,
}: {
  listingId: string;
  open: OpenFeature | null;
  sellerTerms: boolean;
  /** Which API channels have a connected account; the others become a task for a person. */
  connected: Partial<Record<SocialChannel, boolean>>;
  hasPhotos: boolean;
}) {
  const t = useTranslations("featureOnPages");
  const { toast } = useToast();
  const [channels, setChannels] = useState<SocialChannel[]>(() =>
    FEATURED_CHANNELS.filter((c) => c !== "facebook_groups" && (c !== "instagram" || hasPhotos)),
  );
  const [language, setLanguage] = useState<SocialLanguage>("both");
  const [busy, setBusy] = useState(false);
  const [made, setMade] = useState<OpenFeature | null>(open);

  const shell = "mt-4 rounded-2xl bg-surface-2 p-4 ring-1 ring-border";
  const head = (
    <p className="flex items-center gap-1.5 text-[13px] font-extrabold text-foreground">
      <Megaphone className="size-4 text-gold" aria-hidden /> {t("title")}
      <span className="ms-auto rounded-full bg-surface px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.1em] text-muted ring-1 ring-border">
        {t("adminOnly")}
      </span>
    </p>
  );

  if (made) {
    return (
      <section className={shell}>
        {head}
        <p className="mt-1.5 text-[12.5px] leading-snug text-foreground">
          {/* The console's labels (adminSocial) are not sent to public pages: the card has its own. */}
          {t("openTitle", { ref: `MZ-${made.ref}` })} · {t(`status.${made.status}`)}
        </p>
        <p className="mt-0.5 text-[12px] leading-snug text-muted">{t(made.status === "pending_approval" ? "openPending" : "openBody")}</p>
        <Link href={"/admin/social" as never} className="mt-2 inline-block text-[12.5px] font-bold text-gold hover:underline">
          {t("openConsole")}
        </Link>
      </section>
    );
  }

  if (!sellerTerms) {
    return (
      <section className={shell}>
        {head}
        <p className="mt-1.5 text-[12px] leading-snug text-muted">{t("sellerTerms")}</p>
      </section>
    );
  }

  const toggle = (c: SocialChannel) => setChannels((cs) => (cs.includes(c) ? cs.filter((x) => x !== c) : [...cs, c]));

  async function send() {
    if (channels.length === 0) return;
    setBusy(true);
    try {
      const res = await fetch("/api/admin/social/featured", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ listingId, channels, language }),
      });
      const j = (await res.json().catch(() => ({}))) as { ok?: boolean; ref?: string; error?: string };
      if (!res.ok || !j.ok || !j.ref) {
        const known = ["seller_terms", "already_open", "not_online", "no_photo", "no_channel", "disabled"];
        toast(t(`errors.${known.includes(j.error ?? "") ? j.error : "failed"}`), res.status === 409 ? "warning" : "error");
        return;
      }
      toast(t("madeToast"), "success");
      setMade({ ref: j.ref, status: "pending_approval" });
    } catch {
      toast(t("errors.failed"), "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className={shell}>
      {head}
      <p className="mt-1 text-[12px] leading-snug text-muted">{t("hint")}</p>

      <p className="mt-3 text-[11.5px] font-bold text-foreground">{t("pagesLabel")}</p>
      <div role="group" aria-label={t("pagesLabel")} className="mt-1.5 flex flex-wrap gap-2">
        {FEATURED_CHANNELS.map((c) => {
          const on = channels.includes(c);
          const disabled = c === "instagram" && !hasPhotos;
          return (
            <button
              key={c}
              type="button"
              aria-pressed={on}
              disabled={disabled}
              onClick={() => toggle(c)}
              className={`${chipClass(on)} disabled:opacity-50`}
            >
              {on && <Check className="size-3.5 shrink-0" />}
              {t(`channels.${c}`)}
            </button>
          );
        })}
      </div>
      {channels.some((c) => c !== "facebook_groups" && !connected[c]) && (
        <p className="mt-1.5 text-[11px] leading-snug text-muted">
          {t("notConnected", {
            pages: channels.filter((c) => c !== "facebook_groups" && !connected[c]).map((c) => t(`channels.${c}`)).join(", "),
          })}
        </p>
      )}
      {channels.includes("facebook_groups") && <p className="mt-1.5 text-[11px] leading-snug text-muted">{t("groupsHint")}</p>}

      <p className="mt-3 text-[11.5px] font-bold text-foreground">{t("languageLabel")}</p>
      <div role="radiogroup" aria-label={t("languageLabel")} className="mt-1.5 flex flex-wrap gap-2">
        {SOCIAL_LANGUAGES.map((l) => (
          <button key={l} type="button" role="radio" aria-checked={language === l} onClick={() => setLanguage(l)} className={chipClass(language === l)}>
            {t(`languages.${l}`)}
          </button>
        ))}
      </div>

      <button
        type="button"
        onClick={() => void send()}
        disabled={busy || channels.length === 0}
        className="mazed-btn-luxe tap-target mt-3 flex h-11 w-full items-center justify-center gap-2 text-[13.5px] disabled:opacity-60"
      >
        {busy ? <Loader2 className="size-4 animate-spin" /> : <Megaphone className="size-4" />}
        {t("cta")}
      </button>
      <p className="mt-1.5 text-[11px] leading-snug text-muted">{t("afterHint")}</p>
    </section>
  );
}
