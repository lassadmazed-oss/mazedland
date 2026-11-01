/**
 * A table as a CSV file Excel opens cleanly: UTF-8 with a byte-order mark
 * (so the Arabic is read as Arabic), a semicolon between cells (French Excel
 * splits on it; a comma would land everything in one cell), every cell
 * quoted when it holds the separator, a quote or a line break. Pure.
 */
export type CsvCell = string | number | boolean | null | undefined;

const SEPARATOR = ";";

export function csvCell(v: CsvCell): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "number") return String(v).replace(".", ",");
  if (typeof v === "boolean") return v ? "1" : "0";
  // A text starting with =, +, -, @, a tab or a return is read by Excel as a
  // formula: neutralised. A number stays a number (a negative amount above).
  const s = /^[=+\-@\t\r]/.test(v) ? `'${v}` : v;
  return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(header: readonly string[], rows: readonly (readonly CsvCell[])[]): string {
  const lines = [header.map(csvCell).join(SEPARATOR), ...rows.map((r) => r.map(csvCell).join(SEPARATOR))];
  return `﻿${lines.join("\r\n")}\r\n`;
}

/** A file name without what a file system refuses. */
export function csvFileName(base: string): string {
  const clean = base.toLowerCase().replace(/[^a-z0-9؀-ۿ]+/g, "-").replace(/^-|-$/g, "");
  return `${clean || "export"}.csv`;
}
