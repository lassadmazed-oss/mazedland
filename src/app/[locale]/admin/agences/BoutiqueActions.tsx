"use client";

import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { BadgeCheck, Check, Gift, Trash2, X } from "lucide-react";
import { AdminButton } from "@/components/admin/AdminButton";
import { Confirm } from "@/components/admin/kit";
import { useAdminAction } from "@/components/admin/kit/useAdminAction";
import { useToast } from "@/components/ui/Toast";
import { useRouter } from "@/i18n/navigation";
import { REFUSAL_OUTCOMES, type RefusalOutcome } from "@/lib/pro/agenceRequest";

/**
 * Open, refuse, suspend, reopen, verify, offer a period — each one call to
 * /api/admin/boutiques/:id. `plans` and `offerMonths` are what « Offrir une
 * période » offers: the active plans, and how long the free period lasts
 * (the founding_offer_months setting).
 *
 * `request`: the agence came with its plan's receipt, waiting (the agence
 * request, 2026-10-31). « Accepter et ouvrir » then validates the receipt —
 * invoice and plan — and opens the agence in one decision, after a confirm
 * that says so; « Refuser » asks what happens to the money (the owner's three
 * outcomes) and why.
 *
 * « Supprimer » (2026-11-03) deletes it for good, with its `listings`
 * annonces and its files; the list comes back afterwards, since the panel's
 * agence is gone.
 */
export function BoutiqueActions({
  shopId, status, verified, plans, offerMonths, seats, request, listings = 0,
}: {
  shopId: string;
  status: string;
  verified: boolean;
  plans: { id: string; label: string }[];
  offerMonths: number;
  /** The founding places the console has not yet given a free period to. */
  seats?: { left: number; total: number };
  request?: { plan: string; amount: string } | null;
  /** Its annonces, all statuses: what « Supprimer » takes with it. */
  listings?: number;
}) {
  const t = useTranslations("adminShops");
  const locale = useLocale();
  const router = useRouter();
  const { toast } = useToast();
  const { run, pending } = useAdminAction();
  const [ask, setAsk] = useState<null | "reject" | "suspend">(null);
  const [opening, setOpening] = useState(false);
  const [offering, setOffering] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const act = (action: string, success: string, reason?: string, extra?: Record<string, string>) =>
    run({ url: `/api/admin/boutiques/${shopId}`, method: "POST", body: { action, reason, ...extra }, success });
  // « Ouvrir » on an agence with no plan: the founding offer is given by itself while places last, and the
  // console is told so (the response carries it), instead of the bare « Agence ouverte ».
  const open = () =>
    run({
      url: `/api/admin/boutiques/${shopId}`,
      method: "POST",
      body: { action: "approve" },
      success: null,
      onSuccess: (data) => {
        const o = (data as { offered?: { plan: string; months: number; until: string } }).offered;
        toast(
          o
            ? t("approvedFounding", { plan: o.plan, months: o.months, date: new Date(o.until).toLocaleDateString(locale === "ar" ? "ar-TN" : "fr-TN", { day: "2-digit", month: "2-digit", year: "numeric" }) })
            : t("approved"),
          "success",
        );
      },
    });

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {(status === "pending" || status === "rejected") && (
        <AdminButton
          variant="primary"
          pending={pending}
          icon={<Check className="size-3.5" />}
          onClick={() => (request ? setOpening(true) : open())}
        >
          {t(request ? "approveRequest" : "approve")}
        </AdminButton>
      )}
      {status === "pending" && (
        <AdminButton variant="danger" icon={<X className="size-3.5" />} onClick={() => setAsk("reject")}>
          {t("reject")}
        </AdminButton>
      )}
      {status === "approved" && (
        <AdminButton variant="danger" onClick={() => setAsk("suspend")}>
          {t("suspend")}
        </AdminButton>
      )}
      {status === "suspended" && (
        <AdminButton pending={pending} onClick={() => act("reinstate", t("reinstated"))}>
          {t("reinstate")}
        </AdminButton>
      )}
      <AdminButton
        pending={pending}
        icon={<BadgeCheck className="size-3.5" />}
        onClick={() => act(verified ? "unverify" : "verify", t(verified ? "unverified" : "verifiedDone"))}
      >
        {t(verified ? "unverify" : "verify")}
      </AdminButton>
      {(status === "pending" || status === "approved") && plans.length > 0 && (
        <AdminButton pending={pending} icon={<Gift className="size-3.5" />} onClick={() => setOffering(true)}>
          {t("offerPlan")}
        </AdminButton>
      )}
      <AdminButton variant="danger" className="ms-auto" icon={<Trash2 className="size-3.5" />} onClick={() => setDeleting(true)}>
        {t("delete")}
      </AdminButton>
      <Confirm
        open={deleting}
        title={t("deleteTitle")}
        body={t("deleteBody", { listings })}
        confirmLabel={t("deleteConfirm")}
        pending={pending}
        reason={{ label: t("reason"), placeholder: t("deletePlaceholder"), required: true }}
        onCancel={() => setDeleting(false)}
        onConfirm={async (motif) => {
          const ok = await run({
            url: `/api/admin/boutiques/${shopId}`,
            method: "POST",
            body: { action: "delete", reason: motif },
            success: null,
            onSuccess: (data) => {
              const d = (data as { deleted?: { listings: number; photos: number } }).deleted;
              toast(t("deleted", { listings: d?.listings ?? 0, photos: d?.photos ?? 0 }), "success");
              router.push("/admin/agences" as never);
            },
          });
          if (ok) setDeleting(false);
        }}
      />
      {request && (
        <Confirm
          open={opening}
          variant="primary"
          title={t("approveRequestTitle")}
          body={t("approveRequestBody", { plan: request.plan, amount: request.amount })}
          confirmLabel={t("approveRequest")}
          pending={pending}
          onCancel={() => setOpening(false)}
          onConfirm={async () => {
            if (await act("approve", t("approvedRequest"))) setOpening(false);
          }}
        />
      )}
      <Confirm
        open={offering}
        variant="primary"
        title={t("offerTitle")}
        body={
          <>
            {t("offerBody", { months: offerMonths })}
            {seats && (
              <span className={`mt-2 block font-bold ${seats.left > 0 ? "text-foreground" : "text-[var(--tone-warn)]"}`}>
                {t(seats.left > 0 ? "offerSeats" : "offerSeatsNone", { left: seats.left, total: seats.total })}
              </span>
            )}
          </>
        }
        confirmLabel={t("offerPlan")}
        pending={pending}
        choice={{ label: t("offerChoice"), options: plans.map((p) => ({ value: p.id, label: p.label })) }}
        onCancel={() => setOffering(false)}
        onConfirm={async (productId) => {
          if (await act("offer_plan", t("offered"), undefined, { product_id: productId })) setOffering(false);
        }}
      />
      <Confirm
        open={ask !== null}
        title={t(ask === "suspend" ? "suspendTitle" : request ? "rejectRequestTitle" : "rejectTitle")}
        body={request && ask === "reject" ? t("rejectRequestBody", { amount: request.amount }) : t("reasonBody")}
        confirmLabel={t(ask === "suspend" ? "suspend" : "reject")}
        pending={pending}
        // A request's money follows the refusal: the console says which way.
        choice={
          request && ask === "reject"
            ? {
                label: t("outcomeLabel"),
                options: REFUSAL_OUTCOMES.map((o) => ({
                  value: o,
                  label: t(`outcomes.${o}.label`),
                  hint: t(`outcomes.${o}.hint`, { amount: request.amount }),
                })),
              }
            : undefined
        }
        reason={{ label: t("reason"), required: true }}
        onCancel={() => setAsk(null)}
        onConfirm={async (value, motif) => {
          if (request && ask === "reject") {
            const outcome = value as RefusalOutcome;
            if (await act("reject", t(`outcomes.${outcome}.done`, { amount: request.amount }), motif, { outcome })) setAsk(null);
            return;
          }
          if (await act(ask ?? "reject", t(ask === "suspend" ? "suspended" : "rejected"), motif)) setAsk(null);
        }}
      />
    </div>
  );
}
