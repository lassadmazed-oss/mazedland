/**
 * « D'où viennent les demandes » (2026-11-10): for each place the site offers
 * « Enregistrer une demande », the taps on it (`demande_cta`) and the demandes
 * saved from it (`demande_create` with `mode = new`, carrying the same `via`).
 * A demande saved with no known `via` (« Mes demandes », a typed link) counts
 * under `other`. Pure: rows in, table out.
 */
import { DEMANDE_VIA, demandeVia, type DemandeVia } from "@/lib/requests/prefill";

export type DemandeSourceEvent = { name: string; via: string | null; mode: string | null };
export type DemandeSource = { via: DemandeVia | "other"; taps: number; demandes: number };

export function countDemandeSources(events: readonly DemandeSourceEvent[]): DemandeSource[] {
  const rows = new Map<DemandeSource["via"], DemandeSource>(
    [...DEMANDE_VIA, "other" as const].map((via) => [via, { via, taps: 0, demandes: 0 }]),
  );
  for (const e of events) {
    const place = demandeVia(e.via) ?? "other";
    if (e.name === "demande_cta" && place !== "other") rows.get(place)!.taps++;
    else if (e.name === "demande_create" && e.mode === "new") rows.get(place)!.demandes++;
  }
  return [...rows.values()]
    .filter((r) => r.taps > 0 || r.demandes > 0)
    .sort((a, b) => b.demandes - a.demandes || b.taps - a.taps);
}
