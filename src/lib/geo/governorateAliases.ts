/**
 * The other ways people write a governorate's name (2026-11-26, the owner: « add
 * the other names of the governorates »). A Prospection post said « Qibli »
 * for Kebili and the draft came back without a governorate; sellers and agencies
 * also write « Benzart », « Gbeli », « Kasrine », « Mednine », accents or not,
 * Arabic with or without hamza.
 *
 * Light on purpose (no place lists): the listing assistant's reader uses it in
 * the browser too (src/lib/ai/listing.ts).
 */
import { TUNISIAN_GOVERNORATES, type TunisianGovernorate } from "@/lib/tunisia";

/** Lower case, no accents, Arabic letters folded (أ إ آ → ا, ة → ه, ى → ي), one space between words. */
export function nameKey(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/['’`]/g, "")
    .replace(/[أإآ]/g, "ا")
    .replace(/ة/g, "ه")
    .replace(/ى/g, "ي")
    .replace(/[^a-z0-9؀-ۿ]+/g, " ")
    .trim();
}

/**
 * Every governorate's names besides the French one the site stores. Plain
 * « تونس » is left out on purpose: it is also Tunisia.
 */
export const GOVERNORATE_ALIASES: Record<TunisianGovernorate, readonly string[]> = {
  Tunis: ["Tunis", "Tunis ville", "Grand Tunis", "تونس العاصمة", "العاصمة"],
  Ariana: ["Ariana", "Ariena", "Aryana", "L'Ariana", "اريانة", "أريانة"],
  "Ben Arous": ["Ben Arous", "Benarous", "Bin Arous", "Ben Arouss", "بن عروس"],
  Manouba: ["Manouba", "La Manouba", "Mannouba", "Mnouba", "منوبة"],
  Sousse: ["Sousse", "Souse", "Soussa", "Susa", "Sosa", "سوسة"],
  Monastir: ["Monastir", "Mestir", "Mnastir", "المنستير"],
  Mahdia: ["Mahdia", "Mehdia", "Mahdiya", "المهدية"],
  Nabeul: ["Nabeul", "Nabel", "Nabeel", "Neapolis", "نابل"],
  Sfax: ["Sfax", "Sfakes", "Sfaks", "Safaqis", "صفاقس"],
  Bizerte: ["Bizerte", "Bizerta", "Benzart", "Binzart", "Bnzart", "بنزرت"],
  "Gabès": ["Gabès", "Gabes", "Gabis", "Qabis", "قابس"],
  "Médenine": ["Médenine", "Medenine", "Mednine", "Madanin", "Mdenine", "مدنين"],
  Kairouan: ["Kairouan", "Kairawan", "Qairawan", "Kirwan", "Kerouan", "القيروان"],
  "Béja": ["Béja", "Beja", "Bajah", "Baja", "باجة"],
  Jendouba: ["Jendouba", "Jandouba", "Jendoba", "جندوبة"],
  Kef: ["Kef", "Le Kef", "El Kef", "Al Kef", "الكاف"],
  Kasserine: ["Kasserine", "Kasrine", "Gasrine", "Kassrine", "القصرين"],
  "Sidi Bouzid": ["Sidi Bouzid", "Sidi Bouzaid", "Sidi Bouzide", "سيدي بوزيد"],
  Gafsa: ["Gafsa", "Qafsa", "Gafssa", "قفصة"],
  Tozeur: ["Tozeur", "Touzer", "Tozer", "Touzeur", "توزر"],
  Kebili: ["Kebili", "Kébili", "Qibli", "Gbeli", "Gbili", "Kbili", "Qebili", "قبلي"],
  Tataouine: ["Tataouine", "Tatouine", "Tataouin", "Tatawin", "تطاوين"],
  Siliana: ["Siliana", "Seliana", "Silyana", "سليانة"],
  Zaghouan: ["Zaghouan", "Zaghwan", "Zagwan", "زغوان"],
};

const BY_NAME = new Map<string, TunisianGovernorate>();
for (const g of TUNISIAN_GOVERNORATES) {
  BY_NAME.set(nameKey(g), g);
  for (const a of GOVERNORATE_ALIASES[g]) BY_NAME.set(nameKey(a), g);
}

/** The governorate a name is, written any of these ways: « Qibli » → Kebili, « بنزرت » → Bizerte. */
export function governorateFromName(name: string | null | undefined): TunisianGovernorate | null {
  return name ? (BY_NAME.get(nameKey(name)) ?? null) : null;
}

/** Words before a name that make it a road or a street, not where the property is. */
const ROAD = /(?:^|\s)(?:route|rte|road|avenue|av|rue|boulevard|bd|direction|طريق|نهج|شارع)\s+(?:(?:de|du|des|d|vers)\s+)?$/;

/**
 * The governorates a text writes, any spelling, as whole words — leaving out
 * « route de Gabès », « طريق قابس » (a road towards it, not the place):
 * « à Qibli - route de Gabès » → [Kebili].
 */
export function governoratesNamedIn(text: string | null | undefined): TunisianGovernorate[] {
  if (!text?.trim()) return [];
  const key = ` ${nameKey(text)} `;
  const found = new Set<TunisianGovernorate>();
  for (const [name, g] of BY_NAME) {
    if (name.length < 3) continue;
    let from = 0;
    for (;;) {
      const at = key.indexOf(` ${name} `, from);
      if (at < 0) break;
      if (!ROAD.test(key.slice(Math.max(0, at - 24), at + 1))) found.add(g);
      from = at + 1;
    }
  }
  return [...found];
}
