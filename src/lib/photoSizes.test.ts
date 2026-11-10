import { describe, expect, it } from "vitest";
import { PHOTO_WIDTHS, hasPhotoSizes, photoSizePath, photoSizePaths, photoWidthFor, withPhotoSizes } from "./photoSizes";

const U = "0f2c3b4a-1111-2222-3333-444455556666";
const PHOTO = `${U}/annonce-1762790000000-123456-0.webp`;

describe("photo sizes", () => {
  it("are made for the photos the uploader stores, and only for them", () => {
    expect(hasPhotoSizes(PHOTO)).toBe(true);
    expect(hasPhotoSizes(`${U}/annonce-1-2-3.jpg`)).toBe(true);
    // Not a size of a size.
    expect(hasPhotoSizes(`${U}/annonce-1-2-3.w640.webp`)).toBe(false);
    // Banners, logos, covers and the demo photos keep the resizer.
    expect(hasPhotoSizes("ads/0c0449a9-da7d-433d-94db-dc77981cc41e.png")).toBe(false);
    expect(hasPhotoSizes("/properties/sfax-centre-terrain-avec-maison/1.webp")).toBe(false);
    expect(hasPhotoSizes(`https://x.supabase.co/storage/v1/object/public/properties/${PHOTO}`)).toBe(false);
  });

  it("sit next to the photo, in WebP whatever the original", () => {
    expect(photoSizePath(PHOTO, 640)).toBe(`${U}/annonce-1762790000000-123456-0.w640.webp`);
    expect(photoSizePath(`${U}/annonce-1-2-3.jpg`, 384)).toBe(`${U}/annonce-1-2-3.w384.webp`);
    expect(photoSizePaths(PHOTO)).toHaveLength(PHOTO_WIDTHS.length);
    expect(photoSizePaths("ads/a.png")).toEqual([]);
  });

  it("serve the narrowest size at least as wide as asked, the widest past it", () => {
    expect(photoWidthFor(120)).toBe(384);
    expect(photoWidthFor(384)).toBe(384);
    expect(photoWidthFor(640)).toBe(640);
    expect(photoWidthFor(828)).toBe(1080);
    expect(photoWidthFor(1280)).toBe(1600);
    expect(photoWidthFor(3840)).toBe(1600);
  });

  it("go with their photo when it is deleted", () => {
    expect(withPhotoSizes([PHOTO, "ads/a.png"])).toEqual([PHOTO, ...photoSizePaths(PHOTO), "ads/a.png"]);
  });
});
