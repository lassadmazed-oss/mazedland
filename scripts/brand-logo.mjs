// ============================================================================
// Make the brand files in public/brand from the owner's logo
// (docs/brand/mazed-logo-source.jpg: gold on white, 1063 × 1280, 2026-11-01).
//
//   node scripts/brand-logo.mjs
//
// The JPEG has a white background. Taking the white out naively (« colour to
// alpha ») also takes the light gold out: the highlights come back 40 %
// opaque and the logo turns muddy on a dark surface. So the shape is opaque
// everywhere except its outer edge, and only the edge pixels — gold mixed
// with white by the anti-aliasing — get an alpha, measured against the solid
// ink beside them, and their colour un-mixed from the white. Over white the
// result looks exactly like the JPEG; over ink it has no white fringe.
//
// The owner wants the logo exactly as sent (« صلحه كيف ما بعثته لك »,
// 2026-11-01): the tower above, MAZED between its two rules below. A first
// version split it into a tower and a sideways MAZED for the bars; the owner
// turned it down. Never recompose it.
//
// Files (all transparent, trimmed to the ink):
//   mazed-logo.webp            the logo
//   mazed-logo-ondark.webp     the same for a dark surface: the black of the
//                              « A » and the gavel turned cream
//   mazed-logo.png             the logo for e-mail
// and public/og.png, the share picture. src/components/layout/BrandLogo.tsx
// holds each file's size; its test fails when they drift apart.
// ============================================================================
import sharp from "sharp";
import path from "node:path";
import { mkdirSync, statSync } from "node:fs";

const SRC = path.join("docs", "brand", "mazed-logo-source.jpg");
const OUT = path.join("public", "brand");
mkdirSync(OUT, { recursive: true });

const { data: rgb, info } = await sharp(SRC).removeAlpha().raw().toBuffer({ resolveWithObject: true });
const W = info.width;
const H = info.height;
const N = W * H;

// How far each pixel is from white, on its most absorbed channel: 0 on the
// paper, ~100 on the palest gold, ~200 on the deep gold, 255 on the black.
const d = new Float32Array(N);
for (let i = 0; i < N; i++) {
  d[i] = 255 - Math.min(rgb[i * 3], rgb[i * 3 + 1], rgb[i * 3 + 2]);
}

/** A square min or max filter of radius r over a Float32Array (separable). */
function rank(src, r, pick) {
  const tmp = new Float32Array(N);
  const out = new Float32Array(N);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      let v = src[y * W + x];
      for (let k = Math.max(0, x - r); k <= Math.min(W - 1, x + r); k++) v = pick(v, src[y * W + k]);
      tmp[y * W + x] = v;
    }
  }
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      let v = tmp[y * W + x];
      for (let k = Math.max(0, y - r); k <= Math.min(H - 1, y + r); k++) v = pick(v, tmp[k * W + x]);
      out[y * W + x] = v;
    }
  }
  return out;
}

const NOISE = 12; // JPEG noise on the paper
const INK = 40; // past this, a pixel is part of the shape

// The interior: the shape shrunk by two pixels. Everything in it is opaque,
// whatever its colour — a pale highlight against the black gavel included.
const shape = new Float32Array(N);
for (let i = 0; i < N; i++) shape[i] = d[i] > INK ? 1 : 0;
const interior = rank(shape, 2, Math.min);

// For an edge pixel, the ink it is a blend of: the strongest interior pixel
// within three pixels; for a stroke too thin to have an interior (the birds),
// the strongest pixel of any kind.
const interiorD = new Float32Array(N);
for (let i = 0; i < N; i++) interiorD[i] = interior[i] ? d[i] : 0;
const refInterior = rank(interiorD, 3, Math.max);
const refAny = rank(d, 3, Math.max);

const rgba = Buffer.alloc(N * 4);
const rgbaDark = Buffer.alloc(N * 4);
const CREAM = [250, 246, 236];
const smooth = (a, b, v) => {
  const t = Math.min(1, Math.max(0, (v - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
for (let i = 0; i < N; i++) {
  let a;
  if (interior[i]) a = 1;
  else {
    const ref = Math.max(refInterior[i] || refAny[i], 60);
    a = Math.min(1, Math.max(0, (d[i] - NOISE) / (ref - NOISE) / 0.9));
  }
  if (a < 0.04) a = 0;
  const c = [0, 1, 2].map((k) => {
    const v = rgb[i * 3 + k];
    return a > 0 ? Math.min(255, Math.max(0, 255 - (255 - v) / a)) : 0;
  });
  rgba[i * 4] = c[0];
  rgba[i * 4 + 1] = c[1];
  rgba[i * 4 + 2] = c[2];
  rgba[i * 4 + 3] = Math.round(a * 255);
  // On a dark surface the black of the « A » and the gavel would vanish:
  // neutral dark pixels turn cream; the gold keeps its colour.
  const hi = Math.max(...c);
  const sat = hi - Math.min(...c);
  const k = smooth(140, 70, hi) * smooth(60, 25, sat);
  for (let j = 0; j < 3; j++) rgbaDark[i * 4 + j] = Math.round(c[j] * (1 - k) + CREAM[j] * k);
  rgbaDark[i * 4 + 3] = rgba[i * 4 + 3];
}

/** The bounding box of the visible pixels between two rows. */
function bbox(y0, y1) {
  let minX = W, maxX = -1, minY = H, maxY = -1;
  for (let y = y0; y < y1; y++) {
    for (let x = 0; x < W; x++) {
      if (rgba[(y * W + x) * 4 + 3] > 10) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  return { left: minX, top: minY, width: maxX - minX + 1, height: maxY - minY + 1 };
}

const all = bbox(0, H);
console.log({ all });

const layer = (buf) => sharp(buf, { raw: { width: W, height: H, channels: 4 } });
const crop = (buf, box) => layer(buf).extract(box).png().toBuffer();

const webp = (png, file, height) =>
  sharp(png).resize({ height }).webp({ quality: 86, alphaQuality: 90, effort: 6 }).toFile(path.join(OUT, file));

// The logo as the owner drew it — the tower above, MAZED between its rules
// below, nothing moved — trimmed to the ink. 360 px tall: 3× its largest use.
await webp(await crop(rgba, all), "mazed-logo.webp", 360);
await webp(await crop(rgbaDark, all), "mazed-logo-ondark.webp", 240);
// E-mail clients want a PNG.
await sharp(await crop(rgba, all))
  .resize({ height: 216 })
  .png({ compressionLevel: 9, palette: true, quality: 95, dither: 0.6 })
  .toFile(path.join(OUT, "mazed-logo.png"));

// The share picture: the whole logo on white, centred, as before — sharper.
{
  const logo = await sharp(await crop(rgba, all)).resize({ height: 470 }).png().toBuffer();
  const lm = await sharp(logo).metadata();
  await sharp({ create: { width: 1200, height: 630, channels: 3, background: "#ffffff" } })
    .composite([{ input: logo, left: Math.round((1200 - lm.width) / 2), top: Math.round((630 - lm.height) / 2) }])
    .png({ compressionLevel: 9 })
    .toFile(path.join("public", "og.png"));
}

for (const f of ["mazed-logo.webp", "mazed-logo-ondark.webp", "mazed-logo.png"]) {
  const m = await sharp(path.join(OUT, f)).metadata();
  console.log(f, `${m.width}×${m.height}`, `${Math.round(statSync(path.join(OUT, f)).size / 1024)} kB`);
}
