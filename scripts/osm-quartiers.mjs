// Writes src/lib/geo/quartiers.ts: the named places under each délégation, from
// OpenStreetMap (© OpenStreetMap contributors, ODbL).
//
//   node scripts/osm-quartiers.mjs <workDir>
//
// <workDir> keeps the four Overpass answers (fetched when missing, so a rerun
// does not hit Overpass again):
//   dels.json      governorates (admin_level 4) and délégations (5), tags only
//   imadas.json    the imadas (admin_level 6) with their centre, and the
//                  villages, hamlets, towns and localities with their position
//   quarters.json  suburbs, quarters and neighbourhoods with their centre
//   places-in.json each village/suburb node followed by the délégation area it is in
//
// An imada names its délégation through its INS code (ref:tn:codegeo: 2 digits
// governorate, 2 délégation, 2 imada); a village or a neighbourhood through the
// délégation area Overpass finds it in (is_in). The OSM délégation is then
// matched to the site's own spelling (src/lib/delegations.ts), by its Arabic
// name first. A place named like its own délégation adds nothing and is left out.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const work = process.argv[2];
if (!work) {
  console.error("usage: node scripts/osm-quartiers.mjs <workDir>");
  process.exit(1);
}
const ROOT = fileURLToPath(new URL("..", import.meta.url));
const OVERPASS = "https://overpass-api.de/api/interpreter";
const TN = 'area["ISO3166-1"="TN"][admin_level=2]->.tn;';
const QUERIES = {
  "dels.json": `[out:json][timeout:240];${TN}(relation["boundary"="administrative"]["admin_level"~"^(4|5)$"](area.tn););out tags;`,
  "imadas.json": `[out:json][timeout:240];${TN}(relation["boundary"="administrative"]["admin_level"="6"](area.tn);node["place"~"^(village|hamlet|town|locality)$"](area.tn););out center tags;`,
  "quarters.json": `[out:json][timeout:180];${TN}(node["place"~"^(suburb|quarter|neighbourhood)$"](area.tn);way["place"~"^(suburb|quarter|neighbourhood)$"](area.tn);relation["place"~"^(suburb|quarter|neighbourhood)$"](area.tn););out center tags;`,
  "places-in.json": `[out:json][timeout:900];${TN}node["place"~"^(suburb|quarter|neighbourhood|village|hamlet|town)$"](area.tn)->.pl;foreach.pl->.p(.p out tags;.p is_in->.a;area.a["admin_level"="5"]->.d;.d out ids;);`,
};

async function load(file) {
  const path = join(work, file);
  if (!existsSync(path)) {
    console.log(`fetching ${file} from Overpass…`);
    const res = await fetch(OVERPASS, {
      method: "POST",
      headers: { "User-Agent": "mazed-immo-quartiers/1.0 (data build)", "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ data: QUERIES[file] }),
    });
    if (!res.ok) throw new Error(`${file}: Overpass answered ${res.status}`);
    writeFileSync(path, await res.text());
  }
  return JSON.parse(readFileSync(path, "utf8")).elements;
}

// ─── The site's names (src/lib/delegations.ts and src/lib/tunisia.ts) ───────
const src = readFileSync(join(ROOT, "src/lib/delegations.ts"), "utf8");
const body = src.slice(src.indexOf("export const DELEGATIONS"));
const SITE = {}; // governorate → [[fr, ar]]
let gov = null;
for (const line of body.split("\n")) {
  const g = line.match(/^ {2}(?:"([^"]+)"|([A-Za-zÀ-ÿ ]+)): \[/);
  if (g) gov = g[1] ?? g[2];
  if (gov) for (const [, fr, ar] of line.matchAll(/\["([^"]+)", "([^"]+)"\]/g)) (SITE[gov] ??= []).push([fr, ar]);
  if (/^};/.test(line)) break;
}

/** The repo's placeKey (src/lib/delegations.ts), plus the Arabic letter variants OSM and the list spell differently. */
function key(s) {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/['’`]/g, "")
    .replace(/[أإآ]/g, "ا")
    .replace(/ة/g, "ه")
    .replace(/ى/g, "ي")
    .replace(/[^a-z0-9؀-ۿ]+/g, " ")
    .trim();
}
/** Without the words a name may carry or drop: « Délégation », « معتمدية », « El », « La »… */
function core(s) {
  return ` ${key(s)} `
    .replace(/ (delegation|gouvernorat|معتمديه|ولايه) /g, " ")
    .replace(/ (el|al|la|le|les|l) /g, " ")
    .replace(/ ال/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Spelled too differently on the two sides to match by name: OSM name → the
// site's, « Gouvernorat|Délégation » when OSM gives the délégation no INS code.
// « Délégation Essaida » (Sidi Bouzid, no code) is not on the site's list.
const ALIASES = {
  "Délégation Cité Ettadhamen": "Ettadhamen",
  "Délégation Jendouba Sud": "Jendouba",
  "Délégation Mdhila": "Mdhilla",
  "Délégation Jarzouna": "Zarzouna",
  "Délégation Sidi Bourouis": "Bourouis",
  "Délégation Jammel": "Jemmal",
  "Délégation Regueb": "Sidi Bouzid|Regueb",
};

const els = {
  dels: await load("dels.json"),
  imadas: await load("imadas.json"),
  quarters: await load("quarters.json"),
  placesIn: await load("places-in.json"),
};

// ─── Governorates and délégations ───────────────────────────────────────────
const govByCode = {};
for (const e of els.dels.filter((x) => x.tags.admin_level === "4")) {
  const code = e.tags["ref:tn:codegeo"];
  const want = core(e.tags["name:fr"] ?? e.tags.name);
  const site = Object.keys(SITE).find((g) => core(g) === want || core(g).replace(/ /g, "") === want.replace(/ /g, ""));
  if (site && code) govByCode[code] = site;
  else console.log("governorate not matched:", e.tags["name:fr"] ?? e.tags.name, code);
}

const delByRel = {}; // OSM relation id → { gov, del }
const delByCode = {}; // INS code (4 digits) → { gov, del }
const unmatched = [];
for (const e of els.dels.filter((x) => x.tags.admin_level === "5")) {
  const code = e.tags["ref:tn:codegeo"];
  const fr = e.tags["name:fr"] ?? e.tags.name ?? "";
  const ar = e.tags["name:ar"] ?? "";
  const alias = ALIASES[fr]?.split("|");
  const g = code ? govByCode[code.slice(0, 2)] : alias?.length === 2 ? alias[0] : null;
  if (!g) {
    unmatched.push(`${fr} (${code ?? "no code"}): no governorate`);
    continue;
  }
  const list = SITE[g];
  const hit =
    (alias && list.find(([f]) => f === alias[alias.length - 1])) ||
    (ar && list.find(([, a]) => core(a) === core(ar))) ||
    list.find(([f]) => core(f) === core(fr)) ||
    list.find(([f]) => core(f).replace(/ /g, "") === core(fr).replace(/ /g, ""));
  if (!hit) {
    unmatched.push(`${g}: ${fr} / ${ar} (${code})`);
    continue;
  }
  delByRel[e.id] = { gov: g, del: hit[0] };
  if (code) delByCode[code] = delByRel[e.id];
}

// ─── The places ─────────────────────────────────────────────────────────────
const isArabic = (s) => /[؀-ۿ]/.test(s ?? "");
const names = (t) => {
  const fr = t["name:fr"] ?? (isArabic(t.name) ? null : t.name) ?? null;
  const ar = t["name:ar"] ?? (isArabic(t.name) ? t.name : null) ?? null;
  return { fr: fr?.trim() || null, ar: ar?.trim() || null };
};
const at = new Map(); // node id → { lat, lng }
for (const e of [...els.imadas, ...els.quarters]) {
  if (e.type === "node") at.set(e.id, { lat: e.lat, lng: e.lon });
}

const out = {}; // "gov|del" → Map(core(fr) → entry)
let placed = 0;
let skipped = 0;
function add(where, n, p, rank) {
  if (!where || !n.fr || !p) {
    skipped++;
    return;
  }
  if (core(n.fr) === core(where.del) || (n.ar && core(n.ar) === core(SITE[where.gov].find(([f]) => f === where.del)[1]))) return;
  const k = `${where.gov}|${where.del}`;
  const m = (out[k] ??= new Map());
  const c = core(n.fr);
  const had = m.get(c);
  // A village's or neighbourhood's own point beats an imada's centroid.
  if (!had || rank > had.rank) m.set(c, { fr: n.fr, ar: n.ar ?? had?.ar ?? n.fr, lat: p.lat, lng: p.lng, rank });
  placed++;
}

for (const e of els.imadas.filter((x) => x.type === "relation")) {
  const code = e.tags["ref:tn:codegeo"];
  add(code ? delByCode[code.slice(0, 4)] : null, names(e.tags), e.center && { lat: e.center.lat, lng: e.center.lon }, 1);
}
let cur = null;
for (const e of els.placesIn) {
  if (e.type === "node") cur = e;
  else if (e.type === "area" && cur) {
    add(delByRel[e.id - 3600000000], names(cur.tags), at.get(cur.id), 2);
    cur = null;
  }
}
// Neighbourhoods drawn as an area: in the délégation of the nearest imada.
const imadaPoints = els.imadas
  .filter((x) => x.type === "relation" && x.center && x.tags["ref:tn:codegeo"])
  .map((x) => ({ lat: x.center.lat, lng: x.center.lon, where: delByCode[x.tags["ref:tn:codegeo"].slice(0, 4)] }))
  .filter((x) => x.where);
for (const e of els.quarters.filter((x) => x.type !== "node" && x.center)) {
  const p = { lat: e.center.lat, lng: e.center.lon };
  let best = null;
  for (const i of imadaPoints) {
    const d = (i.lat - p.lat) ** 2 + ((i.lng - p.lng) * Math.cos((p.lat * Math.PI) / 180)) ** 2;
    if (!best || d < best.d) best = { d, where: i.where };
  }
  add(best?.where, names(e.tags), p, 2);
}

// ─── Write ──────────────────────────────────────────────────────────────────
const r5 = (n) => Math.round(n * 1e5) / 1e5;
const keys = Object.keys(out).sort();
let total = 0;
const lines = [
  "/**",
  " * The named places under each délégation — imadas, villages, neighbourhoods —",
  " * from OpenStreetMap (© OpenStreetMap contributors, ODbL). GENERATED by",
  ` * scripts/osm-quartiers.mjs on ${new Date().toISOString().slice(0, 10)}; do not edit by hand.`,
  " *",
  " * Keyed « Gouvernorat|Délégation » in the site's spelling (src/lib/delegations.ts);",
  " * each place is [French name, Arabic name, lat, lng]. Server-only: it is large.",
  " */",
  "export type Quartier = readonly [fr: string, ar: string, lat: number, lng: number];",
  "",
  "export const QUARTIERS: Record<string, readonly Quartier[]> = {",
];
for (const k of keys) {
  const list = [...out[k].values()].sort((a, b) => a.fr.localeCompare(b.fr, "fr"));
  total += list.length;
  lines.push(`  ${JSON.stringify(k)}: [`);
  for (const q of list) lines.push(`    [${JSON.stringify(q.fr)}, ${JSON.stringify(q.ar)}, ${r5(q.lat)}, ${r5(q.lng)}],`);
  lines.push("  ],");
}
lines.push("};", "");
writeFileSync(join(ROOT, "src/lib/geo/quartiers.ts"), lines.join("\n"));

const siteDels = Object.values(SITE).reduce((n, l) => n + l.length, 0);
console.log(`wrote ${total} places in ${keys.length} of ${siteDels} délégations (${placed} seen, ${skipped} without a name, a place or a délégation)`);
if (unmatched.length) console.log(`OSM délégations not matched (${unmatched.length}):\n  ${unmatched.join("\n  ")}`);
