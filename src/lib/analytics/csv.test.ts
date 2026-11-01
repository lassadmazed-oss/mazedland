import { describe, expect, it } from "vitest";
import { csvCell, csvFileName, toCsv } from "./csv";

describe("csv", () => {
  it("quotes what holds the separator, a quote or a line break", () => {
    expect(csvCell("Sfax")).toBe("Sfax");
    expect(csvCell("Sfax; Sud")).toBe('"Sfax; Sud"');
    expect(csvCell('dit "oui"')).toBe('"dit ""oui"""');
    expect(csvCell("a\nb")).toBe('"a\nb"');
  });

  it("writes numbers the French way and empties for nothing", () => {
    expect(csvCell(12.5)).toBe("12,5");
    expect(csvCell(null)).toBe("");
    expect(csvCell(undefined)).toBe("");
    expect(csvCell(true)).toBe("1");
  });

  it("neutralises a cell Excel would run as a formula", () => {
    expect(csvCell("=HYPERLINK(1)")).toBe("'=HYPERLINK(1)");
    expect(csvCell("-5 DT")).toBe("'-5 DT");
  });

  it("starts with the byte-order mark and ends each line with CRLF", () => {
    const out = toCsv(["a", "b"], [["x", 1], ["y;z", 2]]);
    expect(out.startsWith("﻿")).toBe(true);
    expect(out).toBe('﻿a;b\r\nx;1\r\n"y;z";2\r\n');
  });

  it("names the file without what a file system refuses", () => {
    expect(csvFileName("Top recherches / 30 j")).toBe("top-recherches-30-j.csv");
    expect(csvFileName("أهم البحوث")).toBe("أهم-البحوث.csv");
    expect(csvFileName("///")).toBe("export.csv");
  });
});
