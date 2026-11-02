"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { AlertTriangle, Check, ChevronDown, Download, FileSpreadsheet, Loader2, Upload } from "lucide-react";
import { MODEL_HEADERS, modelFile, type ColumnKey, type ImportIssue } from "@/lib/listings/importRows";
import { formatTND } from "@/lib/utils";
import { trackEvent } from "@/lib/analytics/events";

type Row = {
  line: number;
  status: "ok" | "error" | "duplicate";
  errors: ImportIssue[];
  warnings: ImportIssue[];
  preview: { title: string; deal: "sale" | "rent"; type: string | null; place: string; price: number | null; area: number | null };
};
type Summary = { ok: number; error: number; duplicate: number };
type Reply = { ok?: boolean; error?: string; detail?: string; rows?: Row[]; summary?: Summary; created?: number; missing?: ColumnKey[]; max?: number };

/** A file saved by Excel is UTF-8 or, on a French Windows, Windows-1252: try the first, fall back to the second. */
async function readText(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(buffer);
  } catch {
    return new TextDecoder("windows-1252").decode(buffer);
  }
}

/**
 * « Importer plusieurs annonces » in the agence's dashboard (the agencies'
 * bulk import, 2026-10-31): the model to fill in Excel, a CSV or the lines
 * pasted from it, a check that says what each line would become, then the
 * drafts. The photos stay with the agence, one annonce at a time, from the
 * list under this card. See src/lib/listings/importRows.ts and
 * /api/pro/shops/:id/import.
 */
export function ImportListings({ shopId }: { shopId: string }) {
  const t = useTranslations("pro.import");
  const locale = useLocale();
  const router = useRouter();
  const fileInput = useRef<HTMLInputElement>(null);
  const [text, setText] = useState("");
  const [fileName, setFileName] = useState("");
  const [phase, setPhase] = useState<"idle" | "checking" | "checked" | "creating" | "done">("idle");
  const [rows, setRows] = useState<Row[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [created, setCreated] = useState(0);
  const [problem, setProblem] = useState<string | null>(null);

  function say(reply: Reply): string {
    switch (reply.error) {
      case "missing_columns":
        return t("file.missing_columns", { columns: (reply.missing ?? []).map((k) => MODEL_HEADERS[k]).join(", ") });
      case "too_many_rows":
        return t("file.too_many_rows", { max: reply.max ?? 0 });
      case "empty": case "no_rows": case "too_big": case "feature_off": case "nothing_to_import":
        return t(`file.${reply.error}`);
      default:
        return reply.detail ?? t("file.generic");
    }
  }

  async function send(commit: boolean) {
    setProblem(null);
    setPhase(commit ? "creating" : "checking");
    try {
      const res = await fetch(`/api/pro/shops/${shopId}/import`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text, commit }),
      });
      const reply = (await res.json().catch(() => ({}))) as Reply;
      if (!res.ok || !reply.ok) {
        setProblem(say(reply));
        setRows(reply.rows ?? []);
        setSummary(reply.summary ?? null);
        setPhase(reply.rows ? "checked" : "idle");
        return;
      }
      setRows(reply.rows ?? []);
      setSummary(reply.summary ?? null);
      if (commit) {
        setCreated(reply.created ?? 0);
        setPhase("done");
        // Google only: the route counts it for the site (src/lib/analytics/server-events.ts).
        trackEvent("listing_import", { count: reply.created ?? 0 }, {}, { firstParty: false });
        router.refresh();
      } else setPhase("checked");
    } catch {
      setProblem(t("file.generic"));
      setPhase("idle");
    }
  }

  async function chooseFile(file: File | undefined) {
    if (!file) return;
    setText(await readText(file));
    setFileName(file.name);
    setPhase("idle");
    setRows([]);
    setSummary(null);
    setProblem(null);
  }

  function downloadModel() {
    const url = URL.createObjectURL(new Blob([modelFile()], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = "modele-import-mazed-immo.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  function reset() {
    setText("");
    setFileName("");
    setRows([]);
    setSummary(null);
    setProblem(null);
    setCreated(0);
    setPhase("idle");
    if (fileInput.current) fileInput.current.value = "";
  }

  const busy = phase === "checking" || phase === "creating";
  const issue = (i: ImportIssue) => t(`issue.${i.code}` as "issue.type_missing", { value: i.value ?? "" });
  const money = (n: number | null) => (n === null ? t("onRequest") : `${formatTND(n, locale)} ${t("tnd")}`);

  return (
    <details className="group mb-4 rounded-2xl border border-border bg-surface">
      <summary className="flex cursor-pointer list-none items-center gap-3 p-4 [&::-webkit-details-marker]:hidden">
        <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-gold-faint text-[var(--gold)]">
          <FileSpreadsheet className="size-4.5" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[13.5px] font-extrabold text-foreground">{t("title")}</span>
          <span className="block text-[12px] text-muted">{t("intro")}</span>
        </span>
        <ChevronDown className="size-4 shrink-0 text-muted transition group-open:rotate-180" />
      </summary>

      <div className="space-y-4 border-t border-border p-4">
        {phase === "done" ? (
          <div className="rounded-xl bg-surface-2 p-4 ring-1 ring-border">
            <p className="flex items-center gap-2 text-[13.5px] font-extrabold text-foreground">
              <Check className="size-4 text-[var(--tone-ok)]" /> {t("done", { count: created })}
            </p>
            <p className="mt-1 text-[12.5px] leading-relaxed text-muted">{t("doneHint")}</p>
            <button type="button" onClick={reset} className="mt-3 text-[12.5px] font-bold text-gold hover:underline">{t("another")}</button>
          </div>
        ) : (
          <>
            <div>
              <p className="text-[12.5px] font-extrabold text-foreground">{t("step1")}</p>
              <p className="mt-0.5 text-[12px] leading-relaxed text-muted">{t("step1Hint")}</p>
              <button
                type="button"
                onClick={downloadModel}
                className="tap-target mt-2 inline-flex items-center gap-1.5 rounded-full border border-border px-3.5 py-2 text-[12.5px] font-bold text-foreground transition hover:border-gold-soft"
              >
                <Download className="size-3.5" /> {t("model")}
              </button>
            </div>

            <div>
              <p className="text-[12.5px] font-extrabold text-foreground">{t("step2")}</p>
              <p className="mt-0.5 text-[12px] leading-relaxed text-muted">{t("step2Hint")}</p>
              <input ref={fileInput} type="file" accept=".csv,.txt,text/csv,text/plain" className="sr-only" onChange={(e) => chooseFile(e.target.files?.[0])} />
              <button
                type="button"
                onClick={() => fileInput.current?.click()}
                className="tap-target mt-2 inline-flex items-center gap-1.5 rounded-full border border-border px-3.5 py-2 text-[12.5px] font-bold text-foreground transition hover:border-gold-soft"
              >
                <Upload className="size-3.5" /> {fileName || t("chooseFile")}
              </button>
              <label className="mt-3 block">
                <span className="text-[11.5px] font-semibold text-muted">{t("pasteLabel")}</span>
                <textarea
                  value={text}
                  onChange={(e) => {
                    setText(e.target.value);
                    setFileName("");
                    if (phase !== "idle") setPhase("idle");
                  }}
                  rows={4}
                  dir="auto"
                  spellCheck={false}
                  className="mt-1 w-full resize-y rounded-lg border border-border bg-surface-2 px-3 py-2 font-mono text-[12px] text-foreground focus:border-gold focus:outline-none"
                />
              </label>
              <button
                type="button"
                disabled={busy || text.trim() === ""}
                onClick={() => send(false)}
                className="mazed-btn-luxe tap-target mt-2 inline-flex h-10 items-center gap-2 px-5 text-[13px] disabled:opacity-50"
              >
                {phase === "checking" && <Loader2 className="size-4 animate-spin" />} {phase === "checking" ? t("checking") : t("check")}
              </button>
            </div>
          </>
        )}

        {problem && (
          <p role="alert" className="flex items-start gap-2 rounded-xl bg-[var(--tone-bad-bg)] p-3 text-[12.5px] font-semibold leading-relaxed text-[var(--tone-bad)]">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" /> {problem}
          </p>
        )}

        {summary && phase !== "done" && (
          <div>
            <p className="text-[12.5px] font-extrabold text-foreground">
              {t("summary", { ok: summary.ok, error: summary.error, duplicate: summary.duplicate })}
            </p>
            <ul className="mt-2 divide-y divide-border rounded-xl bg-surface-2/60 px-3 ring-1 ring-border">
              {rows.slice(0, 200).map((r) => (
                <li key={r.line} className="py-2.5 text-[12.5px]">
                  <p className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
                    <span className="min-w-0 font-bold text-foreground" dir="auto">
                      <span className="me-1.5 text-[11px] font-semibold text-muted">{t("line", { line: r.line })}</span>
                      {r.preview.title || r.preview.type || "—"}
                    </span>
                    <span className={r.status === "ok" ? "font-bold text-[var(--tone-ok)]" : r.status === "duplicate" ? "font-bold text-muted" : "font-bold text-[var(--tone-bad)]"}>
                      {t(`status.${r.status}`)}
                    </span>
                  </p>
                  {r.status !== "error" && (
                    <p className="mt-0.5 text-[11.5px] text-muted">
                      {[r.preview.type, r.preview.place, money(r.preview.price), r.preview.area ? `${r.preview.area} m²` : null].filter(Boolean).join(" · ")}
                    </p>
                  )}
                  {r.errors.map((e, i) => (
                    <p key={`e${i}`} className="mt-0.5 text-[11.5px] font-semibold text-[var(--tone-bad)]">{issue(e)}</p>
                  ))}
                  {r.warnings.map((w, i) => (
                    <p key={`w${i}`} className="mt-0.5 text-[11.5px] font-semibold text-[var(--tone-warn)]">{issue(w)}</p>
                  ))}
                </li>
              ))}
            </ul>
            {rows.length > 200 && <p className="mt-1 text-[11.5px] text-muted">{t("moreRows", { count: rows.length - 200 })}</p>}
            <button
              type="button"
              disabled={busy || summary.ok === 0}
              onClick={() => send(true)}
              className="mazed-btn-luxe tap-target mt-3 inline-flex h-11 items-center gap-2 px-5 text-[13.5px] disabled:opacity-50"
            >
              {phase === "creating" && <Loader2 className="size-4 animate-spin" />}
              {phase === "creating" ? t("creating") : t("create", { count: summary.ok })}
            </button>
            {summary.error > 0 && <p className="mt-1.5 text-[11.5px] text-muted">{t("fixHint")}</p>}
          </div>
        )}
      </div>
    </details>
  );
}
