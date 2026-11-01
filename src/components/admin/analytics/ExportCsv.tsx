"use client";

import { Download } from "lucide-react";

/**
 * « Exporter CSV »: the table's rows, already written as CSV on the server,
 * handed to the browser as a file. No request, no state.
 */
export function ExportCsv({ csv, filename, label }: { csv: string; filename: string; label: string }) {
  function download() {
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return (
    <button
      type="button"
      onClick={download}
      className="inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-[11.5px] font-semibold text-subtle ring-1 ring-border transition hover:text-foreground hover:ring-foreground/40"
    >
      <Download className="size-3.5" strokeWidth={2.2} aria-hidden />
      {label}
    </button>
  );
}
