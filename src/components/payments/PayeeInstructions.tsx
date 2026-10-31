"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Building2, Check, Copy, Smartphone } from "lucide-react";
import { useToast } from "@/components/ui/Toast";
import { Ltr } from "@/components/ui/Ltr";
import { cn } from "@/lib/utils";
import type { ProviderInstructions } from "@/lib/payments";
import { clipboardText } from "@/lib/payments/clipboard";
import type { PaymentProvider } from "@/lib/payments/types";

const PROVIDER_ICONS: Record<PaymentProvider, typeof Building2> = {
  bank_transfer: Building2,
  d17: Smartphone,
};

/**
 * How to pay, as the checkout shows it and the agence request repeats it:
 * the methods as two big toggles, then the chosen one's details — payee,
 * RIB or D17 number, amount, reference — each copyable in the shape the bank
 * or D17 app takes. Only methods with real details reach here
 * (usablePayeeMethods).
 */
export function PayMethodPicker({
  instructions,
  provider,
  onProvider,
}: {
  instructions: ProviderInstructions[];
  provider: PaymentProvider;
  onProvider: (p: PaymentProvider) => void;
}) {
  const t = useTranslations("checkout");
  return (
    <div className="grid grid-cols-2 gap-2.5">
      {instructions.map((p) => {
        const Icon = PROVIDER_ICONS[p.value];
        const isActive = provider === p.value;
        return (
          <button
            key={p.value}
            type="button"
            onClick={() => onProvider(p.value)}
            aria-pressed={isActive}
            className={cn(
              "relative flex flex-col items-center gap-2 rounded-2xl border-2 p-4 transition",
              isActive
                ? "border-[var(--gold)] bg-[var(--gold-faint)]"
                : "border-[var(--border)] bg-[var(--surface)] hover:border-[var(--gold-soft)]",
            )}
          >
            {isActive && (
              <span className="absolute end-2 top-2 inline-flex size-5 items-center justify-center rounded-full bg-[var(--gold)] text-white">
                <Check className="size-3" strokeWidth={3} />
              </span>
            )}
            <span
              className={cn(
                "inline-flex size-11 items-center justify-center rounded-xl",
                isActive ? "bg-[var(--gold)] text-white" : "bg-[var(--surface-2)] text-[var(--foreground-muted)]",
              )}
            >
              <Icon className="size-5" strokeWidth={2} />
            </span>
            <span className="text-[13px] font-bold text-foreground">
              {p.value === "bank_transfer" ? t("providerBank") : t("providerD17")}
            </span>
          </button>
        );
      })}
    </div>
  );
}

export function PayeeFields({ active }: { active: ProviderInstructions }) {
  const t = useTranslations("checkout");
  const { toast } = useToast();
  const [copiedField, setCopiedField] = useState<string | null>(null);

  async function copyValue(label: string, value: string) {
    try {
      await navigator.clipboard.writeText(value);
      setCopiedField(label);
      setTimeout(() => setCopiedField(null), 1400);
    } catch {
      toast(t("copyFailed"), "warning");
    }
  }

  return (
    <div className="overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--surface)]">
      {active.fields.map((field, i) => (
        <div
          key={field.label}
          className={cn(
            "flex items-center justify-between gap-3 px-4 py-3",
            i > 0 && "border-t border-[var(--border)]",
          )}
        >
          <div className="min-w-0">
            <div className="text-[10px] uppercase tracking-[0.14em] font-bold text-[var(--foreground-muted)]">
              {field.label}
            </div>
            <div className={cn("mt-0.5 text-[14px] font-bold text-foreground break-words", field.mono && "mazed-tabular")}>
              {field.ltr ? <Ltr>{field.value}</Ltr> : field.value}
            </div>
          </div>
          {field.copyable && (
            <button
              type="button"
              // In the shape the bank or D17 app takes: « 15.00 », not « 15.00 TND ».
              onClick={() => copyValue(field.label, clipboardText(field.value))}
              className={cn(
                "shrink-0 inline-flex min-h-10 items-center gap-1 rounded-lg px-3 py-1.5 text-[11px] font-bold transition",
                copiedField === field.label
                  ? "bg-[var(--gold)] text-white"
                  : "bg-[var(--surface-2)] text-foreground hover:bg-[var(--gold-faint)] hover:text-[var(--gold)]",
              )}
            >
              {copiedField === field.label ? (
                <><Check className="size-3.5" strokeWidth={2.5} /> {t("copied")}</>
              ) : (
                <><Copy className="size-3.5" strokeWidth={2} /> {t("copy")}</>
              )}
            </button>
          )}
        </div>
      ))}
    </div>
  );
}
