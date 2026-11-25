/**
 * The small icons of the annonce cards, drawn ONCE per page (2026-11-25, the
 * speed plan, phase 2).
 *
 * Each card drew its own copies — the camera, the ruler, the bed, the bath,
 * the pin: about 600 inline SVGs on the home page, every one written twice
 * (in the HTML, and again in the data React sends to rebuild the page),
 * roughly half a megabyte of a 1.5 MB page. Now the layout carries one hidden
 * sprite and a card says `<use href="#mz-ci-ruler">` — a few dozen bytes.
 *
 * The drawings are lucide's, at the stroke the cards used. Not `display:none`:
 * some browsers draw nothing from a symbol inside a hidden SVG.
 */
import { Bath, BedDouble, Building2, Camera, MapPin, Ruler, Scale } from "lucide-react";

const ICONS = {
  camera: { Icon: Camera, stroke: 2.4 },
  ruler: { Icon: Ruler, stroke: 2 },
  bed: { Icon: BedDouble, stroke: 2 },
  bath: { Icon: Bath, stroke: 2 },
  building: { Icon: Building2, stroke: 2 },
  pin: { Icon: MapPin, stroke: 2 },
  // The « comparer » button on each card's photo (CompareToggle).
  scale: { Icon: Scale, stroke: 2.2 },
} as const;

export type CardIconName = keyof typeof ICONS;

/** Once, in the layout: the drawings every card points at. */
export function CardIconSprite() {
  return (
    <svg aria-hidden="true" focusable="false" width="0" height="0" style={{ position: "absolute", width: 0, height: 0, overflow: "hidden" }}>
      <defs>
        {(Object.keys(ICONS) as CardIconName[]).map((name) => {
          const { Icon, stroke } = ICONS[name];
          return (
            <symbol key={name} id={`mz-ci-${name}`} viewBox="0 0 24 24">
              <Icon width={24} height={24} strokeWidth={stroke} />
            </symbol>
          );
        })}
      </defs>
    </svg>
  );
}

/** One icon of a card, pointing at the sprite. Sized and coloured by `className` (currentColor). */
export function CardIcon({ name, className }: { name: CardIconName; className?: string }) {
  return (
    <svg aria-hidden="true" focusable="false" viewBox="0 0 24 24" className={className}>
      <use href={`#mz-ci-${name}`} />
    </svg>
  );
}
