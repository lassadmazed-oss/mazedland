/**
 * The pictures of the install guide (2026-11-25): what the visitor's phone
 * shows at each step, drawn the way it looks — Safari's bar and its menus,
 * Chrome's ⋮ menu, the « Ajouter » dialog, Facebook's and Instagram's browser —
 * with a RED pulsing circle on the one thing to tap (the owner: « like in real,
 * a red circle, easy to see, clean »).
 *
 * Plain SVG: crisp on every screen, no image to download, the words in the
 * page's language. The phone is drawn in light mode, as phones mostly are.
 */
import { useId } from "react";
import type { GuideScene } from "@/lib/pwa/guide";

export type SceneKind = GuideScene;

export type SceneLabels = {
  site: string;
  share: string;
  addFavorite: string;
  newTab: string;
  copy: string;
  readingList: string;
  addHome: string;
  add: string;
  cancel: string;
  webApp: string;
  install: string;
  installApp: string;
  history: string;
  downloads: string;
  settings: string;
  openBrowser: string;
  openChrome: string;
  refresh: string;
  copyLink: string;
  addPageTo: string;
  appName: string;
};

const RED = "#ef4444";
const INK = "#111827";
const MUTED = "#6b7280";
const LINE = "#e5e7eb";

/** The red circle that says « here », breathing so the eye finds it. */
function Tap({ x, y, r = 19 }: { x: number; y: number; r?: number }) {
  return (
    <g pointerEvents="none">
      <circle cx={x} cy={y} r={r} fill={RED} opacity="0.2">
        <animate attributeName="r" values={`${r};${r + 9};${r}`} dur="1.4s" repeatCount="indefinite" />
        <animate attributeName="opacity" values="0.32;0.04;0.32" dur="1.4s" repeatCount="indefinite" />
      </circle>
      <circle cx={x} cy={y} r={r} fill="none" stroke={RED} strokeWidth="3.5" />
    </g>
  );
}

/**
 * A red frame around a button with words (« Installer », « Ajouter ») or a menu
 * line: a circle there would hide the word. It breathes like the circle.
 */
function TapBox({ x, y, w, h, rx = 12 }: { x: number; y: number; w: number; h: number; rx?: number }) {
  return (
    <g pointerEvents="none">
      <rect x={x - 4} y={y - 4} width={w + 8} height={h + 8} rx={rx + 4} fill="none" stroke={RED} strokeWidth="6" opacity="0.3">
        <animate attributeName="stroke-width" values="5;15;5" dur="1.4s" repeatCount="indefinite" />
        <animate attributeName="opacity" values="0.35;0;0.35" dur="1.4s" repeatCount="indefinite" />
      </rect>
      <rect x={x - 4} y={y - 4} width={w + 8} height={h + 8} rx={rx + 4} fill="none" stroke={RED} strokeWidth="3.5" />
    </g>
  );
}

/** The page behind: a photo, a title, a few lines — the annonce they were looking at. */
function Page({ top = 34, bottom = 400 }: { top?: number; bottom?: number }) {
  return (
    <g>
      <rect x="0" y={top} width="240" height={bottom - top} fill="#ffffff" />
      <rect x="14" y={top + 12} width="212" height="110" rx="12" fill="#e9e3d6" />
      <path d={`M40 ${top + 102} l30 -34 l22 22 l16 -14 l34 26 z`} fill="#d4c7ad" />
      <circle cx="176" cy={top + 44} r="11" fill="#f2d48a" />
      <rect x="14" y={top + 134} width="150" height="12" rx="6" fill="#d1d5db" />
      <rect x="14" y={top + 154} width="96" height="10" rx="5" fill="#c08b2c" opacity="0.7" />
      <rect x="14" y={top + 176} width="212" height="8" rx="4" fill={LINE} />
      <rect x="14" y={top + 190} width="190" height="8" rx="4" fill={LINE} />
      <rect x="14" y={top + 204} width="170" height="8" rx="4" fill={LINE} />
    </g>
  );
}

function StatusBar({ dark = false }: { dark?: boolean }) {
  const c = dark ? "#ffffff" : INK;
  return (
    <g>
      <text x="22" y="20" fontSize="11" fontWeight="700" fill={c} fontFamily="system-ui, -apple-system, sans-serif">9:41</text>
      <rect x="196" y="11" width="22" height="10" rx="3" fill="none" stroke={c} strokeWidth="1.2" />
      <rect x="198" y="13" width="15" height="6" rx="1.5" fill={c} />
    </g>
  );
}

function Dots({ x, y, vertical = false, color = INK }: { x: number; y: number; vertical?: boolean; color?: string }) {
  const p = vertical ? [[0, -5], [0, 0], [0, 5]] : [[-5, 0], [0, 0], [5, 0]];
  return <g fill={color}>{p.map(([dx, dy], i) => <circle key={i} cx={x + dx} cy={y + dy} r="1.9" />)}</g>;
}

/** iOS share icon: a square with an arrow up. */
function ShareIcon({ x, y, color = "#0a84ff" }: { x: number; y: number; color?: string }) {
  return (
    <g fill="none" stroke={color} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d={`M${x - 5} ${y - 1} h-2 v10 h14 v-10 h-2`} />
      <path d={`M${x} ${y - 9} v10 M${x - 4} ${y - 5} l4 -4 l4 4`} />
    </g>
  );
}

function PlusSquare({ x, y, color = INK }: { x: number; y: number; color?: string }) {
  return (
    <g fill="none" stroke={color} strokeWidth="1.6" strokeLinecap="round">
      <rect x={x - 7} y={y - 7} width="14" height="14" rx="3.5" />
      <path d={`M${x} ${y - 3.5} v7 M${x - 3.5} ${y} h7`} />
    </g>
  );
}

function Txt({ x, y, children, size = 11.5, weight = 500, color = INK, anchor = "start", rtl = false }: { x: number; y: number; children: string; size?: number; weight?: number; color?: string; anchor?: "start" | "middle" | "end"; rtl?: boolean }) {
  return (
    <text x={x} y={y} fontSize={size} fontWeight={weight} fill={color} textAnchor={anchor} direction={rtl ? "rtl" : undefined} fontFamily="system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif">
      {children}
    </text>
  );
}

/** A menu card: rows of icon + label, one of them framed in red. */
function Menu({ x, y, w, rows, hot, rowH = 30, rtl = false }: { x: number; y: number; w: number; rows: { label: string; icon?: React.ReactNode }[]; hot: number; rowH?: number; rtl?: boolean }) {
  return (
    <g>
      <rect x={x} y={y} width={w} height={rows.length * rowH + 8} rx="14" fill="#ffffff" stroke={LINE} />
      {rows.map((r, i) => (
        <g key={i}>
          {i > 0 && <line x1={x + 12} x2={x + w - 12} y1={y + 4 + i * rowH} y2={y + 4 + i * rowH} stroke={LINE} />}
          {/* Right to left in Arabic: the words from the right edge, the icon on the left. */}
          {/* With direction="rtl", SVG's « start » is the right edge. */}
          <Txt x={rtl ? x + w - 14 : x + 14} y={y + 4 + i * rowH + rowH / 2 + 4} anchor="start" rtl={rtl}>{r.label}</Txt>
          {r.icon && <g transform={`translate(${rtl ? x + 22 : x + w - 22} ${y + 4 + i * rowH + rowH / 2})`}>{r.icon}</g>}
        </g>
      ))}
      <TapBox x={x + 6} y={y + 4 + hot * rowH + 4} w={w - 12} h={rowH - 8} rx={8} />
    </g>
  );
}

function Dim() {
  return <rect x="0" y="0" width="240" height="400" fill="#000000" opacity="0.28" />;
}

/**
 * Each picture is zoomed on the part of the phone where the tap is — the top
 * (address bar, ⋮ menu), the middle (a dialog) or the bottom (Safari's bar, the
 * share sheet) — so the words read at the size of the real screen; the cut
 * edge fades out.
 */
const CROP: Record<SceneKind, "top" | "middle" | "bottom"> = {
  "safari-bar": "bottom",
  "safari-menu": "bottom",
  "ios-share-sheet": "bottom",
  "ios-add-dialog": "top",
  "ios-share-bar-old": "bottom",
  "chrome-ios-bar": "top",
  "chrome-android-bar": "top",
  "chrome-android-menu": "top",
  "android-install-dialog": "middle",
  "samsung-bar": "bottom",
  "samsung-menu": "bottom",
  "inapp-ios-bar": "top",
  "inapp-ios-menu": "bottom",
  "inapp-android-bar": "top",
  "inapp-android-menu": "top",
};
const Y0 = { top: 0, middle: 85, bottom: 170 } as const;
/** The height of every picture, in the phone's units (240 wide). */
export const SCENE_H = 230;
const FADE = {
  top: "linear-gradient(to bottom, #000 78%, transparent)",
  bottom: "linear-gradient(to top, #000 78%, transparent)",
  middle: "linear-gradient(to bottom, transparent, #000 14%, #000 86%, transparent)",
} as const;

export function Scene({ kind, L, rtl }: { kind: SceneKind; L: SceneLabels; rtl: boolean }) {
  // One clip per picture: the carousel draws several at once.
  const clip = `mz-phone-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  // The real Mazed icon, with the rounded corners of a phone's icons.
  const appIcon = (x: number, y: number, s: number) => (
    <image href="/icons/icon-192.png" x={x} y={y} width={s} height={s} clipPath={`url(#${clip}-icon)`} />
  );
  const body = (() => {
    switch (kind) {
      // ── iPhone, Safari (iOS 26): the floating bar at the bottom, ••• beside the address.
      case "safari-bar":
        return (
          <>
            <Page />
            <rect x="12" y="346" width="216" height="40" rx="20" fill="#f9fafb" stroke={LINE} />
            <path d="M32 360 l-6 6 l6 6" fill="none" stroke={INK} strokeWidth="2" strokeLinecap="round" />
            <Txt x={120} y={370} anchor="middle" size={12} weight={600}>{L.site}</Txt>
            <Dots x={204} y={366} />
            <Tap x={204} y={366} />
          </>
        );
      case "safari-menu":
        return (
          <>
            <Page />
            <Dim />
            <Menu
              rtl={rtl}
              x={56}
              y={210}
              w={172}
              hot={0}
              rows={[
                { label: L.share, icon: <ShareIcon x={0} y={1} color={INK} /> },
                { label: L.addFavorite },
                { label: L.newTab },
                { label: L.refresh },
              ]}
            />
            <rect x="12" y="346" width="216" height="40" rx="20" fill="#f9fafb" stroke={LINE} />
            <Txt x={120} y={370} anchor="middle" size={12} weight={600}>{L.site}</Txt>
            <Dots x={204} y={366} />
          </>
        );
      case "ios-share-sheet":
        return (
          <>
            <Page />
            <Dim />
            <rect x="0" y="150" width="240" height="250" rx="18" fill="#f2f2f7" />
            <rect x="104" y="158" width="32" height="4" rx="2" fill="#c7c7cc" />
            <rect x="14" y="172" width="212" height="40" rx="10" fill="#ffffff" />
            {appIcon(22, 180, 24)}
            <Txt x={54} y={190} size={11} weight={700}>{L.appName}</Txt>
            <Txt x={54} y={204} size={9.5} color={MUTED}>{L.site}</Txt>
            <Menu
              rtl={rtl}
              x={14}
              y={222}
              w={212}
              hot={2}
              rowH={32}
              rows={[
                { label: L.copy },
                { label: L.readingList },
                { label: L.addHome, icon: <PlusSquare x={0} y={0} /> },
                { label: L.addFavorite },
              ]}
            />
          </>
        );
      case "ios-add-dialog":
        return (
          <>
            <rect x="0" y="34" width="240" height="366" fill="#f2f2f7" />
            <Txt x={18} y={58} size={12} color="#0a84ff">{L.cancel}</Txt>
            <Txt x={120} y={58} size={12} weight={700} anchor="middle">{L.addHome}</Txt>
            <Txt x={222} y={58} size={12} weight={700} color="#0a84ff" anchor="end">{L.add}</Txt>
            <TapBox x={rtl ? 186 : 180} y={45} w={rtl ? 38 : 44} h={18} rx={7} />
            <rect x="14" y="78" width="212" height="64" rx="12" fill="#ffffff" />
            {appIcon(24, 88, 44)}
            <Txt x={78} y={106} size={12.5} weight={700}>{L.appName}</Txt>
            <Txt x={78} y={124} size={10} color={MUTED}>{L.site}</Txt>
            <rect x="14" y="154" width="212" height="40" rx="12" fill="#ffffff" />
            <Txt x={26} y={178} size={11.5}>{L.webApp}</Txt>
            <rect x="182" y="164" width="34" height="20" rx="10" fill="#34c759" />
            <circle cx="206" cy="174" r="8" fill="#ffffff" />
          </>
        );
      // ── iPhone, iOS 18 and older: the Share button in the bottom toolbar.
      case "ios-share-bar-old":
        return (
          <>
            <Page bottom={340} />
            <rect x="0" y="340" width="240" height="60" fill="#f9fafb" stroke={LINE} />
            <rect x="14" y="300" width="212" height="30" rx="10" fill="#eef0f3" />
            <Txt x={120} y={319} anchor="middle" size={11.5} weight={600}>{L.site}</Txt>
            <path d="M28 364 l-6 6 l6 6" fill="none" stroke="#0a84ff" strokeWidth="2" strokeLinecap="round" />
            <path d="M70 364 l6 6 l-6 6" fill="none" stroke="#c7c7cc" strokeWidth="2" strokeLinecap="round" />
            <ShareIcon x={120} y={372} />
            <Tap x={120} y={368} />
            <rect x="162" y="360" width="14" height="16" rx="2" fill="none" stroke="#0a84ff" strokeWidth="1.6" />
            <rect x="204" y="360" width="14" height="14" rx="3" fill="none" stroke="#0a84ff" strokeWidth="1.6" />
          </>
        );
      // ── iPhone, Chrome / Edge / Firefox: Share is in the address bar at the top.
      case "chrome-ios-bar":
        return (
          <>
            <rect x="0" y="30" width="240" height="44" fill="#f9fafb" stroke={LINE} />
            <rect x="12" y="38" width="176" height="28" rx="14" fill="#eef0f3" />
            <Txt x={26} y={57} size={11.5} weight={600}>{L.site}</Txt>
            <ShareIcon x={210} y={56} color={INK} />
            <Tap x={210} y={52} />
            <Page top={74} />
          </>
        );
      // ── Android, Chrome: ⋮ at the top right, then « Installer l'application ».
      case "chrome-android-bar":
        return (
          <>
            <rect x="0" y="30" width="240" height="44" fill="#ffffff" stroke={LINE} />
            <rect x="12" y="38" width="190" height="28" rx="14" fill="#f1f3f4" />
            <Txt x={26} y={57} size={11.5} weight={600}>{L.site}</Txt>
            <Dots x={222} y={52} vertical />
            <Tap x={222} y={52} />
            <Page top={74} />
          </>
        );
      case "chrome-android-menu":
        return (
          <>
            <rect x="0" y="30" width="240" height="44" fill="#ffffff" stroke={LINE} />
            <Page top={74} />
            <Dim />
            <Menu
              rtl={rtl}
              x={70}
              y={40}
              w={162}
              hot={3}
              rowH={30}
              rows={[
                { label: L.newTab },
                { label: L.history },
                { label: L.downloads },
                { label: L.installApp, icon: <PlusSquare x={0} y={0} /> },
                { label: L.settings },
              ]}
            />
          </>
        );
      case "android-install-dialog":
        return (
          <>
            <Page />
            <Dim />
            <rect x="24" y="140" width="192" height="130" rx="18" fill="#ffffff" />
            {appIcon(40, 158, 36)}
            <Txt x={86} y={174} size={12.5} weight={700}>{L.installApp}</Txt>
            <Txt x={86} y={190} size={10} color={MUTED}>{L.site}</Txt>
            <Txt x={112} y={248} size={12} weight={600} color="#1a73e8" anchor="end">{L.cancel}</Txt>
            <rect x="140" y="232" width="64" height="26" rx="13" fill="#1a73e8" />
            <Txt x={172} y={249} size={11.5} weight={700} color="#ffffff" anchor="middle">{L.install}</Txt>
            <TapBox x={140} y={232} w={64} h={26} rx={13} />
          </>
        );
      // ── Android, Samsung Internet: ☰ at the bottom.
      case "samsung-bar":
        return (
          <>
            <Page bottom={350} />
            <rect x="0" y="350" width="240" height="50" fill="#ffffff" stroke={LINE} />
            <path d="M24 370 l-6 6 l6 6" fill="none" stroke={INK} strokeWidth="2" strokeLinecap="round" />
            <path d="M66 370 l6 6 l-6 6" fill="none" stroke="#c7c7cc" strokeWidth="2" strokeLinecap="round" />
            <path d="M112 368 l8 -6 l8 6 v10 h-16 z" fill="none" stroke={INK} strokeWidth="1.6" />
            <g stroke={INK} strokeWidth="2" strokeLinecap="round">
              <path d="M206 369 h16 M206 375 h16 M206 381 h16" />
            </g>
            <Tap x={214} y={375} />
          </>
        );
      case "samsung-menu":
        return (
          <>
            <Page bottom={350} />
            <Dim />
            <Menu rtl={rtl} x={20} y={210} w={200} hot={1} rowH={32} rows={[{ label: L.addFavorite }, { label: L.addPageTo, icon: <PlusSquare x={0} y={0} /> }, { label: L.settings }]} />
          </>
        );
      // ── Inside Facebook / Instagram on an iPhone: ••• at the top, then « open in browser ».
      case "inapp-ios-bar":
        return (
          <>
            <rect x="0" y="30" width="240" height="44" fill="#ffffff" stroke={LINE} />
            <path d="M18 46 l12 12 M30 46 l-12 12" stroke={INK} strokeWidth="2" strokeLinecap="round" />
            <Txt x={120} y={56} anchor="middle" size={11.5} weight={700}>{L.site}</Txt>
            <Dots x={218} y={52} />
            <Tap x={218} y={52} />
            <Page top={74} />
          </>
        );
      case "inapp-ios-menu":
        return (
          <>
            <Page />
            <Dim />
            <rect x="10" y="230" width="220" height="160" rx="16" fill="#ffffff" />
            <Menu rtl={rtl} x={18} y={240} w={204} hot={0} rowH={34} rows={[{ label: L.openBrowser }, { label: L.copyLink }, { label: L.refresh }]} />
          </>
        );
      // ── Inside Facebook / Instagram on Android: ⋮ at the top, then « Open in Chrome ».
      case "inapp-android-bar":
        return (
          <>
            <rect x="0" y="30" width="240" height="44" fill="#ffffff" stroke={LINE} />
            <path d="M18 46 l12 12 M30 46 l-12 12" stroke={INK} strokeWidth="2" strokeLinecap="round" />
            <Txt x={44} y={56} size={11.5} weight={700}>{L.site}</Txt>
            <Dots x={222} y={52} vertical />
            <Tap x={222} y={52} />
            <Page top={74} />
          </>
        );
      case "inapp-android-menu":
        return (
          <>
            <rect x="0" y="30" width="240" height="44" fill="#ffffff" stroke={LINE} />
            <Page top={74} />
            <Dim />
            <Menu rtl={rtl} x={60} y={40} w={172} hot={0} rowH={32} rows={[{ label: L.openChrome }, { label: L.copyLink }, { label: L.refresh }]} />
          </>
        );
    }
  })();

  return (
    <svg
      viewBox={`0 ${Y0[CROP[kind]]} 240 ${SCENE_H}`}
      aria-hidden="true"
      className="h-full w-full"
      // The phone is drawn left to right; on the Arabic pages the texts would inherit
      // « rtl » and flip their anchors. Only the menu labels are right to left (Menu).
      direction="ltr"
      style={{ direction: "ltr", maskImage: FADE[CROP[kind]], WebkitMaskImage: FADE[CROP[kind]] }}
    >
      <defs>
        <clipPath id={clip}>
          <rect x="0" y="0" width="240" height="400" rx="30" />
        </clipPath>
        <clipPath id={`${clip}-icon`} clipPathUnits="objectBoundingBox">
          <rect x="0" y="0" width="1" height="1" rx="0.23" />
        </clipPath>
      </defs>
      <g clipPath={`url(#${clip})`}>
        <rect x="0" y="0" width="240" height="400" fill="#ffffff" />
        <StatusBar />
        {body}
      </g>
      <rect x="1" y="1" width="238" height="398" rx="29" fill="none" stroke="#111827" strokeWidth="2" />
    </svg>
  );
}
