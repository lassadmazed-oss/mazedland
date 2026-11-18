"use client";

import { useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { AdminButton } from "@/components/admin/AdminButton";
import { AGENCY_SOURCES, type AgencySource } from "@/lib/prospection/agencies/model";

type Report = {
  ok: boolean;
  dryRun: boolean;
  columns: string[];
  read: number;
  problems: { line: number; why: string }[];
  problemCount: number;
  toAdd: number;
  withoutNumber: number;
  duplicates: { line: number; name: string; phone: string | null; where: "file" | "list" }[];
  duplicateCount: number;
  doNotContact: { line: number; name: string; phone: string }[];
  doNotContactCount: number;
  inserted: number;
};

const card = "rounded-2xl bg-surface p-4 ring-1 ring-border";
const field = "mt-1 w-full rounded-xl border border-border bg-surface px-3 py-2.5 text-[14px] outline-none focus:border-[var(--gold)]";
const label = "block text-[12.5px] font-bold text-muted";

/**
 * The owner's import: paste a CSV (or choose a file), read what it would do
 * without adding anything, then add. The columns are found by their names in
 * French, English or Arabic (name, phone, governorate, address, website…).
 */
export function ImportForm({ members }: { members: { id: string; name: string }[] }) {
  const t = useTranslations("adminProspection");
  const [csv, setCsv] = useState("");
  const [source, setSource] = useState<AgencySource>("csv");
  const [sourceNote, setSourceNote] = useState("");
  const [assignTo, setAssignTo] = useState("");
  const [busy, setBusy] = useState<"check" | "add" | null>(null);
  const [report, setReport] = useState<Report | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  async function send(dryRun: boolean) {
    if (busy) return;
    setBusy(dryRun ? "check" : "add");
    setError(null);
    try {
      const res = await fetch("/api/admin/prospection/agences/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ csv, source, source_note: sourceNote, assign_to: assignTo || null, dry_run: dryRun }),
      });
      const json = (await res.json().catch(() => ({}))) as Report & { error?: string };
      if (!res.ok || !json.ok) {
        setReport(null);
        setError(typeof json.error === "string" && t.has(`agencies.import.errors.${json.error}`) ? t(`agencies.import.errors.${json.error}`) : t("agencies.errors.failed"));
        return;
      }
      setReport(json);
    } catch {
      setError(t("agencies.errors.failed"));
    } finally {
      setBusy(null);
    }
  }

  async function onFile(file: File | undefined) {
    if (!file) return;
    setReport(null);
    setCsv(await file.text());
  }

  const done = report && !report.dryRun;

  return (
    <div className="mx-auto mt-5 max-w-3xl space-y-4 pb-10">
      <section className={card}>
        <p className="text-[12.5px] text-muted">{t("agencies.import.columnsHint")}</p>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <input ref={fileRef} type="file" accept=".csv,.tsv,.txt,text/csv,text/plain" className="hidden" onChange={(e) => void onFile(e.target.files?.[0])} />
          <AdminButton size="md" className="!h-11" onClick={() => fileRef.current?.click()}>{t("agencies.import.chooseFile")}</AdminButton>
          <span className="text-[12px] text-muted">{t("agencies.import.orPaste")}</span>
        </div>
        <textarea
          value={csv}
          onChange={(e) => { setCsv(e.target.value); setReport(null); }}
          rows={9}
          dir="ltr"
          placeholder={"nom;telephone;gouvernorat;adresse\nAgence Exemple;74 123 456;Sfax;Rue 1"}
          className={`${field} font-mono text-[12.5px]`}
        />
        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
          <label className={label}>{t("agencies.import.source")}
            <select value={source} onChange={(e) => setSource(e.target.value as AgencySource)} className={field}>
              {AGENCY_SOURCES.map((s) => <option key={s} value={s}>{t(`agencies.source.${s}`)}</option>)}
            </select>
          </label>
          <label className={label}>{t("agencies.import.sourceNote")}
            <input value={sourceNote} onChange={(e) => setSourceNote(e.target.value)} className={field} maxLength={200} />
          </label>
          <label className={label}>{t("agencies.import.assignTo")}
            <select value={assignTo} onChange={(e) => setAssignTo(e.target.value)} className={field}>
              <option value="">{t("agencies.import.shareLater")}</option>
              {members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select>
          </label>
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          <AdminButton variant="primary" size="md" className="!h-11 !px-5" pending={busy === "check"} disabled={!csv.trim()} onClick={() => void send(true)}>{t("agencies.import.check")}</AdminButton>
          {report && report.dryRun && report.toAdd > 0 ? (
            <AdminButton size="md" className="!h-11 !px-5" pending={busy === "add"} onClick={() => void send(false)}>{t("agencies.import.add", { n: report.toAdd })}</AdminButton>
          ) : null}
        </div>
        {error ? <p role="alert" className="mt-3 rounded-xl bg-[var(--tone-bad-bg)] px-3 py-2.5 text-[13px] font-bold text-[var(--tone-bad)]">{error}</p> : null}
      </section>

      {report ? (
        <section className={card} aria-live="polite">
          <h2 className="text-[14px] font-extrabold">{done ? t("agencies.import.doneTitle", { n: report.inserted }) : t("agencies.import.previewTitle")}</h2>
          <dl className="mt-3 grid grid-cols-2 gap-2 text-[13px] sm:grid-cols-4">
            {[
              [t("agencies.import.read"), report.read],
              [done ? t("agencies.import.added") : t("agencies.import.toAdd"), done ? report.inserted : report.toAdd],
              [t("agencies.import.duplicates"), report.duplicateCount],
              [t("agencies.import.dnc"), report.doNotContactCount],
              [t("agencies.import.withoutNumber"), report.withoutNumber],
              [t("agencies.import.unreadable"), report.problemCount],
            ].map(([k, v]) => (
              <div key={String(k)} className="rounded-xl bg-surface-2 px-3 py-2">
                <dt className="text-[11px] font-bold text-muted">{k}</dt>
                <dd className="mazed-tabular text-[18px] font-extrabold">{v}</dd>
              </div>
            ))}
          </dl>
          {report.problems.length > 0 ? (
            <details className="mt-3 text-[12.5px]">
              <summary className="cursor-pointer font-bold">{t("agencies.import.problems", { n: report.problemCount })}</summary>
              <ul className="mt-2 space-y-0.5 text-muted">{report.problems.map((p) => <li key={p.line}>{t("agencies.import.line", { n: p.line })} — {t(`agencies.import.why.${p.why}`)}</li>)}</ul>
            </details>
          ) : null}
          {report.duplicates.length > 0 ? (
            <details className="mt-3 text-[12.5px]">
              <summary className="cursor-pointer font-bold">{t("agencies.import.duplicatesList", { n: report.duplicateCount })}</summary>
              <ul className="mt-2 space-y-0.5 text-muted">{report.duplicates.map((d) => <li key={`${d.line}-${d.name}`}>{t("agencies.import.line", { n: d.line })} — {d.name} ({d.where === "file" ? t("agencies.import.inFile") : t("agencies.import.inList")})</li>)}</ul>
            </details>
          ) : null}
          {report.doNotContact.length > 0 ? (
            <details className="mt-3 text-[12.5px]">
              <summary className="cursor-pointer font-bold">{t("agencies.import.dncList", { n: report.doNotContactCount })}</summary>
              <ul className="mt-2 space-y-0.5 text-muted">{report.doNotContact.map((d) => <li key={`${d.line}-${d.phone}`}>{t("agencies.import.line", { n: d.line })} — {d.name}</li>)}</ul>
            </details>
          ) : null}
          {done ? (
            <div className="mt-4"><Link href={"/admin/prospection/agences" as "/admin/prospection"} className="text-[13px] font-bold underline">{t("agencies.import.goList")}</Link></div>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}
