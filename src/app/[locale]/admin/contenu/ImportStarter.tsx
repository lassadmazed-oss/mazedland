"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { AdminButton } from "@/components/admin/AdminButton";
import { Confirm, useAdminAction } from "@/components/admin/kit";
import { useToast } from "@/components/ui/Toast";
import { Download } from "lucide-react";

/**
 * « Importer les guides de départ »: the guides written for Tunisia
 * (docs/guides/) come in as drafts, on this click only, each once. Nothing is
 * published by it — the owner reads and publishes each guide themselves.
 */
export function ImportStarter({ total, remaining }: { total: number; remaining: number }) {
  const t = useTranslations("adminContent.import");
  const { run, pending } = useAdminAction();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  if (total === 0) return null;
  const done = remaining === 0;

  return (
    <>
      <AdminButton
        variant="default"
        size="sm"
        icon={<Download className="size-3.5" strokeWidth={2.4} />}
        disabled={done}
        disabledReason={done ? t("allDone") : undefined}
        onClick={() => setOpen(true)}
      >
        <span className="hidden sm:inline">{t("button", { count: remaining })}</span>
        <span className="sm:hidden">{t("buttonShort")}</span>
      </AdminButton>
      <Confirm
        open={open}
        title={t("confirmTitle")}
        body={t("confirmBody", { count: remaining })}
        confirmLabel={t("confirm")}
        variant="primary"
        pending={pending}
        onConfirm={async () => {
          await run({
            url: "/api/admin/content/import",
            method: "POST",
            success: null,
            onSuccess: (data) => {
              const r = data as { imported?: string[]; skipped?: string[] };
              toast(t("done", { imported: r.imported?.length ?? 0, skipped: r.skipped?.length ?? 0 }), "success");
            },
          });
          setOpen(false);
        }}
        onCancel={() => setOpen(false)}
      />
    </>
  );
}
