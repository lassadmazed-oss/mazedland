/**
 * « Vérifier les photos » (Prospection phase 2): before the team puts an
 * owner's annonce online, a model looks at each photo and says what a person
 * would check by eye — a phone number written on it, another agency's mark, a
 * face, a screenshot instead of a photo of the property, how good it is, and
 * which room it shows — and the perceptual hash (src/lib/photoHash.ts) says
 * whether the picture is already on Mazed Immo under another annonce.
 *
 * It only READS: a finding is a hint put in front of the member, who decides.
 * Pure: the prompt, the schema the model answers in, the check of its answer
 * and the order that puts the best cover first. Calling the model and reading
 * the files is photoCheck.server.ts.
 */
export const PHOTO_KINDS = ["exterior", "living", "kitchen", "bedroom", "bathroom", "plot", "plan", "other"] as const;
export type PhotoKind = (typeof PHOTO_KINDS)[number];

export type PhotoFinding = {
  index: number;
  kind: PhotoKind;
  /** 1 (blurred, dark, crooked) to 5 (sharp, well lit, straight). */
  quality: number;
  phoneVisible: boolean;
  /** The words of a watermark, a logo, an agency name or a caption added on the photo. */
  overlayText: string | null;
  people: boolean;
  /** A screenshot, a map, a document, a collage: not a photograph of the property. */
  notProperty: boolean;
};

export type PhotoFlag = "phone" | "overlay" | "people" | "not_property" | "low_quality" | "duplicate";

export const PHOTO_CHECK_SYSTEM = `You check the photos of a property annonce before it goes online on Mazed Immo, a classifieds site for selling and renting real estate in Tunisia. The photos come from a private owner. You are shown them in order, each one labelled "Photo 0", "Photo 1"…

For every photo, report only what you can SEE:
- kind: exterior (the building from outside, a street view of it), living (living room, salon, dining room), kitchen, bedroom, bathroom, plot (land, a field, an empty lot, a view of the terrain), plan (a floor plan or a drawing), other.
- quality: 1 to 5. 5 is sharp, well lit and straight; 1 is blurred, very dark, or crooked.
- phone_visible: true if a telephone number, or what looks like one (8 digits, +216, a WhatsApp number), is written anywhere in the photo: a sign, a banner, a text added over the picture. Never guess one that is not there.
- overlay_text: the words of any watermark, logo, agency name, website or caption ADDED on the photo (not text that belongs to the scene, like a street sign far away), copied as they read, at most 60 characters. null when there is none.
- people: true if a person's face is clearly visible.
- not_property: true if it is not a photograph of the property: a screenshot, a map, a document, a flyer, a collage of several pictures.

Answer with exactly one entry per photo, with its index. Do not describe anything else.`;

const nullable = (schema: Record<string, unknown>) => ({ anyOf: [schema, { type: "null" }] });

/** The JSON schema the model must answer in (structured outputs). */
export const PHOTO_CHECK_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["photos"],
  properties: {
    photos: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["index", "kind", "quality", "phone_visible", "overlay_text", "people", "not_property"],
        properties: {
          index: { type: "integer" },
          kind: { type: "string", enum: [...PHOTO_KINDS] },
          quality: { type: "integer" },
          phone_visible: { type: "boolean" },
          overlay_text: nullable({ type: "string" }),
          people: { type: "boolean" },
          not_property: { type: "boolean" },
        },
      },
    },
  },
} as const;

/**
 * The model's answer, checked: one finding per photo, in order, whatever order
 * or gaps it came back with. A photo it did not report gets null (nothing is
 * assumed about it), a value off its list is dropped to the plainest one.
 */
export function normalizeFindings(raw: unknown, count: number): (PhotoFinding | null)[] {
  const list = (raw && typeof raw === "object" ? (raw as { photos?: unknown }).photos : null) as unknown;
  const out: (PhotoFinding | null)[] = Array.from({ length: count }, () => null);
  for (const item of Array.isArray(list) ? list : []) {
    const r = (item && typeof item === "object" ? item : {}) as Record<string, unknown>;
    const index = Number(r.index);
    if (!Number.isInteger(index) || index < 0 || index >= count || out[index]) continue;
    const kind = (PHOTO_KINDS as readonly unknown[]).includes(r.kind) ? (r.kind as PhotoKind) : "other";
    const q = Math.round(Number(r.quality));
    const overlay = typeof r.overlay_text === "string" ? r.overlay_text.trim().slice(0, 60) : "";
    out[index] = {
      index,
      kind,
      quality: Number.isFinite(q) ? Math.min(5, Math.max(1, q)) : 3,
      phoneVisible: r.phone_visible === true,
      overlayText: overlay || null,
      people: r.people === true,
      notProperty: r.not_property === true,
    };
  }
  return out;
}

/** Quality at or below this is flagged: a photo nobody will want to look at. */
export const LOW_QUALITY_MAX = 2;

export function flagsOf(finding: PhotoFinding | null, duplicate: boolean): PhotoFlag[] {
  const out: PhotoFlag[] = [];
  if (finding?.phoneVisible) out.push("phone");
  if (finding?.overlayText) out.push("overlay");
  if (finding?.people) out.push("people");
  if (finding?.notProperty) out.push("not_property");
  if (finding && finding.quality <= LOW_QUALITY_MAX) out.push("low_quality");
  if (duplicate) out.push("duplicate");
  return out;
}

/** Flags that should keep a photo from being the cover (and that the member must look at before publishing). */
const DISQUALIFYING: readonly PhotoFlag[] = ["phone", "overlay", "people", "not_property", "duplicate"];

export type CoverKind = "land" | "residential" | "commercial";

/** What makes a good first photo, best first, for each sort of annonce. */
const COVER_RANK: Record<CoverKind, Partial<Record<PhotoKind, number>>> = {
  land: { plot: 0, exterior: 1, other: 2 },
  residential: { exterior: 0, living: 1, kitchen: 2, bedroom: 3, bathroom: 4, plot: 5, other: 6, plan: 7 },
  commercial: { exterior: 0, living: 1, other: 2, kitchen: 3, bedroom: 4, bathroom: 5, plot: 6, plan: 7 },
};

/**
 * The photos' order with the best cover first: the clean ones before the flagged,
 * then by what the annonce is (a plot for land, the outside of a house, then
 * the living room), then by quality, and the owner's own order breaks ties.
 * A photo that was not read keeps its place among the clean ones, last of its kind.
 */
export function suggestOrder(findings: readonly (PhotoFinding | null)[], flags: readonly PhotoFlag[][], kind: CoverKind): number[] {
  const rank = COVER_RANK[kind];
  const key = (i: number) => {
    const f = findings[i];
    const flagged = flags[i]?.some((x) => DISQUALIFYING.includes(x)) ? 1 : 0;
    const k = f ? (rank[f.kind] ?? 9) : 9;
    return [flagged, k, f ? -f.quality : -3, i] as const;
  };
  return findings
    .map((_, i) => i)
    .sort((a, b) => {
      const ka = key(a);
      const kb = key(b);
      for (let n = 0; n < ka.length; n++) if (ka[n] !== kb[n]) return ka[n] - kb[n];
      return 0;
    });
}

/** The index of the photo to make the cover, or null when the first one already is it (or nothing can be said). */
export function suggestedCover(order: readonly number[]): number | null {
  return order.length > 1 && order[0] !== 0 ? order[0] : null;
}

export function coverKindOf(categoryKind: string | null | undefined): CoverKind {
  if (categoryKind === "land" || categoryKind === "terrain") return "land";
  if (categoryKind === "commercial") return "commercial";
  return "residential";
}
