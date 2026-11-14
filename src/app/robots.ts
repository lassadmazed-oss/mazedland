import type { MetadataRoute } from "next";
import { siteUrl } from "@/lib/siteUrl";
import { routing } from "@/i18n/routing";
import { BLOCKED_CRAWLERS } from "@/lib/crawlers";

const SITE_URL = siteUrl();

// Authenticated / transactional surfaces, kept out of the index in every locale.
const PRIVATE = [
  "/admin", "/account", "/payment", "/login", "/signup", "/forgot-password", "/reset-password",
  // A person's invoices, a seller's Espace Pro and the publish form (0173–0175).
  "/factures", "/pro/dashboard", "/pro/creer", "/annonces/nouvelle",
  // A form, not a page: it was the second most requested address after the catalogue.
  "/demandes/nouvelle",
];

/**
 * /robots.txt — let crawlers index the public marketplace, keep them out of
 * the authenticated / transactional surfaces (no SEO value, and we don't want
 * admin or account URLs surfacing in search). Points at the dynamic sitemap.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: [
          "/api/",
          ...routing.locales.flatMap((l) => PRIVATE.map((p) => `/${l}${p}`)),
          // A search of the catalogue is drawn on each visit and is never a page to index.
          "/*?q=",
          "/*&q=",
        ],
      },
      // The crawlers that cost us and send nobody (src/lib/crawlers.ts); the proxy refuses the ones that ignore this.
      { userAgent: [...BLOCKED_CRAWLERS], disallow: "/" },
    ],
    sitemap: SITE_URL ? `${SITE_URL}/sitemap.xml` : undefined,
    host: SITE_URL ?? undefined,
  };
}
