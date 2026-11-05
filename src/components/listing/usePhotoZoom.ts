"use client";

import { useEffect, useRef, useState } from "react";
import { BUTTON_STEP, containedSize, NO_ZOOM, panBy, toggleZoom, WHEEL_STEP, zoomAt, type Point, type Size, type Zoom } from "@/lib/zoom";

// A tap: the finger lifted this soon and this close to where it went down.
const TAP_MS = 300;
const TAP_SLOP = 10;
// A double tap: the second tap this soon and this close to the first.
const DOUBLE_TAP_MS = 320;
const DOUBLE_TAP_SLOP = 30;

/**
 * Zooming into the photo of the full-screen gallery (the owner, 2026-11-05):
 * two fingers or a double tap on a phone, the wheel, a trackpad pinch, a
 * double click or the « + / − » buttons on a computer, and a drag to move
 * once zoomed in. The arithmetic is in `src/lib/zoom.ts`.
 *
 * `frameRef` is the box the photo is drawn in, `natural` the photo's own
 * size once loaded (for where its edges are). While zoomed in or after a
 * pinch, `blocksSwipe()` tells the carousel the finger was not changing photo.
 */
export function usePhotoZoom({
  enabled,
  max,
  frameRef,
  natural,
}: {
  enabled: boolean;
  max: number;
  frameRef: React.RefObject<HTMLDivElement | null>;
  natural: () => Size | null;
}) {
  const [zoom, setZoom] = useState<Zoom>(NO_ZOOM);
  const [gesturing, setGesturing] = useState(false);
  const zoomRef = useRef(zoom);
  const pointers = useRef(new Map<number, Point>());
  const pinch = useRef<{ dist: number; mid: Point } | null>(null);
  const down = useRef<{ t: number; x: number; y: number; many: boolean } | null>(null);
  const lastTap = useRef<{ t: number; x: number; y: number } | null>(null);
  const gestured = useRef(false);
  const lastType = useRef("");
  // The latest `natural` without re-attaching the wheel listener.
  const naturalRef = useRef(natural);
  useEffect(() => {
    naturalRef.current = natural;
  });

  function geometry() {
    const r = frameRef.current?.getBoundingClientRect();
    const frame: Size = { w: r?.width ?? 1, h: r?.height ?? 1 };
    return {
      frame,
      content: containedSize(frame, naturalRef.current()),
      at: (p: Point): Point => ({ x: p.x - (r ? r.left + r.width / 2 : 0), y: p.y - (r ? r.top + r.height / 2 : 0) }),
    };
  }

  function apply(z: Zoom) {
    zoomRef.current = z;
    setZoom(z);
  }

  function reset() {
    apply(NO_ZOOM);
  }

  /** « + » and « − »: about the frame's centre. */
  function zoomBy(factor: number) {
    const g = geometry();
    apply(zoomAt(zoomRef.current, factor, { x: 0, y: 0 }, max, g.frame, g.content));
  }

  // The wheel, and a trackpad's pinch (a wheel with ctrlKey): a listener that
  // may cancel, or the browser would zoom the whole page instead.
  useEffect(() => {
    const el = frameRef.current;
    if (!enabled || !el) return;
    function onWheel(e: WheelEvent) {
      e.preventDefault();
      const r = el!.getBoundingClientRect();
      const frame = { w: r.width, h: r.height };
      const factor = e.ctrlKey ? Math.exp(-e.deltaY * 0.01) : e.deltaY < 0 ? WHEEL_STEP : 1 / WHEEL_STEP;
      const at = { x: e.clientX - (r.left + r.width / 2), y: e.clientY - (r.top + r.height / 2) };
      apply(zoomAt(zoomRef.current, factor, at, max, frame, containedSize(frame, naturalRef.current())));
    }
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [enabled, max, frameRef]);

  function onPointerDown(e: React.PointerEvent) {
    if (!enabled || (e.pointerType === "mouse" && e.button !== 0)) return;
    lastType.current = e.pointerType;
    e.currentTarget.setPointerCapture?.(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 1) {
      gestured.current = false;
      down.current = { t: Date.now(), x: e.clientX, y: e.clientY, many: false };
    } else if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      pinch.current = { dist: Math.hypot(a.x - b.x, a.y - b.y), mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } };
      gestured.current = true;
      if (down.current) down.current.many = true;
    }
  }

  function onPointerMove(e: React.PointerEvent) {
    const was = pointers.current.get(e.pointerId);
    if (!enabled || !was) return;
    const now = { x: e.clientX, y: e.clientY };
    pointers.current.set(e.pointerId, now);
    const g = geometry();
    if (pointers.current.size >= 2 && pinch.current) {
      const [a, b] = [...pointers.current.values()];
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      let z = zoomAt(zoomRef.current, pinch.current.dist > 0 ? dist / pinch.current.dist : 1, g.at(mid), max, g.frame, g.content);
      z = panBy(z, mid.x - pinch.current.mid.x, mid.y - pinch.current.mid.y, g.frame, g.content);
      pinch.current = { dist, mid };
      setGesturing(true);
      apply(z);
    } else if (zoomRef.current.scale > 1) {
      const dx = now.x - was.x;
      const dy = now.y - was.y;
      if (Math.abs(dx) + Math.abs(dy) > 0) {
        gestured.current = true;
        setGesturing(true);
        apply(panBy(zoomRef.current, dx, dy, g.frame, g.content));
      }
    }
  }

  function onPointerUp(e: React.PointerEvent) {
    if (!pointers.current.delete(e.pointerId)) return;
    if (pointers.current.size < 2) pinch.current = null;
    if (pointers.current.size > 0) return;
    setGesturing(false);
    // A double tap on a touch screen (a mouse has its double click).
    const d = down.current;
    down.current = null;
    if (e.pointerType === "mouse" || !d || d.many) return;
    const t = Date.now();
    if (t - d.t > TAP_MS || Math.hypot(e.clientX - d.x, e.clientY - d.y) > TAP_SLOP) return;
    const prev = lastTap.current;
    if (prev && t - prev.t < DOUBLE_TAP_MS && Math.hypot(e.clientX - prev.x, e.clientY - prev.y) < DOUBLE_TAP_SLOP) {
      lastTap.current = null;
      gestured.current = true;
      const g = geometry();
      apply(toggleZoom(zoomRef.current, g.at({ x: e.clientX, y: e.clientY }), max, g.frame, g.content));
    } else {
      lastTap.current = { t, x: e.clientX, y: e.clientY };
    }
  }

  function onDoubleClick(e: React.MouseEvent) {
    if (!enabled || lastType.current !== "mouse") return;
    const g = geometry();
    apply(toggleZoom(zoomRef.current, g.at({ x: e.clientX, y: e.clientY }), max, g.frame, g.content));
  }

  return {
    zoom,
    gesturing,
    reset,
    zoomIn: () => zoomBy(BUTTON_STEP),
    zoomOut: () => zoomBy(1 / BUTTON_STEP),
    /** This touch zoomed, moved a zoomed photo or double-tapped: it was not a swipe. */
    blocksSwipe: () => gestured.current || zoomRef.current.scale > 1,
    handlers: enabled
      ? { onPointerDown, onPointerMove, onPointerUp, onPointerCancel: onPointerUp, onDoubleClick }
      : {},
  };
}
