/**
 * A price the seller wrote in the description of an annonce « sur demande »
 * (2026-11-13: MZ-01707 said « Loyer: 850DT » and MZ-01733 « prix de
 * location 1300dt » under a « Prix sur demande »). The form offers to put it
 * in the price box; nothing is changed without the seller's tap.
 *
 * Two shapes, in French, Arabic and Derja: a figure with its currency or its
 * multiplier (« 850 DT », « 350 000 dinars », « 350 ألف », « 1,2 million »),
 * and a price word followed by a figure (« Prix : 350000 », « السوم 240 »).
 * A price per m², or a figure out of the bounds a property can have, is not
 * the annonce's price.
 */

export type PriceInText = { price: number; quote: string };

const SALE_BOUNDS: [number, number] = [1_000, 100_000_000];
const RENT_BOUNDS: [number, number] = [50, 200_000];

// A figure: digits, with the spaces, dots and commas Tunisians group them by.
const FIGURE = String.raw`\d{1,3}(?:[   .,]\d{3})+(?:[.,]\d{1,2})?|\d+(?:[.,]\d{1,3})?`;
const CURRENCY = String.raw`(?:dt|tnd|dinars?|د\.?\s?ت|دينار|دنانير|ملّيم)`;
const THOUSAND = String.raw`(?:mille|milles|k|ألف|الف|آلاف|الاف)`;
const MILLION = String.raw`(?:millions?|مليون|ملايين|ملاين|مليارات?)`;
const PRICE_WORD = String.raw`(?:prix|loyer|tarif|السوم|سوم|السعر|سعر|الثمن|ثمن|الكراء|كراء|المعلوم)`;
// After the figure: « /m² », « le m² », « للمتر » — a price per square metre.
const PER_SQM = String.raw`^\s*(?:dt|tnd|د\.?\s?ت|دينار)?\s*(?:\/\s*m|le\s+m|par\s+m|du\s+m|للمتر|المتر|م²|م2)`;

/** « 350 000 », « 350.000 », « 1 300,50 », « 1,2 » → a number; the grouping read from its shape. */
export function readFigure(raw: string): number | null {
  const s = raw.replace(/[   ]/g, " ").trim();
  // Groups of three after a separator are thousands: 350.000, 1,300,000, 350 000.
  const grouped = /^\d{1,3}(?:[ .,]\d{3})+(?:[.,]\d{1,2})?$/.test(s);
  if (grouped) {
    const m = /^(.*?)(?:[.,](\d{1,2}))?$/.exec(s);
    const whole = (m?.[1] ?? s).replace(/[ .,]/g, "");
    const cents = m?.[2] ? Number(`0.${m[2]}`) : 0;
    const n = Number(whole) + cents;
    return Number.isFinite(n) ? n : null;
  }
  const n = Number(s.replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

function within(n: number, rent: boolean): boolean {
  const [lo, hi] = rent ? RENT_BOUNDS : SALE_BOUNDS;
  return n >= lo && n <= hi;
}

function perSquareMetre(after: string): boolean {
  return new RegExp(PER_SQM, "i").test(after);
}

/** The first price written in this text that an annonce of this deal can ask, or null. */
export function priceInText(text: string | null | undefined, rent: boolean): PriceInText | null {
  if (!text) return null;
  const src = text.normalize("NFC");
  const shapes: { re: RegExp; scale: (m: RegExpExecArray) => number | null; figure: (m: RegExpExecArray) => string }[] = [
    // « 1,2 million », « 2 مليون »
    {
      re: new RegExp(String.raw`(${FIGURE})\s*${MILLION}`, "giu"),
      figure: (m) => m[1],
      scale: () => 1_000_000,
    },
    // « 350 mille », « 350 ألف »
    {
      re: new RegExp(String.raw`(${FIGURE})\s*${THOUSAND}(?![a-z؀-ۿ])`, "giu"),
      figure: (m) => m[1],
      scale: () => 1_000,
    },
    // « 850DT », « 350 000 dinars », « 1300 د.ت »
    {
      re: new RegExp(String.raw`(${FIGURE})\s*${CURRENCY}(?![a-z])`, "giu"),
      figure: (m) => m[1],
      scale: () => 1,
    },
    // « Prix : 350000 », « Loyer:850 », « السوم 240 »
    {
      re: new RegExp(String.raw`${PRICE_WORD}[^\d\n]{0,20}?(${FIGURE})`, "giu"),
      figure: (m) => m[1],
      scale: () => 1,
    },
  ];

  let best: { at: number; found: PriceInText } | null = null;
  for (const shape of shapes) {
    shape.re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = shape.re.exec(src))) {
      const after = src.slice(m.index + m[0].length, m.index + m[0].length + 16);
      if (perSquareMetre(after)) continue;
      const figure = readFigure(shape.figure(m));
      const factor = shape.scale(m);
      if (figure == null || factor == null) continue;
      const price = Math.round(figure * factor);
      if (!within(price, rent)) continue;
      const quote = m[0].replace(/\s+/g, " ").trim().slice(0, 40);
      // The earliest mention wins: a description gives its price before its extras.
      if (!best || m.index < best.at) best = { at: m.index, found: { price, quote } };
      break;
    }
  }
  return best?.found ?? null;
}
