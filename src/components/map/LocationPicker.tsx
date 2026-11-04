"use client";

import { useEffect, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Crosshair, Link2, Loader2, MapPin, Pencil, Trash2 } from "lucide-react";
import type * as MapLibre from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { useToast } from "@/components/ui/Toast";
import { useApiError } from "@/lib/useApiError";
import { GOVERNORATE_CENTER, TUNISIA_VIEW, inTunisia, isShortMapsLink, parseLocation, type LatLng } from "@/lib/geo/location";
import { cn } from "@/lib/utils";
import { governorateLabel } from "@/lib/tunisia";
import { outsideGovernorate } from "@/lib/geo/places";
import { MAP_STYLE, loadMapLibre } from "./maplibre";

export type PinValue = LatLng & { exact: boolean };

/**
 * « Position sur la carte » (0212) — optional. The seller puts the pin by
 * touching the map or dragging it, from their phone's position when they
 * stand in the property, or from a Google Maps link they paste (the way
 * agences pass a place on WhatsApp), then says what visitors see: a circle
 * around the quarter (the default) or the pin itself and a route.
 *
 * The map loads only once « Placer sur la carte » is pressed. What happens on
 * save is the caller's: the publish form keeps it with the draft, an annonce
 * online sends it at once, the console writes it for the seller.
 */
export function LocationPicker({
  value,
  governorate,
  radiusM,
  onSave,
  onClear,
  note,
}: {
  value: PinValue | null;
  /** Where the map opens before there is a pin. */
  governorate: string;
  /** The circle visitors see for an approximate place (map_approx_radius_m). */
  radiusM: number;
  onSave: (v: PinValue) => Promise<boolean> | boolean;
  onClear: () => Promise<boolean> | boolean;
  /** A line under the summary: « enregistrée tout de suite » on an annonce online. */
  note?: string;
}) {
  const t = useTranslations("listingMap");
  const locale = useLocale();
  const { toast } = useToast();
  const apiError = useApiError();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<LatLng | null>(value);
  const [exact, setExact] = useState(value?.exact ?? false);
  const [paste, setPaste] = useState("");
  const [reading, setReading] = useState(false);
  const [locating, setLocating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const box = useRef<HTMLDivElement>(null);
  const map = useRef<MapLibre.Map | null>(null);
  const marker = useRef<MapLibre.Marker | null>(null);
  const lib = useRef<typeof MapLibre | null>(null);
  const [ready, setReady] = useState(false);

  function edit() {
    setDraft(value);
    setExact(value?.exact ?? false);
    setPaste("");
    setError(null);
    setOpen(true);
  }

  // The map, while the editor is open.
  useEffect(() => {
    if (!open || !box.current) return;
    let gone = false;
    const start = value ?? null;
    void loadMapLibre().then((m) => {
      if (gone || !box.current) return;
      lib.current = m;
      const at = start ?? GOVERNORATE_CENTER[governorate] ?? TUNISIA_VIEW.center;
      const created = new m.Map({
        container: box.current,
        style: MAP_STYLE,
        center: [at.lng, at.lat],
        zoom: start ? 16 : GOVERNORATE_CENTER[governorate] ? 12 : TUNISIA_VIEW.zoom,
        attributionControl: { compact: true },
      });
      created.addControl(new m.NavigationControl({ showCompass: false }), "top-right");
      created.on("click", (e) => setDraft({ lat: e.lngLat.lat, lng: e.lngLat.lng }));
      map.current = created;
      setReady(true);
    });
    return () => {
      gone = true;
      marker.current?.remove();
      marker.current = null;
      map.current?.remove();
      map.current = null;
      setReady(false);
    };
    // Opened on the value it had; the pin moves inside without reopening.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // The pin follows the draft: a touch, a drag, a position, a pasted link.
  useEffect(() => {
    const m = lib.current;
    const created = map.current;
    if (!ready || !m || !created) return;
    if (!draft) {
      marker.current?.remove();
      marker.current = null;
      return;
    }
    if (!marker.current) {
      const mk = new m.Marker({ draggable: true, color: "#18181b" }).setLngLat([draft.lng, draft.lat]).addTo(created);
      mk.on("dragend", () => {
        const p = mk.getLngLat();
        setDraft({ lat: p.lat, lng: p.lng });
      });
      marker.current = mk;
    } else {
      marker.current.setLngLat([draft.lng, draft.lat]);
    }
  }, [draft, ready]);

  function moveTo(p: LatLng) {
    setDraft(p);
    setError(null);
    map.current?.flyTo({ center: [p.lng, p.lat], zoom: Math.max(map.current.getZoom(), 16) });
  }

  function myPosition() {
    if (!("geolocation" in navigator)) {
      setError(t("geoFailed"));
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLocating(false);
        const p = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        if (!inTunisia(p)) setError(t("outside"));
        else moveTo(p);
      },
      (err) => {
        setLocating(false);
        setError(err.code === err.PERMISSION_DENIED ? t("geoDenied") : t("geoFailed"));
      },
      { enableHighAccuracy: true, timeout: 12_000, maximumAge: 30_000 },
    );
  }

  async function readPaste() {
    const text = paste.trim();
    if (!text) return;
    setError(null);
    const read = parseLocation(text);
    if (read) {
      if (read.outside) setError(t("outside"));
      else moveTo(read);
      return;
    }
    if (!isShortMapsLink(text)) {
      setError(t("noPoint"));
      return;
    }
    setReading(true);
    try {
      const res = await fetch("/api/geo/maps-link", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: text }),
      });
      const j = (await res.json().catch(() => ({}))) as { lat?: number; lng?: number };
      if (!res.ok || typeof j.lat !== "number" || typeof j.lng !== "number") setError(apiError(j, t("noPoint")));
      else moveTo({ lat: j.lat, lng: j.lng });
    } catch {
      setError(t("noPoint"));
    } finally {
      setReading(false);
    }
  }

  async function save() {
    if (!draft) {
      setError(t("needPin"));
      return;
    }
    setSaving(true);
    try {
      if (await onSave({ ...draft, exact })) setOpen(false);
    } finally {
      setSaving(false);
    }
  }

  async function clear() {
    setSaving(true);
    try {
      if (await onClear()) {
        setOpen(false);
        toast(t("removed"), "success");
      }
    } finally {
      setSaving(false);
    }
  }

  const quiet = "mazed-btn-quiet tap-target inline-flex h-10 items-center gap-2 rounded-full px-4 text-[13px]";

  if (!open) {
    return (
      <div id="f-location" className="scroll-mt-24 rounded-xl border border-dashed border-border p-3.5">
        <p className="flex items-center gap-1.5 text-[13px] font-bold text-foreground">
          <MapPin className="size-4 shrink-0" />
          {t("title")}
          <span className="text-[11px] font-semibold text-subtle">· {t("optional")}</span>
        </p>
        {value ? (
          <>
            <p className="mt-1 text-[12.5px] text-muted">
              {value.exact ? t("savedExact") : t("savedApprox", { radius: radiusM })}
            </p>
            {note && <p className="mt-0.5 text-[11.5px] text-subtle">{note}</p>}
            <div className="mt-2.5 flex flex-wrap gap-2">
              <button type="button" onClick={edit} className={quiet}>
                <Pencil className="size-3.5" /> {t("edit")}
              </button>
              <button type="button" onClick={clear} disabled={saving} className={quiet}>
                <Trash2 className="size-3.5" /> {t("remove")}
              </button>
            </div>
          </>
        ) : (
          <>
            <p className="mt-1 text-[12.5px] leading-relaxed text-muted">{t("intro", { radius: radiusM })}</p>
            <button type="button" onClick={edit} className={cn(quiet, "mt-2.5")}>
              <MapPin className="size-4" /> {t("add")}
            </button>
          </>
        )}
      </div>
    );
  }

  return (
    <div id="f-location" className="scroll-mt-24 rounded-xl border border-border p-3.5">
      <p className="flex items-center gap-1.5 text-[13px] font-bold text-foreground">
        <MapPin className="size-4 shrink-0" />
        {t("title")}
      </p>
      <p className="mt-1 text-[12px] text-muted">{t("tapHint")}</p>

      <div className="relative mt-2.5 h-[300px] overflow-hidden rounded-xl bg-surface-2 ring-1 ring-border sm:h-[360px]">
        <div ref={box} className="h-full w-full" role="application" aria-label={t("mapLabel")} />
        {!ready && <Loader2 className="absolute start-1/2 top-1/2 size-5 -translate-x-1/2 -translate-y-1/2 animate-spin text-muted" />}
      </div>

      <div className="mt-2.5 flex flex-wrap items-center gap-2">
        <button type="button" onClick={myPosition} disabled={locating} className={quiet}>
          {locating ? <Loader2 className="size-4 animate-spin" /> : <Crosshair className="size-4" />}
          {locating ? t("locating") : t("myPosition")}
        </button>
      </div>

      <label htmlFor="f-location-paste" className="mt-3 block text-[10.5px] font-extrabold uppercase tracking-[0.12em] text-muted">
        {t("pasteLabel")}
      </label>
      <div className="mt-1 flex gap-2">
        <div className="relative min-w-0 flex-1">
          <Link2 className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted" />
          <input
            id="f-location-paste"
            dir="ltr"
            value={paste}
            onChange={(e) => setPaste(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                void readPaste();
              }
            }}
            placeholder={t("pastePlaceholder")}
            autoComplete="off"
            spellCheck={false}
            className="w-full rounded-xl border border-border bg-surface py-2.5 ps-9 pe-3 text-[14px] text-foreground placeholder:text-subtle focus:border-gold focus:outline-none"
          />
        </div>
        <button type="button" onClick={() => void readPaste()} disabled={reading || !paste.trim()} className="mazed-btn-quiet tap-target inline-flex h-11 shrink-0 items-center justify-center rounded-full px-4 text-[13px]">
          {reading ? <Loader2 className="size-4 animate-spin" /> : t("pasteGo")}
        </button>
      </div>

      <fieldset className="mt-3.5">
        <legend className="text-[10.5px] font-extrabold uppercase tracking-[0.12em] text-muted">{t("precisionLabel")}</legend>
        <div className="mt-1.5 grid gap-2 sm:grid-cols-2">
          {([false, true] as const).map((isExact) => (
            <label
              key={String(isExact)}
              className={cn(
                "flex cursor-pointer items-start gap-2.5 rounded-xl p-3 ring-1 transition",
                exact === isExact ? "bg-surface-2 ring-[var(--gold)]" : "ring-border hover:ring-[var(--gold-soft)]",
              )}
            >
              <input type="radio" name="location-precision" checked={exact === isExact} onChange={() => setExact(isExact)} className="mt-0.5 accent-[var(--gold)]" />
              <span>
                <span className="block text-[13px] font-bold text-foreground">{isExact ? t("exact") : t("approx")}</span>
                <span className="mt-0.5 block text-[11.5px] leading-snug text-muted">
                  {isExact ? t("exactHint") : t("approxHint", { radius: radiusM })}
                </span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      {error && <p role="alert" className="mt-2.5 text-[12px] font-bold text-danger">{error}</p>}
      {/* A pin in another governorate than the one chosen: a slip of the
          finger, or the wrong governorate. Said, not refused. */}
      {!error && draft && outsideGovernorate(governorate, draft) && (
        <p role="status" className="mt-2.5 text-[12px] font-bold text-[var(--tone-warn)]">
          {t("outsideGovernorate", { gov: governorateLabel(governorate, locale) })}
        </p>
      )}

      <div className="mt-3.5 flex flex-wrap items-center gap-2">
        <button type="button" onClick={() => void save()} disabled={saving} className="mazed-btn-luxe tap-target inline-flex h-11 items-center justify-center gap-1.5 rounded-full px-5 text-[13px]">
          {saving && <Loader2 className="size-4 animate-spin" />}
          {t("save")}
        </button>
        <button type="button" onClick={() => setOpen(false)} className="mazed-btn-quiet tap-target inline-flex h-11 items-center justify-center rounded-full px-5 text-[13px]">
          {t("cancel")}
        </button>
      </div>
    </div>
  );
}
