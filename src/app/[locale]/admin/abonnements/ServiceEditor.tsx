"use client";

import { useId, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { AdminButton } from "@/components/admin/AdminButton";
import { TextField, TextareaField, NumberField, ToggleField, FieldGrid, useAdminAction } from "@/components/admin/kit";
import { addMonths, tunisDay } from "@/lib/ads/dates";
import {
  LEAD_CHOICES, PAYMENT_NOTES, PROVIDER_PRESETS, SERVICE_CURRENCIES, SERVICE_CYCLES, SERVICE_KINDS,
  type ServiceCurrency, type ServiceCycle, type ServiceKind,
} from "@/lib/services/services";
import { Save } from "lucide-react";

/**
 * Add or change a paid service, typing as little as possible.
 *
 * A new one starts from a provider chip (Vercel, Supabase, Hostinger…),
 * which fills the type, the cycle, the currency, the payment mode and the
 * billing link; what is left is a date — a chip for « +1 mois » / « +1 an »
 * — and, when known, a price. The account that pays offers the accounts
 * already used on other rows. A date a provider reports (Vercel, a domain,
 * WinSMS) is shown, not edited: the next check would overwrite it.
 */

export type EditableService = {
  id: string;
  kind: ServiceKind;
  provider: string;
  name: string;
  purpose: string | null;
  cost: number | null;
  currency: ServiceCurrency;
  cycle: ServiceCycle;
  renewsOn: string | null;
  autoRenew: boolean;
  account: string | null;
  paymentNote: string | null;
  billingUrl: string | null;
  leadDays: number | null;
  active: boolean;
  notes: string | null;
  /** The provider reports the date (Vercel, RDAP, WinSMS). */
  autoDate: boolean;
};

// The kit's field look (src/components/admin/kit/Field.tsx), for the controls
// it has no primitive for: a date, a group of chips.
const LABEL = "block text-[11.5px] font-semibold uppercase tracking-[0.08em] text-subtle";
const INPUT =
  "h-9 rounded-lg border border-border bg-surface-2 px-3 text-[13px] text-foreground transition focus:border-gold focus:outline-none disabled:opacity-50";

function chip(on: boolean): string {
  return `inline-flex h-8 items-center rounded-full px-3 text-[12px] font-semibold transition ${
    on ? "bg-[var(--gold)] text-[var(--background)]" : "border border-border text-muted hover:border-[var(--gold-soft)] hover:text-[var(--gold)]"
  }`;
}

function Chips({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <span className={LABEL}>{label}</span>
      <div className="mt-1.5 flex flex-wrap gap-1.5">{children}</div>
    </div>
  );
}

export function ServiceEditor({
  service,
  defaultLead,
  accounts,
  closeHref,
}: {
  /** null = a new service. */
  service: EditableService | null;
  defaultLead: number;
  /** The accounts other rows are paid from, offered as chips. */
  accounts: string[];
  /** With the locale prefix: next/navigation's router takes it as is. */
  closeHref: string;
}) {
  const t = useTranslations("adminServices");
  const router = useRouter();
  const { run, pending } = useAdminAction();
  const dateId = useId();
  // Read once: the day the form was opened is « today » for its chips.
  const [today] = useState(() => tunisDay());

  const isNew = service === null;
  const [preset, setPreset] = useState<string | null>(null);
  const [kind, setKind] = useState<ServiceKind>(service?.kind ?? "other");
  const [provider, setProvider] = useState(service?.provider ?? "");
  const [name, setName] = useState(service?.name ?? "");
  const [purpose, setPurpose] = useState(service?.purpose ?? "");
  const [cost, setCost] = useState<number | null>(service?.cost ?? null);
  const [currency, setCurrency] = useState<ServiceCurrency>(service?.currency ?? "USD");
  const [cycle, setCycle] = useState<ServiceCycle>(service?.cycle ?? "monthly");
  const [renewsOn, setRenewsOn] = useState(service?.renewsOn ?? "");
  const [autoRenew, setAutoRenew] = useState(service?.autoRenew ?? true);
  const [account, setAccount] = useState(service?.account ?? "");
  const [payment, setPayment] = useState(service?.paymentNote ?? "");
  const [billingUrl, setBillingUrl] = useState(service?.billingUrl ?? "");
  const [leadDays, setLeadDays] = useState<number | null>(service?.leadDays ?? null);
  const [active, setActive] = useState(service?.active ?? true);
  const [notes, setNotes] = useState(service?.notes ?? "");

  function pick(key: string) {
    setPreset(key);
    const p = PROVIDER_PRESETS.find((x) => x.key === key);
    if (!p) {
      setProvider("");
      setKind("other");
      return;
    }
    setProvider(p.provider);
    setKind(p.kind);
    if (p.name) setName(p.name);
    setCycle(p.cycle);
    setCurrency(p.currency);
    setAutoRenew(p.autoRenew);
    setBillingUrl(p.billingUrl);
  }

  const missing = !provider.trim() ? t("editor.missing.provider") : !name.trim() ? t("editor.missing.name") : null;

  async function save() {
    if (missing) return;
    const body = {
      kind,
      provider,
      name,
      purpose,
      cost,
      currency,
      cycle,
      ...(service?.autoDate ? {} : { renews_on: renewsOn || null }),
      auto_renew: autoRenew,
      account,
      payment_note: payment,
      billing_url: billingUrl,
      lead_days: leadDays,
      active,
      notes,
    };
    await run({
      url: isNew ? "/api/admin/abonnements" : `/api/admin/abonnements/${service.id}`,
      method: isNew ? "POST" : "PATCH",
      body,
      success: isNew ? t("editor.created") : t("editor.saved"),
      onSuccess: (data) => {
        const id = (data as { id?: string }).id;
        if (isNew && id) router.push(`${closeHref}?s=${id}`);
      },
    });
  }

  const plusMonth = addMonths(today, 1);
  const plusYear = addMonths(today, 12);

  return (
    <form
      className="space-y-5"
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      {isNew && (
        <Chips label={t("editor.presets")}>
          {PROVIDER_PRESETS.map((p) => (
            <button key={p.key} type="button" onClick={() => pick(p.key)} className={chip(preset === p.key)}>
              {p.provider}
            </button>
          ))}
          <button type="button" onClick={() => pick("other")} className={chip(preset === "other")}>
            {t("editor.presetOther")}
          </button>
        </Chips>
      )}

      <Chips label={t("editor.kind")}>
        {SERVICE_KINDS.map((k) => (
          <button key={k} type="button" onClick={() => setKind(k)} className={chip(kind === k)}>
            {t(`kinds.${k}`)}
          </button>
        ))}
      </Chips>

      <FieldGrid>
        <TextField label={t("editor.provider")} value={provider} onChange={setProvider} required />
        <TextField label={t("editor.name")} value={name} onChange={setName} placeholder={t("editor.namePlaceholder")} required />
      </FieldGrid>
      <TextField label={t("editor.purpose")} value={purpose} onChange={setPurpose} />

      <div>
        <label htmlFor={dateId} className={LABEL}>
          {t("editor.renewsOn")}
        </label>
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
          <input
            id={dateId}
            type="date"
            dir="ltr"
            value={renewsOn}
            disabled={service?.autoDate}
            onChange={(e) => setRenewsOn(e.target.value)}
            className={INPUT}
          />
          {!service?.autoDate && (
            <>
              <button type="button" onClick={() => setRenewsOn(plusMonth)} className={chip(renewsOn === plusMonth)}>
                {t("editor.plusMonth")}
              </button>
              <button type="button" onClick={() => setRenewsOn(plusYear)} className={chip(renewsOn === plusYear)}>
                {t("editor.plusYear")}
              </button>
              <button type="button" onClick={() => setRenewsOn("")} className={chip(renewsOn === "")}>
                {t("editor.unknownDate")}
              </button>
            </>
          )}
        </div>
        {service?.autoDate && <p className="mt-1 text-[11.5px] text-muted">{t("editor.renewsOnAuto", { provider })}</p>}
      </div>

      <Chips label={t("editor.cycle")}>
        {SERVICE_CYCLES.map((c) => (
          <button key={c} type="button" onClick={() => setCycle(c)} className={chip(cycle === c)}>
            {t(`cycles.${c}`)}
          </button>
        ))}
      </Chips>

      <FieldGrid>
        <NumberField
          label={t("editor.cost")}
          hint={t("editor.costHint")}
          value={cost}
          onChange={setCost}
          min={0}
          step={0.01}
          suffix={currency === "USD" ? "$" : currency === "EUR" ? "€" : "DT"}
        />
        <Chips label={t("editor.currency")}>
          {SERVICE_CURRENCIES.map((c) => (
            <button key={c} type="button" onClick={() => setCurrency(c)} className={chip(currency === c)}>
              {c}
            </button>
          ))}
        </Chips>
      </FieldGrid>

      <ToggleField label={t("editor.autoRenew")} hint={t("editor.autoRenewHint")} checked={autoRenew} onChange={setAutoRenew} />

      <div className="space-y-2">
        <TextField label={t("editor.account")} value={account} onChange={setAccount} placeholder={t("editor.accountPlaceholder")} />
        {accounts.filter((a) => a !== account).length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {accounts
              .filter((a) => a !== account)
              .map((a) => (
                <button key={a} type="button" dir="auto" onClick={() => setAccount(a)} className={chip(false)}>
                  {a}
                </button>
              ))}
          </div>
        )}
      </div>

      <Chips label={t("editor.payment")}>
        {PAYMENT_NOTES.map((p) => {
          const label = t(`payments.${p}`);
          return (
            <button key={p} type="button" onClick={() => setPayment(label)} className={chip(payment === label)}>
              {label}
            </button>
          );
        })}
      </Chips>

      <TextField label={t("editor.billingUrl")} type="url" value={billingUrl} onChange={setBillingUrl} placeholder="https://" />

      <Chips label={t("editor.lead")}>
        <button type="button" onClick={() => setLeadDays(null)} className={chip(leadDays === null)}>
          {t("editor.leadDefault", { days: defaultLead })}
        </button>
        {LEAD_CHOICES.map((d) => (
          <button key={d} type="button" onClick={() => setLeadDays(d)} className={chip(leadDays === d)}>
            {t("editor.leadDays", { days: d })}
          </button>
        ))}
      </Chips>

      <TextareaField label={t("editor.notes")} value={notes} onChange={setNotes} rows={3} />

      {!isNew && <ToggleField label={t("editor.active")} hint={t("editor.activeHint")} checked={active} onChange={setActive} />}

      <div className="flex flex-wrap items-center gap-3 border-t border-border pt-4">
        <AdminButton
          type="submit"
          variant="primary"
          pending={pending}
          disabled={missing !== null}
          disabledReason={missing ?? undefined}
          icon={<Save className="size-3.5" strokeWidth={2.4} />}
        >
          {t("editor.save")}
        </AdminButton>
        {missing && <span className="text-[11.5px] text-muted">{missing}</span>}
      </div>
    </form>
  );
}
