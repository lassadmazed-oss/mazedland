/**
 * Towns and areas people write in a post instead of the governorate
 * (2026-11-28): « Villa S+4 · Zone touristique, Djerba » went online under
 * Nabeul. The post never wrote « Médenine », the reader left the délégation
 * empty, and the model guessed Nabeul from « zone touristique » (Hammamet has
 * one too). « Djerba » is not a délégation either: it is the island of three
 * of them.
 *
 * Only names that point to ONE governorate, written as words, and only well
 * known ones: the délégation and quartier lists hold names shared between
 * governorates (« Ennasr », « Soukra », « Médina »), which is why they are not
 * scanned through a whole text. A road named after a town (« route de
 * Hammamet ») is not the place (governorateAliases.ts).
 */
import { type TunisianGovernorate } from "@/lib/tunisia";
import { nameKey, namesFoundIn } from "@/lib/geo/governorateAliases";

export const TOWN_NAMES: Partial<Record<TunisianGovernorate, string[]>> = {
  "Médenine": ["Djerba", "Jerba", "Jarba", "جربة", "Houmt Souk", "Houmt Essouk", "حومة السوق", "Midoun", "ميدون", "Zarzis", "جرجيس", "Ben Gardane", "بن قردان"],
  Nabeul: ["Hammamet", "الحمامات", "Yasmine Hammamet", "ياسمين الحمامات", "Kelibia", "قليبية", "Korba", "قربة", "Menzel Temime", "منزل تميم", "Grombalia", "قرمبالية", "Haouaria", "الهوارية", "Dar Chaabane", "دار شعبان", "Beni Khiar", "بني خيار"],
  Sousse: ["Kantaoui", "El Kantaoui", "القنطاوي", "Sahloul", "سهلول", "Khezama", "خزامة", "Akouda", "أكودة", "Msaken", "مساكن", "Kalaa Kebira", "القلعة الكبرى"],
  Monastir: ["Skanes", "سقانص", "Ksar Hellal", "قصر هلال", "Moknine", "المكنين", "Sahline", "الساحلين"],
  Mahdia: ["Chebba", "الشابة", "Ksour Essef", "قصور الساف"],
  // Not « Carthage » (« Carthage Land » is in Hammamet), nor « L'Aouina »: the
  // team files Cité El Wahat / L'Aouina under Ariana, the OSM lists under Tunis.
  Tunis: ["Gammarth", "قمرت", "La Marsa", "المرسى", "Sidi Bou Said", "سيدي بوسعيد", "Berges du Lac", "Lac 1", "Lac 2", "El Manar", "المنار", "Le Bardo", "باردو"],
  // « Route de Soukra » (Sfax) is a road, left out as every road is.
  Ariana: ["Raoued", "رواد", "Mnihla", "المنيهلة", "Ghazela", "Ghazala", "El Ghazala", "الغزالة", "Borj Louzir", "برج الوزير", "Chotrana", "الشطرانة", "La Soukra", "Soukra", "Nouvelle Soukra", "سكرة", "السكرة"],
  "Ben Arous": ["Rades", "رادس", "Hammam Lif", "حمام الأنف", "Megrine", "مقرين", "Boumhel", "Bou Mhel", "بومهل", "Mourouj", "El Mourouj", "المروج", "Fouchana", "فوشانة"],
  Manouba: ["Oued Ellil", "وادي الليل", "Douar Hicher", "دوار هيشر", "Den Den", "الدندان"],
  Bizerte: ["Ras Jebel", "رأس الجبل", "Menzel Bourguiba", "منزل بورقيبة", "Ghar El Melh", "غار الملح", "Raf Raf", "Rafraf", "رفراف", "Mateur", "ماطر"],
  Jendouba: ["Tabarka", "طبرقة", "Ain Draham", "عين دراهم"],
  Sfax: ["Kerkennah", "Kerkenah", "قرقنة", "Sakiet Ezzit", "ساقية الزيت", "Sakiet Eddaier", "ساقية الدائر", "Thyna", "طينة", "Agareb", "عقارب", "Mahres", "المحرس", "Jebeniana", "الجبنيانة"],
  Tozeur: ["Nefta", "نفطة"],
  Kebili: ["Douz", "دوز"],
  "Gabès": ["Matmata", "مطماطة"],
};

const BY_TOWN = new Map<string, TunisianGovernorate>();
for (const [g, towns] of Object.entries(TOWN_NAMES) as [TunisianGovernorate, string[]][]) {
  for (const t of towns) BY_TOWN.set(nameKey(t), g);
}

/** Every town name, as nameKey writes it: for namesFoundAt. */
export const TOWN_BY_NAME: ReadonlyMap<string, TunisianGovernorate> = BY_TOWN;

/** The governorates of the towns a text writes, as words, roads left out: « Zone touristique, Djerba » → [Médenine]. */
export function townGovernoratesIn(text: string | null | undefined): TunisianGovernorate[] {
  return namesFoundIn(text, BY_TOWN);
}
