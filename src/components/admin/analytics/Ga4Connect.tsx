"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { CheckCircle2, Loader2, XCircle } from "lucide-react";
import { Link } from "@/i18n/navigation";

const ENV = "GA4_SERVICE_ACCOUNT_JSON";

/**
 * « Connecter Google Analytics »: the three steps while it is not set up,
 * and a test button once it is. The test asks the server, which holds the
 * key, for one small report.
 */
export function Ga4Connect({ state }: { state: "no_key" | "no_property" | "ready" }) {
  const t = useTranslations("adminAnalytics.traffic.connect");
  const [result, setResult] = useState<null | "testing" | { ok: true; users: number } | { ok: false; error: string }>(null);

  async function test() {
    setResult("testing");
    try {
      const res = await fetch("/api/admin/analytics/ga4-test", { method: "POST" });
      const j = (await res.json().catch(() => ({}))) as { ok?: boolean; users?: number; error?: string };
      setResult(j.ok ? { ok: true, users: j.users ?? 0 } : { ok: false, error: j.error ?? String(res.status) });
    } catch (e) {
      setResult({ ok: false, error: e instanceof Error ? e.message : "network" });
    }
  }

  return (
    <section className="rounded-2xl bg-[var(--paper-warm)] p-5 ring-1 ring-border">
      <h3 className="mazed-h2 text-[17px] text-foreground">{t("title")}</h3>
      {state !== "ready" ? (
        <>
          <p className="mt-1 text-[13px] text-muted">{t("intro")}</p>
          <ol className="mt-3 list-decimal space-y-1.5 ps-5 text-[13px] leading-relaxed text-foreground">
            <li>{t("step1")}</li>
            <li>{t("step2")}</li>
            <li>{t("step3", { env: ENV })}</li>
            <li>{t("step4")}</li>
          </ol>
          <p className="mt-3 text-[12.5px] font-semibold text-[var(--tone-warn)]">{state === "no_key" ? t("noKey", { env: ENV }) : t("noProperty")}</p>
          <Link href={"/admin/settings?g=analytics" as never} className="mt-3 inline-flex h-9 items-center rounded-full bg-surface px-4 text-[12.5px] font-bold text-foreground ring-1 ring-border hover:ring-foreground/40">
            {t("settings")}
          </Link>
        </>
      ) : (
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <button type="button" onClick={test} disabled={result === "testing"} className="mazed-btn-luxe inline-flex h-9 items-center gap-1.5 px-4 text-[12.5px]">
            {result === "testing" ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : null}
            {result === "testing" ? t("testing") : t("test")}
          </button>
          {result && result !== "testing" && (
            <p className={`inline-flex items-center gap-1.5 text-[12.5px] font-semibold ${result.ok ? "text-[var(--tone-ok)]" : "text-[var(--tone-bad)]"}`} role="status">
              {result.ok ? <CheckCircle2 className="size-4" aria-hidden /> : <XCircle className="size-4" aria-hidden />}
              {result.ok ? t("testOk", { users: result.users }) : t("testFail", { error: result.error })}
            </p>
          )}
        </div>
      )}
    </section>
  );
}
