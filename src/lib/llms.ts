/**
 * /llms.txt — the site described for answer engines (ChatGPT search, Copilot,
 * Perplexity, Gemini…), in the Markdown shape llmstxt.org proposes: what Mazed
 * Immo is, the pages that matter, the searches people make with their counts,
 * the guides. A machine reads one short file instead of crawling the catalogue.
 *
 * Every figure comes from the published annonces of the day; nothing is
 * written that the site does not hold (« invent nothing », the owner's rule).
 * Pure, so the tests can pin it; src/app/llms.txt/route.ts feeds it.
 */

export type LlmsInput = {
  origin: string;
  /** Published annonces, one row each. */
  listings: readonly { deal: string | null; cat: string | null; gov: string | null }[];
  /** Category slug → French label. */
  categories: Readonly<Record<string, string>>;
  agencies: number;
  guides: readonly { slug: string; title: string }[];
  marketPage: boolean;
  demandsPage: boolean;
  whatsapp: string;
  email: string;
};

const fmt = (n: number) => n.toLocaleString("fr-FR").replace(/ | /g, " ");

/** The searches with the most annonces: type × deal × governorate, then type × deal, then governorate. */
function topSearches(input: LlmsInput, max: number): { label: string; query: string; n: number }[] {
  const counts = new Map<string, { label: string; query: string; n: number }>();
  const add = (deal: string | null, cat: string | null, gov: string | null) => {
    const q = new URLSearchParams();
    if (deal) q.set("deal", deal);
    if (cat) q.set("cat", cat);
    if (gov) q.set("gov", gov);
    const key = q.toString();
    const what = cat ? input.categories[cat] ?? cat : "Biens";
    const verb = deal === "rent" ? "à louer" : deal === "sale" ? "à vendre" : "";
    const label = [what, verb, gov ? `à ${gov}` : "en Tunisie"].filter(Boolean).join(" ");
    const row = counts.get(key) ?? { label, query: key, n: 0 };
    row.n++;
    counts.set(key, row);
  };
  for (const l of input.listings) {
    const deal = l.deal === "sale" || l.deal === "rent" ? l.deal : null;
    if (l.cat && deal && l.gov) add(deal, l.cat, l.gov);
    if (l.cat && deal) add(deal, l.cat, null);
    if (l.gov) add(null, null, l.gov);
  }
  return [...counts.values()].sort((a, b) => b.n - a.n || a.label.localeCompare(b.label, "fr")).slice(0, max);
}

export function buildLlmsTxt(input: LlmsInput): string {
  const o = input.origin;
  const total = input.listings.length;
  const sale = input.listings.filter((l) => l.deal === "sale").length;
  const rent = input.listings.filter((l) => l.deal === "rent").length;
  const govs = new Set(input.listings.map((l) => l.gov).filter(Boolean)).size;
  const lines: string[] = [];
  lines.push("# Mazed Immo", "");
  lines.push(
    "> Mazed Immo (mazed.immo) est un site d'annonces immobilières en Tunisie, en français et en arabe : appartements, maisons, villas, immeubles, terrains, fermes, bureaux, locaux commerciaux et dépôts, à vendre et à louer. Le prix est affiché sur l'annonce et l'acheteur contacte directement le vendeur ou l'agence.",
    "",
    "> مزاد إيمو (mazed.immo) موقع إعلانات عقارية في تونس بالعربية والفرنسية: شقق، ديار، فيلات، عمارات، أراضي، ضيعات، مكاتب ومحلات، للبيع وللكراء. السوم مكتوب في الإعلان، والشاري يتّصل مباشرة بالبائع ولا بالوكالة.",
    "",
  );
  lines.push("## En chiffres (mis à jour chaque jour)", "");
  lines.push(`- ${fmt(total)} annonces en ligne : ${fmt(sale)} à vendre, ${fmt(rent)} à louer, dans ${govs} gouvernorats`);
  if (input.agencies > 0) lines.push(`- ${fmt(input.agencies)} agences et promoteurs avec une page sur le site`);
  lines.push("");
  lines.push("## Pages principales", "");
  lines.push(`- [Toutes les annonces](${o}/fr/annonces) : le catalogue, filtrable par type, gouvernorat, délégation, prix et surface`);
  lines.push(`- [Les annonces en arabe](${o}/ar/annonces)`);
  if (input.marketPage) lines.push(`- [Le marché en chiffres](${o}/fr/marche) : prix demandés par type de bien et par gouvernorat, calculés sur les annonces en ligne`);
  lines.push(`- [Agences et promoteurs](${o}/fr/agences)`);
  if (input.demandsPage) lines.push(`- [Ce que les gens cherchent](${o}/fr/demandes) : les demandes d'achat et de location déposées par les visiteurs`);
  if (input.guides.length > 0) lines.push(`- [Guides pratiques](${o}/fr/guides) : acheter, vendre et louer en Tunisie`);
  lines.push("");
  const searches = topSearches(input, 25);
  if (searches.length > 0) {
    lines.push("## Recherches fréquentes", "");
    for (const s of searches) lines.push(`- [${s.label}](${o}/fr/annonces?${s.query}) : ${fmt(s.n)} annonce${s.n > 1 ? "s" : ""}`);
    lines.push("");
  }
  if (input.guides.length > 0) {
    lines.push("## Guides", "");
    for (const g of input.guides) lines.push(`- [${g.title}](${o}/fr/guides/${g.slug})`);
    lines.push("");
  }
  lines.push("## Comment lire une annonce", "");
  lines.push("- Adresse : /fr/annonces/<id> (français) et /ar/annonces/<id> (arabe), la même annonce.");
  lines.push("- Chaque annonce porte des données structurées schema.org (RealEstateListing) : prix en dinars tunisiens (TND), loyer par mois pour une location, type, surface, gouvernorat et délégation.");
  lines.push("- « S+2 » se lit : deux chambres en plus du salon.");
  lines.push("- Le numéro du vendeur n'est pas dans la page : il s'affiche sur demande, sur le site.");
  lines.push("");
  lines.push("## Contact", "");
  if (input.whatsapp) lines.push(`- WhatsApp : ${input.whatsapp}`);
  if (input.email) lines.push(`- E-mail : ${input.email}`);
  lines.push(`- [Page contact](${o}/fr/contact)`);
  lines.push("");
  lines.push("## Optional", "");
  lines.push(`- [Plan du site](${o}/sitemap.xml)`);
  return lines.join("\n") + "\n";
}
