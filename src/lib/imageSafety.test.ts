import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { MAX_INPUT_PIXELS, SAFE_DECODE, isPhoto, photoKind } from "./imageSafety";

const bytes = (s: string) => Uint8Array.from(Buffer.from(s, "latin1"));

describe("photoKind: told by the first bytes, before any decoder", () => {
  it("knows what sharp itself writes", async () => {
    const base = sharp({ create: { width: 8, height: 8, channels: 3, background: "#c0392b" } });
    expect(photoKind(await base.clone().jpeg().toBuffer())).toBe("jpeg");
    expect(photoKind(await base.clone().png().toBuffer())).toBe("png");
    expect(photoKind(await base.clone().webp().toBuffer())).toBe("webp");
    expect(photoKind(await base.clone().gif().toBuffer())).toBe("gif");
    expect(photoKind(await base.clone().avif().toBuffer())).toBe("avif");
  });

  it("knows an iPhone HEIC by its ISO box", () => {
    const heic = Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from("ftypheic", "latin1"), Buffer.alloc(12)]);
    expect(photoKind(heic)).toBe("heif");
    const mif = Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from("ftypmif1", "latin1"), Buffer.alloc(12)]);
    expect(photoKind(mif)).toBe("heif");
  });

  it("refuses an SVG, in every costume it can wear", () => {
    expect(photoKind(bytes('<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"></svg>'))).toBeNull();
    expect(photoKind(bytes('<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg"></svg>'))).toBeNull();
    // A byte-order mark or leading blanks do not turn it into a photo.
    expect(photoKind(bytes("﻿<svg xmlns='http://www.w3.org/2000/svg'></svg>"))).toBeNull();
    expect(photoKind(bytes("   \n  <svg xmlns='http://www.w3.org/2000/svg'></svg>"))).toBeNull();
  });

  it("refuses what libvips would still decode: PDF, TIFF, text, an ISO box that is not an image", () => {
    expect(photoKind(bytes("%PDF-1.7\n%âãÏÓ\n1 0 obj"))).toBeNull();
    expect(photoKind(Uint8Array.from([0x49, 0x49, 0x2a, 0x00, 8, 0, 0, 0, 0, 0, 0, 0]))).toBeNull();
    expect(photoKind(bytes("<html><script>alert(1)</script></html>"))).toBeNull();
    const mp4 = Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from("ftypisom", "latin1"), Buffer.alloc(12)]);
    expect(photoKind(mp4)).toBeNull();
  });

  it("refuses a RIFF that is not a WebP, and anything too short to tell", () => {
    expect(photoKind(bytes("RIFF....WAVEfmt "))).toBeNull();
    expect(photoKind(new Uint8Array(0))).toBeNull();
    expect(photoKind(Uint8Array.from([0xff, 0xd8, 0xff]))).toBeNull();
    expect(isPhoto(new Uint8Array(11))).toBe(false);
  });

  it("a JPEG header followed by an SVG is still told by its header, so the decoder sees a JPEG", () => {
    // The point of sniffing is that libvips picks its loader the same way
    // (by content): what we call a JPEG, it decodes as a JPEG.
    const sneaky = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from("<svg></svg>   ")]);
    expect(photoKind(sneaky)).toBe("jpeg");
  });
});

describe("the decode ceiling", () => {
  it("is well under sharp's default of 268 million pixels, and above any phone", () => {
    expect(MAX_INPUT_PIXELS).toBeLessThan(268_000_000);
    expect(MAX_INPUT_PIXELS).toBeGreaterThanOrEqual(50_000_000);
    expect(SAFE_DECODE.limitInputPixels).toBe(MAX_INPUT_PIXELS);
  });

  it("stops a picture that declares more pixels than the ceiling, before decoding it", async () => {
    // 12 000 × 12 000 = 144 MP of a single colour: a few KB as a PNG.
    const bomb = await sharp({ create: { width: 12_000, height: 12_000, channels: 3, background: "#000" } })
      .png({ compressionLevel: 9 })
      .toBuffer();
    expect(photoKind(bomb)).toBe("png");
    await expect(sharp(bomb, SAFE_DECODE).resize(64).toBuffer()).rejects.toThrow(/pixel/i);
  }, 60_000);

  it("lets a 48-megapixel phone photo through", async () => {
    const big = await sharp({ create: { width: 8000, height: 6000, channels: 3, background: "#888" } })
      .jpeg({ quality: 40 })
      .toBuffer();
    const out = await sharp(big, SAFE_DECODE).resize({ width: 320 }).webp().toBuffer();
    expect(photoKind(out)).toBe("webp");
  }, 60_000);
});
