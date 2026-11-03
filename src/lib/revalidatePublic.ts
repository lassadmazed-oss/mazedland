import { revalidatePath } from "next/cache";
import { routing } from "@/i18n/routing";

/**
 * The public pages that come from the CDN (the agences, the guides…) are
 * rebuilt at most a minute after a change. After a change someone makes and
 * then goes to look at — an agence saving its page, an admin publishing a
 * guide — this rebuilds them at the next visit instead, in every locale.
 * Paths without the locale: "/guides", "/agences/abir-immo".
 */
export function revalidatePublic(...paths: string[]): void {
  for (const locale of routing.locales) {
    for (const path of paths) revalidatePath(`/${locale}${path}`);
  }
}
