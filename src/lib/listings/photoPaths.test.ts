import { describe, expect, it } from "vitest";
import { foreignPhotoPaths, ownPhotoPath } from "./input";
import { refusedPhotoPaths, unreferencedPhotoPaths } from "./storage";
import { parseProjectInput } from "@/lib/pro/projects";

const ME = "11111111-1111-4111-8111-111111111111";
const HER = "22222222-2222-4222-8222-222222222222";
const photo = (id: string, n = 1) => `${id}/annonce-1763100000000-${n}-0.webp`;
const rows = (...paths: string[]) => paths.map((storage_path, sort_order) => ({ storage_path, sort_order }));

describe("ownPhotoPath: only what the photo route mints for this account", () => {
  it("accepts the route's own names", () => {
    expect(ownPhotoPath(ME, photo(ME))).toBe(true);
    expect(ownPhotoPath(ME, `${ME}/annonce-1-2-3.jpg`)).toBe(true);
    expect(ownPhotoPath(ME, `${ME}/annonce-1-2-3.heic`)).toBe(true);
  });

  it("refuses another account's folder, even with a perfect name", () => {
    expect(ownPhotoPath(ME, photo(HER))).toBe(false);
  });

  it("refuses every way of leaving the folder", () => {
    expect(ownPhotoPath(ME, `${ME}/../${HER}/annonce-1-2-3.webp`)).toBe(false);
    expect(ownPhotoPath(ME, `${ME}/${HER}/annonce-1-2-3.webp`)).toBe(false);
    expect(ownPhotoPath(ME, `/${ME}/annonce-1-2-3.webp`)).toBe(false);
    expect(ownPhotoPath(ME, `https://x.supabase.co/storage/v1/object/public/properties/${ME}/annonce-1-2-3.webp`)).toBe(false);
    expect(ownPhotoPath(ME, `${ME}/annonce-1-2-3.webp/../../${HER}/x.webp`)).toBe(false);
  });

  it("refuses a name the route does not mint, and an owner id that is not one", () => {
    expect(ownPhotoPath(ME, `${ME}/x.webp`)).toBe(false);
    expect(ownPhotoPath(ME, `${ME}/annonce-1-2-3.`)).toBe(false);
    expect(ownPhotoPath(ME, `${ME}/annonce-1-2-3.toolongext`)).toBe(false);
    expect(ownPhotoPath("", "/annonce-1-2-3.webp")).toBe(false);
    expect(ownPhotoPath("..", "../annonce-1-2-3.webp")).toBe(false);
  });
});

describe("foreignPhotoPaths", () => {
  it("lets through the seller's own and what is already on the annonce", () => {
    const legacy = "/properties/sfax-centre/1.webp";
    expect(foreignPhotoPaths(rows(photo(ME, 1), photo(ME, 2)), ME)).toEqual([]);
    expect(foreignPhotoPaths(rows(legacy, photo(ME)), ME, [legacy])).toEqual([]);
  });

  it("names the paths that are not theirs", () => {
    expect(foreignPhotoPaths(rows(photo(ME), photo(HER)), ME)).toEqual([photo(HER)]);
    expect(foreignPhotoPaths(rows("/properties/a.webp"), ME)).toEqual(["/properties/a.webp"]);
  });

  it("is not fooled by a path attached to someone else's annonce", () => {
    // `attached` is only the seller's own annonce: the caller never passes another's.
    expect(foreignPhotoPaths(rows(photo(HER)), ME, [])).toEqual([photo(HER)]);
  });
});

/** A fake client: listings(by id and seller) and listing_photos(by paths). */
function fakeAdmin(opts: { annonce?: { id: string; seller: string; photos: string[] }; used?: string[] }) {
  const admin = {
    from(table: string) {
      const q: Record<string, unknown> = {};
      const f: Record<string, string> = {};
      const api = {
        select: () => api,
        eq: (k: string, v: string) => ((f[k] = v), api),
        in: (_k: string, vals: string[]) => ((q.in = vals), api),
        maybeSingle: async () => {
          const a = opts.annonce;
          const hit = table === "listings" && a && f.id === a.id && f.seller_id === a.seller;
          return { data: hit ? { photos: a.photos.map((storage_path) => ({ storage_path })) } : null, error: null };
        },
        then: (res: (v: unknown) => void) => {
          const wanted = (q.in as string[]) ?? [];
          res({ data: (opts.used ?? []).filter((p) => wanted.includes(p)).map((storage_path) => ({ storage_path })), error: null });
        },
      };
      return api;
    },
  };
  return admin as unknown as Parameters<typeof refusedPhotoPaths>[0];
}

describe("refusedPhotoPaths", () => {
  it("refuses a foreign path on a new draft", async () => {
    const out = await refusedPhotoPaths(fakeAdmin({}), { photos: rows(photo(HER)), ownerId: ME, listingId: null });
    expect(out).toEqual([photo(HER)]);
  });

  it("lets an old annonce keep the paths it already has", async () => {
    const legacy = "/properties/sfax-centre/1.webp";
    const admin = fakeAdmin({ annonce: { id: "L1", seller: ME, photos: [legacy] } });
    expect(await refusedPhotoPaths(admin, { photos: rows(legacy, photo(ME)), ownerId: ME, listingId: "L1" })).toEqual([]);
  });

  it("does not let someone else's annonce id lend its photos", async () => {
    // The annonce L1 belongs to HER: asking as ME finds nothing attached.
    const admin = fakeAdmin({ annonce: { id: "L1", seller: HER, photos: [photo(HER)] } });
    expect(await refusedPhotoPaths(admin, { photos: rows(photo(HER)), ownerId: ME, listingId: "L1" })).toEqual([photo(HER)]);
  });
});

describe("unreferencedPhotoPaths: a deletion takes only files no annonce uses", () => {
  it("keeps a file another annonce still names", async () => {
    const admin = fakeAdmin({ used: [photo(HER, 5)] });
    expect(await unreferencedPhotoPaths(admin, [photo(ME), photo(HER, 5)])).toEqual([photo(ME)]);
  });

  it("works through a long list, and ignores empties and repeats", async () => {
    const many = Array.from({ length: 250 }, (_, i) => photo(ME, i));
    const admin = fakeAdmin({ used: [photo(ME, 7), photo(ME, 130), photo(ME, 249)] });
    const out = await unreferencedPhotoPaths(admin, [...many, "", many[0]]);
    expect(out).toHaveLength(247);
    expect(out).not.toContain(photo(ME, 130));
  });
});

describe("a project's cover", () => {
  it("must be a file the person uploaded, or the one already there", () => {
    const own = parseProjectInput({ cover_path: photo(ME) }, { partial: true, userId: ME });
    expect(own).toMatchObject({ ok: true });
    const foreign = parseProjectInput({ cover_path: photo(HER) }, { partial: true, userId: ME });
    expect(foreign).toEqual({ ok: false, field: "cover_path" });
    const there = parseProjectInput({ cover_path: "/old/cover.webp" }, { partial: true, userId: ME, currentCover: "/old/cover.webp" });
    expect(there).toMatchObject({ ok: true });
    const noOne = parseProjectInput({ cover_path: photo(ME) }, { partial: true });
    expect(noOne).toEqual({ ok: false, field: "cover_path" });
  });
});
