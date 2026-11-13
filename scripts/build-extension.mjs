// Builds the download of the Prospection extension: public/downloads/mazed-prospection-extension.zip
//   node scripts/build-extension.mjs
// Run it after any change under extension/prospection and commit the zip (a test fails when they differ).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildZip, readFolder } from "./lib/zip.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SRC = path.join(ROOT, "extension", "prospection");
const OUT = path.join(ROOT, "public", "downloads", "mazed-prospection-extension.zip");

const zip = buildZip(readFolder(SRC), "mazed-prospection");
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, zip);
console.log(`${path.relative(ROOT, OUT)}: ${zip.length} bytes, ${readFolder(SRC).length} files`);
