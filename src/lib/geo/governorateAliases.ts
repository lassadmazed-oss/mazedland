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
    // Latin or digits glued to Arabic are two words: « gp8بنزرت » (2026-11-28).
    .replace(/([a-z0-9])([؀-ۿ])/g, "$1 $2")
    .replace(/([؀-ۿ])([a-z0-9])/g, "$1 $2")
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
  Kebili: ["Kebili", "Kébili", "Qibli", "Gbeli", "Gbili", "Kbili", "Qebili", "Kabli", "قبلي"],
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
const ROAD = /(?:^|\s)(?:route|rte|road|avenue|av|rue|boulevard|bd|direction|طريق|نهج|شارع|بطريق|بنهج)\s+(?:\d+\s+)?(?:(?:de|du|des|d|dal|del|vers)\s+)?$/;
/**
 * « Aïn » before a name makes it another place (2026-11-28): « Aïn Zaghouan »
 * is in Tunis, « Aïn Mestir » in Rafraf (Bizerte). Twelve annonces of Aïn
 * Zaghouan went online under Zaghouan.
 */
const AIN = /(?:^|\s)(?:ain|ayn|عين)\s+$/;
/** Words after a name that make it an agency's name: « Tunis First », « Sousse Immobilier ». */
const AGENCY = /^\s(?:first|immo|immobilier|immobiliere|immobilière|real|estate|homes?|invest|properties|property)(?:\s|$)/;

/**
 * The governorates a text writes, any spelling, as whole words — leaving out
 * « route de Gabès », « طريق قابس » (a road towards it, not the place):
 * « à Qibli - route de Gabès » → [Kebili].
 */
export function governoratesNamedIn(text: string | null | undefined): TunisianGovernorate[] {
  return namesFoundIn(text, BY_NAME);
}

/**
 * The values of the names (keys made by nameKey) a text writes as whole words,
 * leaving out the ones written as a road: the governorates' own names here,
 * the towns' in src/lib/geo/townNames.ts.
 */
export function namesFoundIn<T>(text: string | null | undefined, byName: ReadonlyMap<string, T>): T[] {
  return [...new Set(namesFoundAt(text, byName).map((m) => m.value))];
}

/**
 * Every place a text writes one of these names, with where (an offset in the
 * text's nameKey, so comparable between two calls on the same text), in that
 * order. Roads and « Aïn … » left out.
 */
export function namesFoundAt<T>(text: string | null | undefined, byName: ReadonlyMap<string, T>): { value: T; at: number }[] {
  if (!text?.trim()) return [];
  const key = ` ${nameKey(text)} `;
  const found: { value: T; at: number }[] = [];
  for (const [name, value] of byName) {
    if (name.length < 3) continue;
    let from = 0;
    for (;;) {
      const at = key.indexOf(` ${name} `, from);
      if (at < 0) break;
      const before = key.slice(Math.max(0, at - 24), at + 1);
      const after = key.slice(at + name.length + 1, at + name.length + 16);
      if (!ROAD.test(before) && !AIN.test(before) && !AGENCY.test(after)) found.push({ value, at });
      from = at + 1;
    }
  }
  return found.sort((a, b) => a.at - b.at);
}

/** Every name of a governorate, as nameKey writes it: for namesFoundAt. */
export const GOVERNORATE_BY_NAME: ReadonlyMap<string, TunisianGovernorate> = BY_NAME;
