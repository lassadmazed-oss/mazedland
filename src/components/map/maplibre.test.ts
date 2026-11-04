/**
 * The map's worker and Arabic plugin are copies in public/maplibre/ (see
 * maplibre.ts). Upgrading the package without copying them again would pair
 * a page with another version's worker: this says so before it ships.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { MAPLIBRE_VERSION, MAP_WORKER_URL, RTL_TEXT_URL, RTL_TEXT_VERSION } from "./maplibre";

const root = process.cwd();
const pkg = (name: string) => JSON.parse(fs.readFileSync(path.join(root, "node_modules", name, "package.json"), "utf8")) as { version: string };
const same = (a: string, b: string) => fs.readFileSync(a).equals(fs.readFileSync(b));

describe("public/maplibre", () => {
  it("serves the installed MapLibre's worker", () => {
    expect(pkg("maplibre-gl").version).toBe(MAPLIBRE_VERSION);
    expect(same(path.join(root, "public", MAP_WORKER_URL), path.join(root, "node_modules/maplibre-gl/dist/maplibre-gl-worker.mjs"))).toBe(true);
  });
  it("serves the installed Arabic text plugin", () => {
    expect(pkg("@mapbox/mapbox-gl-rtl-text").version).toBe(RTL_TEXT_VERSION);
    expect(same(path.join(root, "public", RTL_TEXT_URL), path.join(root, "node_modules/@mapbox/mapbox-gl-rtl-text/dist/mapbox-gl-rtl-text.js"))).toBe(true);
  });
});
