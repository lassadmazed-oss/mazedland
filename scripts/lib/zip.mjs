// A minimal zip writer (no compression), so the extension can be offered as one file without a library.
// The same files always give the same bytes (fixed dates, sorted names): a test compares the committed zip
// with what the extension's folder builds today, so the download cannot drift from the source.
import fs from "node:fs";
import path from "node:path";

const TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

// 1 January 2026, midnight, in DOS format.
const DOS_TIME = 0;
const DOS_DATE = ((2026 - 1980) << 9) | (1 << 5) | 1;

// A checkout on Windows may turn LF into CRLF: the zip is always made from the LF text, so it is the same everywhere.
const TEXT = /\.(js|json|html|css|md|txt)$/;
const canonical = (name, data) => (TEXT.test(name) ? Buffer.from(data.toString("utf8").replace(/\r\n/g, "\n"), "utf8") : data);

/** Every file under `dir`, as { name: 'a/b.js' (posix), data }, sorted by name. */
export function readFolder(dir) {
  const out = [];
  const walk = (d, prefix) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, e.name);
      const name = prefix ? `${prefix}/${e.name}` : e.name;
      if (e.isDirectory()) walk(full, name);
      else out.push({ name, data: canonical(name, fs.readFileSync(full)) });
    }
  };
  walk(dir, "");
  return out.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}

/** The zip of the entries, every name under `root/`. */
export function buildZip(entries, root) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const e of entries) {
    const name = Buffer.from(`${root}/${e.name}`, "utf8");
    const crc = crc32(e.data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6); // UTF-8 names
    local.writeUInt16LE(0, 8); // stored
    local.writeUInt16LE(DOS_TIME, 10);
    local.writeUInt16LE(DOS_DATE, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(e.data.length, 18);
    local.writeUInt32LE(e.data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    locals.push(local, name, e.data);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt16LE(DOS_TIME, 12);
    central.writeUInt16LE(DOS_DATE, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(e.data.length, 20);
    central.writeUInt32LE(e.data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, name);
    offset += 30 + name.length + e.data.length;
  }
  const centralBuf = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralBuf.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, centralBuf, end]);
}
