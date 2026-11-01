import { getTranslations, getLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { getServerSupabase } from "@/lib/supabase/server";
import { getServiceSupabase } from "@/lib/supabase/admin";
import { SignOutButton } from "@/components/auth/SignOutButton";
import { DeleteAccountButton } from "@/components/account/DeleteAccountButton";
import { SmsNotificationsToggle } from "@/components/account/SmsNotificationsToggle";
import { HeroPhoto } from "@/components/landing/HeroPhoto";
import { Ltr } from "@/components/ui/Ltr";
import {
  Wallet,
  ChevronRight,
  ChevronLeft,
  LayoutDashboard,
  ArrowRight,
  ArrowUpRight,
  FileText,
  Heart,
  Plus,
  BellRing,
  Settings,
  Store,
  CalendarCheck,
} from "lucide-react";

// Per-user, auth-gated — never static (env-less prerender would throw + fail the build).
export const dynamic = "force-dynamic";

/**
 * Account hub — identity card on top, then grouped action rows, in the
 * vocabulary of the 2026-10-31 redesign: quiet white cards with a hairline,
 * ink for the one thing that is pressed, the brand photograph for the guest.
 * The user lands here and sees the same visual system continuing.
 */
/** The tab's title: every page of this section used to carry the site's home title. */
export async function generateMetadata() {
  const t = await getTranslations("accountPage");
  return { title: t("mySpace") };
}

/** The first letter of a name — a letter, not the bracket of « [TEST] » or a digit. */
function initialOf(name: string | null, fallback: string | null): string {
  const letter = (name ?? "").match(/\p{L}/u)?.[0] ?? (fallback ?? "").match(/\p{L}|\d/u)?.[0];
  return (letter ?? "?").toUpperCase();
}

export default async function AccountPage() {
  const t = await getTranslations("accountPage");
  const tBrand = await getTranslations("brand");
  const locale = await getLocale();
  const isRTL = locale === "ar";
  const arabic = isRTL ? "font-arabic" : "";
  const ChevronEnd = isRTL ? ChevronLeft : ChevronRight;

  // Fail-soft: Supabase env missing in dev → render guest banner. Real
  // sign-in flow needs env configured.
  let userId: string | null = null;
  let userEmail: string | null = null;
  let fullName: string | null = null;
  let userPhone: string | null = null;
  let role: string = "individual";
  let smsEnabled = true;
  let inAShop = false;

  try {
    const supabase = await getServerSupabase();
    const { data: { user } } = await supabase.auth.getUser();
    if (user) {
      userId = user.id;
      userEmail = user.email ?? null;
      const { data: profile } = await supabase
        .from("profiles")
        .select("full_name, role, sms_notifications_enabled, phone")
        .eq("id", user.id)
        .single();
      fullName = profile?.full_name ?? null;
      userPhone = (profile?.phone as string | null) ?? null;
      role = profile?.role ?? "individual";
      smsEnabled = profile?.sms_notifications_enabled ?? true;
      // Shop memberships are server-only (0173), so the service client reads them.
      const { count } = (await getServiceSupabase()
        ?.from("shop_members")
        .select("user_id", { count: "exact", head: true })
        .eq("user_id", user.id)) ?? { count: 0 };
      inAShop = (count ?? 0) > 0;
    }
  } catch {
    // env missing — fall through to guest UI.
  }

  // A phone signup gets a synthetic address (216…@phone.mazedland.app) that
  // nobody can write to, and the number they actually signed up with was never
  // shown anywhere. Prefer the number whenever the address is that placeholder.
  const contactLine = userEmail && /@phone\./.test(userEmail) ? userPhone : userEmail;

  if (!userId) {
    // The guest: the brand photograph with the welcome over it, and the two
    // ways in floating off its lower edge — the home page's own hero, so the
    // visitor who taps « Compte » lands on the site they just left.
    return (
      <div className="mx-auto max-w-[var(--max-w)] pb-12 lg:max-w-lg lg:py-14">
        <section className="relative overflow-hidden bg-[#1b2a36] lg:rounded-[var(--radius-3xl)]" aria-labelledby="account-guest-title">
          <HeroPhoto hiddenAt="not all" className="absolute inset-0" />
          <div className="mazed-hero-scrim absolute inset-0" aria-hidden />
          <div className="relative px-5 pb-16 pt-10 text-white lg:px-8 lg:pt-12">
            <p className="inline-flex items-center gap-2 rounded-full bg-black/30 px-3 py-1 text-[11.5px] font-bold ring-1 ring-white/25 backdrop-blur-sm">
              {tBrand("name")}
            </p>
            <h1 id="account-guest-title" className={`mazed-display mt-3 max-w-[14ch] text-[30px] text-white drop-shadow-sm ${arabic}`}>
              {t("guestTitle")}
            </h1>
            <p className={`mt-2.5 max-w-xs text-[14px] font-medium leading-snug text-white/85 ${arabic}`}>{t("guestBody")}</p>
          </div>
        </section>

        <div className="relative z-10 -mt-9 px-4">
          <div className="mazed-float p-4 sm:p-5">
            <Link href="/signup" className="mazed-btn-luxe tap-target flex h-12 w-full items-center justify-center rounded-full text-[14px]">
              {t("signup")}
            </Link>
            <Link href="/login" className="mazed-btn-quiet tap-target mt-2.5 flex h-12 w-full items-center justify-center rounded-full text-[14px]">
              {t("login")}
            </Link>
          </div>
        </div>

        <p className="mt-6 text-center">
          <Link
            href="/annonces"
            className="inline-flex items-center gap-1.5 text-[13px] font-bold text-muted transition hover:text-foreground"
          >
            {t("browseWithoutAccount")}
            <ArrowRight className="size-3.5 rtl:-scale-x-100" strokeWidth={2.4} aria-hidden />
          </Link>
        </p>
      </div>
    );
  }

  // Signed-in surface.
  //
  // WHAT STOOD HERE. Three groups built for the auction product: identity
  // verification (KYC), a role space for inspectors, banks and agencies, an
  // "Acheteur" group of bids and inspections, and a seller dashboard at /sell.
  // KYC, the inspector network, the partner portal, inspections and /sell are
  // all retired — next.config sends every one of those paths somewhere else —
  // so on the page a signed-in user lands on, five of the seven rows led
  // nowhere they had asked to go. What remains is what the product does.
  const accountActions: ActionItem[] = [
    { href: "/account/listings", Icon: FileText, title: t("actions.listingsTitle"), body: t("actions.listingsBody") },
    { href: "/annonces/nouvelle", Icon: Plus, title: t("actions.publishTitle"), body: t("actions.publishBody") },
    // What they are looking for, kept with alerts (0168).
    { href: "/account/requests", Icon: BellRing, title: t("actions.requestsTitle"), body: t("actions.requestsBody") },
    // Visits asked and received (0174).
    { href: "/account/visites", Icon: CalendarCheck, title: t("actions.visitsTitle"), body: t("actions.visitsBody") },
    { href: "/account/activity", Icon: Heart, title: t("actions.favoritesTitle"), body: t("actions.favoritesBody") },
    { href: "/account/payments", Icon: Wallet, title: t("actions.paymentsTitle"), body: t("actions.paymentsBody") },
    inAShop
      ? { href: "/pro/dashboard", Icon: Store, title: t("actions.proTitle"), body: t("actions.proBody") }
      : { href: "/pro", Icon: Store, title: t("actions.proOpenTitle"), body: t("actions.proOpenBody") },
    { href: "/account/settings", Icon: Settings, title: t("actions.settingsTitle"), body: t("actions.settingsBody") },
  ];
  if (role === "admin") {
    accountActions.push({ href: "/admin", Icon: LayoutDashboard, title: t("actions.adminTitle"), body: t("actions.adminBody") });
  }
  const groups: { label: string; items: ActionItem[] }[] = [
    { label: t("mySpace"), items: accountActions },
  ];

  // An e-mail or a phone number: either way a left-to-right run, and a bare
  // "+216…" in a right-to-left line would show its plus sign at the far end.
  const contact = contactLine ? <Ltr>{contactLine}</Ltr> : null;
  const initial = initialOf(fullName, contactLine);
  const adminBadge = role === "admin" && (
    <span className="inline-flex items-center rounded-full bg-foreground px-2.5 py-0.5 text-[10.5px] font-bold text-[var(--background)]">
      {t("adminBadge")}
    </span>
  );

  const identity = (
    <section className="rounded-[var(--radius-2xl)] bg-surface p-5 ring-1 ring-border shadow-[var(--shadow-card)]">
      <div className="flex items-center gap-3.5">
        <span className="grid size-12 shrink-0 place-items-center rounded-full bg-foreground text-[18px] font-extrabold text-[var(--background)]">
          {initial}
        </span>
        <div className="min-w-0 flex-1">
          <h1 className={`mazed-h2 truncate text-[20px] text-foreground ${arabic}`}>{fullName ?? contact ?? ""}</h1>
          {fullName && contactLine && <p className="mt-0.5 truncate text-[12.5px] text-muted">{contact}</p>}
          {adminBadge && <div className="mt-1.5">{adminBadge}</div>}
        </div>
      </div>
    </section>
  );

  return (
    <>
      {/* ── MOBILE / tablet (< lg) — one column ── */}
      <div className="lg:hidden mx-auto max-w-[var(--max-w)] px-4 py-6">
        {identity}
        {groups.map((g) => (
          <section key={g.label} className="mt-6">
            <p className="mazed-eyebrow mb-2.5">{g.label}</p>
            <div className="divide-y divide-border overflow-hidden rounded-[var(--radius-2xl)] bg-surface ring-1 ring-border">
              {g.items.map((a) => (
                <Row key={a.href} {...a} ChevronEnd={ChevronEnd} arabic={arabic} />
              ))}
            </div>
          </section>
        ))}
        <section className="mt-6">
          <p className="mazed-eyebrow mb-2.5">{t("notifications")}</p>
          <div className="overflow-hidden rounded-[var(--radius-2xl)] bg-surface ring-1 ring-border">
            <SmsNotificationsToggle initial={smsEnabled} />
          </div>
        </section>
        <div className="mt-7">
          <SignOutButton label={t("signOut")} />
        </div>
        <div className="mt-2">
          <DeleteAccountButton label={t("deleteAccount")} />
        </div>
      </div>

      {/* ── DESKTOP (lg+) — profile banner + 3-col action grid ── */}
      <div className="hidden lg:block mx-auto max-w-6xl px-8 py-10">
        <section className="flex items-center gap-6 rounded-[var(--radius-3xl)] bg-surface p-8 ring-1 ring-border shadow-[var(--shadow-card)]">
          <span className="grid size-16 shrink-0 place-items-center rounded-full bg-foreground text-[24px] font-extrabold text-[var(--background)]">
            {initial}
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-3">
              <h1 className={`mazed-h2 text-[28px] text-foreground ${arabic}`}>{fullName ?? contact ?? ""}</h1>
              {adminBadge}
            </div>
            {fullName && contactLine && <p className="mt-1 text-[13.5px] text-muted">{contact}</p>}
          </div>
          <div className="shrink-0">
            <SignOutButton label={t("signOut")} />
          </div>
        </section>

        {groups.map((g) => (
          <div key={g.label} className="mt-10">
            <p className="mazed-eyebrow mb-4">{g.label}</p>
            <div className="grid grid-cols-3 gap-4">
              {g.items.map((a) => (
                <ActionTile key={a.href} {...a} arabic={arabic} />
              ))}
            </div>
          </div>
        ))}
        <div className="mt-10">
          <p className="mazed-eyebrow mb-4">{t("notifications")}</p>
          <div className="max-w-xl overflow-hidden rounded-[var(--radius-2xl)] bg-surface ring-1 ring-border">
            <SmsNotificationsToggle initial={smsEnabled} />
          </div>
        </div>
        <div className="mt-10 max-w-sm">
          <DeleteAccountButton label={t("deleteAccount")} />
        </div>
      </div>
    </>
  );
}

type ActionItem = {
  href: string;
  Icon: React.ComponentType<{ className?: string; strokeWidth?: number }>;
  title: string;
  body: string;
};

/** Desktop action card — ink icon, title + corner arrow, description; a soft
 *  shadow on hover, the way the Pro landing's benefit tiles sit. */
function ActionTile({ href, Icon, title, body, arabic }: ActionItem & { arabic: string }) {
  return (
    <Link
      href={href as `/${string}`}
      className="group rounded-[var(--radius-2xl)] bg-surface p-6 ring-1 ring-border transition hover:-translate-y-0.5 hover:shadow-[var(--shadow-card)] hover:ring-foreground/20"
    >
      <span className="inline-grid size-10 place-items-center rounded-full bg-foreground text-[var(--background)]">
        <Icon className="size-[18px]" strokeWidth={2.2} />
      </span>
      <div className="mt-5 flex items-center justify-between gap-2">
        <h3 className={`text-[16px] font-extrabold leading-tight text-foreground ${arabic}`}>{title}</h3>
        <ArrowUpRight className="size-4 shrink-0 text-muted transition group-hover:text-foreground rtl:-scale-x-100" strokeWidth={2} />
      </div>
      <p className="mt-1.5 text-[13px] leading-snug text-muted">{body}</p>
    </Link>
  );
}

function Row({
  href,
  Icon,
  title,
  body,
  ChevronEnd,
  arabic,
}: ActionItem & {
  ChevronEnd: React.ComponentType<{ className?: string; strokeWidth?: number }>;
  arabic: string;
}) {
  return (
    <Link
      href={href as `/${string}`}
      className="tap-target flex items-center gap-3.5 px-4 py-3.5 transition hover:bg-surface-2 active:bg-surface-2"
    >
      <span className="grid size-10 shrink-0 place-items-center rounded-full bg-surface-2 text-foreground">
        <Icon className="size-[18px]" strokeWidth={2} />
      </span>
      <div className="min-w-0 flex-1">
        <div className={`text-[14.5px] font-bold text-foreground ${arabic}`}>{title}</div>
        <div className="mt-0.5 truncate text-[12px] text-muted">{body}</div>
      </div>
      <ChevronEnd className="size-4 shrink-0 text-subtle" strokeWidth={2.2} />
    </Link>
  );
}
