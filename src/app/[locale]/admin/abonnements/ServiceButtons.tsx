"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { AdminButton } from "@/components/admin/AdminButton";
import { Confirm, useAdminAction } from "@/components/admin/kit";
import { useToast } from "@/components/ui/Toast";
import { CalendarCheck, MessageSquareText, Pause, Play, RefreshCw, Trash2 } from "lucide-react";

/**
 * The buttons of /admin/abonnements: the check run at once, the test SMS,
 * and what can be done to one open service.
 */

export function CheckNowButton() {
  const t = useTranslations("adminServices");
  const { toast } = useToast();
  const { run, pending, done } = useAdminAction();
  return (
    <AdminButton
      pending={pending}
      done={done}
      icon={<RefreshCw className="size-3.5" strokeWidth={2.4} />}
      onClick={() =>
        run({
          url: "/api/admin/abonnements/check",
          method: "POST",
          success: null,
          onSuccess: (data) => {
            const r = data as { refreshed?: number; sent?: number };
            toast(t("checked", { refreshed: r.refreshed ?? 0, sent: r.sent ?? 0 }), "success");
          },
        })
      }
    >
      {t("checkNow")}
    </AdminButton>
  );
}

export function TestSmsButton({ disabled }: { disabled: boolean }) {
  const t = useTranslations("adminServices.alerts");
  const { toast } = useToast();
  const { run, pending, done } = useAdminAction();
  return (
    <AdminButton
      pending={pending}
      done={done}
      disabled={disabled}
      icon={<MessageSquareText className="size-3.5" strokeWidth={2.4} />}
      onClick={() =>
        run({
          url: "/api/admin/abonnements/test-sms",
          method: "POST",
          success: null,
          onSuccess: (data) => toast(t("testSent", { sent: (data as { sent?: number }).sent ?? 0 }), "success"),
        })
      }
    >
      {t("test")}
    </AdminButton>
  );
}

export function ServiceActions({
  id,
  active,
  canRenew,
  afterDeleteHref,
}: {
  id: string;
  active: boolean;
  /** A monthly or yearly date the owner keeps: « Payé » moves it a cycle on. */
  canRenew: boolean;
  /** With the locale prefix: it goes to next/navigation's router as is. */
  afterDeleteHref: string;
}) {
  const t = useTranslations("adminServices.actions");
  const router = useRouter();
  const { run, pending } = useAdminAction();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const url = `/api/admin/abonnements/${id}`;

  return (
    <div className="flex flex-wrap items-center gap-2">
      {canRenew && (
        <AdminButton
          variant="primary"
          pending={pending}
          icon={<CalendarCheck className="size-3.5" strokeWidth={2.4} />}
          onClick={() => run({ url, method: "PATCH", body: { renewed: true }, success: t("renewedDone") })}
        >
          {t("renewed")}
        </AdminButton>
      )}
      <AdminButton
        pending={pending}
        icon={active ? <Pause className="size-3.5" strokeWidth={2.4} /> : <Play className="size-3.5" strokeWidth={2.4} />}
        onClick={() => run({ url, method: "PATCH", body: { active: !active }, success: active ? t("paused") : t("resumed") })}
      >
        {active ? t("pause") : t("resume")}
      </AdminButton>
      <AdminButton
        variant="danger"
        className="ms-auto"
        icon={<Trash2 className="size-3.5" strokeWidth={2.4} />}
        onClick={() => setConfirmDelete(true)}
      >
        {t("delete")}
      </AdminButton>

      <Confirm
        open={confirmDelete}
        title={t("deleteTitle")}
        body={t("deleteBody")}
        confirmLabel={t("delete")}
        pending={pending}
        onCancel={() => setConfirmDelete(false)}
        onConfirm={async () => {
          const ok = await run({ url, method: "DELETE", success: t("deleted") });
          if (ok) {
            setConfirmDelete(false);
            router.push(afterDeleteHref);
          }
        }}
      />
    </div>
  );
}
