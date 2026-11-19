import {
  BarChart3, BellRing, BookOpen, Megaphone, Store, GalleryHorizontalEnd,
  LayoutDashboard, Inbox, Receipt, Tag, Users, FolderTree,
  SlidersHorizontal, TrendingUp, UserPlus,
  type LucideIcon,
} from "lucide-react";
import type { ConsoleSection } from "@/lib/admin/sections";

/**
 * The console's destinations, read by the rail (AdminShell) and by the search
 * box (AdminSearch), which finds a screen by its name as the rail shows it.
 */

export type CountKey = "annonces" | "paiements" | "social" | "boutiques";
export type AdminCounts = Partial<Record<CountKey, number>>;

export type NavItem = {
  /** Names the label in `admin.nav`; its tooltip is `${key}Hint`. */
  key: string;
  href: string;
  Icon: LucideIcon;
  /** Key into the `counts` map — a badge for work that is waiting. */
  countKey?: CountKey;
  /** The team section it belongs to (src/lib/admin/sections.ts); none = every member. */
  section?: ConsoleSection;
};

export const NAV: NavItem[] = [
  { key: "dashboard", href: "/admin", Icon: LayoutDashboard },
  { key: "results", href: "/admin/resultats", Icon: BarChart3, section: "resultats" },
  { key: "analytics", href: "/admin/analytics", Icon: TrendingUp, section: "analytics" },
  { key: "listings", href: "/admin/annonces", Icon: Inbox, countKey: "annonces", section: "annonces" },
  { key: "demandes", href: "/admin/demandes", Icon: BellRing, section: "demandes" },
  { key: "social", href: "/admin/social", Icon: Megaphone, countKey: "social", section: "social" },
  // The owners the team brings in (0218).
  { key: "prospection", href: "/admin/prospection", Icon: UserPlus, section: "prospection" },
  { key: "ads", href: "/admin/publicites", Icon: GalleryHorizontalEnd, section: "publicites" },
  { key: "payments", href: "/admin/paiements", Icon: Receipt, countKey: "paiements", section: "paiements" },
  { key: "shops", href: "/admin/agences", Icon: Store, countKey: "boutiques", section: "agences" },
  { key: "offers", href: "/admin/offres", Icon: Tag, section: "offres" },
  { key: "sellers", href: "/admin/vendeurs", Icon: Users, section: "vendeurs" },
  { key: "catalogue", href: "/admin/catalogue", Icon: FolderTree, section: "catalogue" },
  // The guides (0208): articles written here, read on /guides.
  { key: "content", href: "/admin/contenu", Icon: BookOpen, section: "content" },
];

export const SITE: NavItem = { key: "site", href: "/admin/site", Icon: SlidersHorizontal };
