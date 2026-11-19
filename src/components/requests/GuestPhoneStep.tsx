"use client";

import { useEffect, useState, useTransition } from "react";
import { useLocale, useTranslations } from "next-intl";
import { CheckCircle2, Loader2, Smartphone } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { Ltr } from "@/components/ui/Ltr";
import { PhoneInput } from "@/components/auth/PhoneInput";
import { OtpCodeInput } from "@/components/auth/OtpCodeInput";
import { rememberPhone, useRememberedPhone } from "@/components/auth/rememberedPhone";
import { normalizeE164, validatePhone } from "@/lib/tunisia";
import { useApiError } from "@/lib/useApiError";

/** What POST /api/requests/guest answered, once the demande is saved. */
export type GuestSaved = { id: string; account: "new" | "existing" | "signed_in"; signedIn: boolean };

/**
 * The last step of a visitor's demande (2026-11-13): the number, then the SMS
 * code, then the demande saved — instead of a login page before the form.
 *
 * The same send / verify pair as the signup (/api/auth/phone/send, /verify),
 * then POST /api/requests/guest with the demande, which makes the account (or
 * finds the one that holds the number) and saves it. A new account comes back
 * signed in and the form takes it to « Mes demandes »; a number that already
 * has an account gets the demande saved there and is sent to log in, never
 * signed in by the code.
 */
export function GuestPhoneStep({
  open,
  onClose,
  payload,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  /** The demande as the form would post it. */
  payload: () => Record<string, unknown>;
  /** A new account, signed in: the form leaves for « Mes demandes ». */
  onSaved: (saved: GuestSaved) => void;
}) {
  const t = useTranslations("requests.guest");
  const tr = useTranslations("requests");
  const ta = useTranslations("auth");
  const tp = useTranslations("phone");
  const locale = useLocale();
  const apiError = useApiError();
  const remembered = useRememberedPhone();
  const [typed, setTyped] = useState<{ dialCode: string; number: string } | null>(null);
  const dialCode = typed?.dialCode ?? remembered?.dialCode ?? "+216";
  const number = typed?.number ?? remembered?.number ?? "";
  const [accepted, setAccepted] = useState(false);
  const [phase, setPhase] = useState<"phone" | "code" | "login">("phone");
  const [phone, setPhone] = useState<string | null>(null);
  const [code, setCode] = useState("");
  // The number whose code /verify accepted: a failed save is retried without it.
  const [verifiedPhone, setVerifiedPhone] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState(0);
  const [error, setError] = useState<string | null>(null);
  // Saved in an account that is not signed in here, or nothing saved because the
  // number belongs to an older account: either way the next step is to log in.
  const [loginNote, setLoginNote] = useState<"existing" | "new_no_session" | "phone_taken">("existing");
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    if (cooldown <= 0) return;
    const id = setInterval(() => setCooldown((c) => Math.max(0, c - 1)), 1000);
    return () => clearInterval(id);
  }, [cooldown]);

  const toCode = (normalized: string, wait: number) => {
    setPhone(normalized);
    setCode("");
    setError(null);
    setCooldown(wait);
    setPhase("code");
  };

  async function send(normalized: string): Promise<void> {
    const res = await fetch("/api/auth/phone/send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phone: normalized }),
    });
    const j = (await res.json().catch(() => ({}))) as { ok?: boolean; configured?: boolean; error?: string; retryAfter?: number };
    if (res.ok && j.ok && j.configured !== false) return toCode(normalized, 60);
    // Too many tries from this connection: no code went out, nothing to type.
    if (res.status === 429 && j.error === "rate_limited") {
      setError(ta("errors.tooManyAttempts"));
      return;
    }
    // A code is already out (a recent send) or the hour's cap is reached: the one they have still works.
    if (res.status === 429) return toCode(normalized, j.error === "cooldown" ? j.retryAfter ?? 60 : 60);
    setError(res.status === 400 && j.error === "invalid_phone" ? ta("errors.invalidPhone") : ta("errors.smsSendFailed"));
  }

  function onSend(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const check = validatePhone(dialCode, number);
    if (!check.ok) {
      setError(tp(`errors.${check.code}`, check.values));
      return;
    }
    const normalized = normalizeE164(dialCode, number);
    if (!normalized) {
      setError(ta("errors.invalidNumber"));
      return;
    }
    if (!accepted) {
      setError(ta("signup.acceptRequired"));
      return;
    }
    startTransition(async () => {
      try {
        await send(normalized);
      } catch {
        setError(ta("errors.serverUnreachableCheck"));
      }
    });
  }

  function onResend() {
    if (cooldown > 0 || !phone) return;
    setError(null);
    startTransition(async () => {
      try {
        await send(phone);
      } catch {
        setError(ta("errors.networkError"));
      }
    });
  }

  function onVerify(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const clean = code.replace(/\D/g, "");
    if (clean.length !== 6) {
      setError(ta("otp.enterCode"));
      return;
    }
    if (!phone) return;
    startTransition(async () => {
      try {
        // The code was already accepted and only the save failed: the proof
        // still holds (the server spends it once the demande is in), and the
        // code itself is spent — sending it again would read « wrong code ».
        if (verifiedPhone === phone) {
          await save(phone);
          return;
        }
        const v = await fetch("/api/auth/phone/verify", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ phone, code: clean }),
        });
        const vj = (await v.json().catch(() => ({}))) as { ok?: boolean; error?: string };
        if (!v.ok || !vj.ok) {
          const map: Record<string, string> = {
            wrong_code: ta("otp.wrongCode"),
            expired: ta("otp.expired"),
            no_code: ta("otp.noCode"),
            too_many_attempts: ta("otp.tooManyAttempts"),
          };
          setError(map[vj.error ?? ""] ?? ta("otp.failed"));
          return;
        }
        setVerifiedPhone(phone);
        await save(phone);
      } catch {
        setError(ta("errors.networkError"));
      }
    });
  }

  async function save(verified: string) {
    const res = await fetch("/api/requests/guest", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...payload(), phone: verified, accepted: true }),
    });
    const j = (await res.json().catch(() => ({}))) as Partial<GuestSaved> & { ok?: boolean; error?: string };
    if (res.ok && j.ok && j.id) {
      const saved: GuestSaved = { id: j.id, account: j.account ?? "new", signedIn: j.signedIn === true };
      if (saved.signedIn) return onSaved(saved);
      // Saved, but in an account this browser is not signed in to.
      rememberPhone(dialCode, number);
      setLoginNote(saved.account === "existing" ? "existing" : "new_no_session");
      setPhase("login");
      return;
    }
    if (j.error === "phone_taken") {
      rememberPhone(dialCode, number);
      setLoginNote("phone_taken");
      setPhase("login");
      return;
    }
    if (j.error === "phone_not_verified") {
      setVerifiedPhone(null);
      setPhase("phone");
      setError(ta("signup.phoneNotVerified"));
      return;
    }
    setError(apiError(j, tr("saveFailed")));
  }

  // After « Se connecter »: back to « Mes demandes », or to this form for a
  // demande that could not be saved (its search is still in the address).
  const loginHref = () => {
    const next = loginNote === "phone_taken"
      ? `${window.location.pathname}${window.location.search}`
      : `/${locale}/account/requests`;
    return `/${locale}/login?next=${encodeURIComponent(next)}`;
  };

  return (
    <Modal open={open} onClose={onClose} title={phase === "login" ? t(loginNote === "phone_taken" ? "takenTitle" : "savedTitle") : t("title")}>
      {phase === "phone" && (
        <form onSubmit={onSend} className="space-y-4">
          <p className="text-[13px] leading-relaxed text-muted">{t("body")}</p>
          <label className="block">
            <span className="mazed-eyebrow text-[10px]">{ta("fields.phone")}</span>
            <PhoneInput
              dialCode={dialCode}
              onDialCodeChange={(c) => setTyped((s) => ({ dialCode: c, number: s?.number ?? number }))}
              number={number}
              onNumberChange={(n) => setTyped((s) => ({ dialCode: s?.dialCode ?? dialCode, number: n }))}
              required
            />
          </label>
          {/* The links open the documents beside the form, which keeps what was filled. */}
          <div className="flex items-start gap-2.5 text-[12.5px] leading-relaxed text-muted">
            <input
              id="guest-accept"
              type="checkbox"
              aria-labelledby="guest-accept-text"
              checked={accepted}
              onChange={(e) => setAccepted(e.target.checked)}
              className="mt-0.5 size-4 shrink-0 accent-[var(--foreground)]"
            />
            <span id="guest-accept-text">
              {ta.rich("signup.accept", {
                accept: (chunks) => <label htmlFor="guest-accept" className="cursor-pointer">{chunks}</label>,
                terms: (chunks) => (
                  <a href={`/${locale}/terms`} target="_blank" rel="noreferrer" className="font-bold text-foreground underline underline-offset-4">
                    {chunks}
                  </a>
                ),
                privacy: (chunks) => (
                  <a href={`/${locale}/privacy`} target="_blank" rel="noreferrer" className="font-bold text-foreground underline underline-offset-4">
                    {chunks}
                  </a>
                ),
              })}
            </span>
          </div>
          {error && <p role="alert" aria-live="assertive" className="mazed-tone-bad rounded-lg px-3 py-2 text-xs">{error}</p>}
          <button
            type="submit"
            disabled={pending || !accepted}
            className="mazed-btn-luxe tap-target flex h-12 w-full items-center justify-center gap-2 text-[14px] disabled:opacity-50"
          >
            {pending ? <Loader2 className="size-4 animate-spin" /> : <Smartphone className="size-4" />}
            {t("send")}
          </button>
        </form>
      )}

      {phase === "code" && (
        <form onSubmit={onVerify} className="text-center">
          <p className="text-[13.5px] leading-relaxed text-muted">
            {ta.rich("otp.sentTo", {
              phone: phone ?? "",
              b: (chunks) => (
                <span className="font-bold text-foreground">
                  <Ltr>{chunks}</Ltr>
                </span>
              ),
            })}
          </p>
          <OtpCodeInput value={code} onChange={setCode} ariaLabel={ta("otp.codeLabel")} />
          {error && <p role="alert" aria-live="assertive" className="mazed-tone-bad mt-3 rounded-lg px-3 py-2 text-xs">{error}</p>}
          <div className="mt-5 flex flex-col gap-2">
            <button
              type="submit"
              disabled={pending || code.replace(/\D/g, "").length !== 6}
              className="mazed-btn-luxe tap-target flex h-12 w-full items-center justify-center gap-2 text-[14px] disabled:opacity-50"
            >
              {pending ? <><Loader2 className="size-4 animate-spin" /> {ta("otp.verifying")}</> : t("verify")}
            </button>
            <button
              type="button"
              onClick={onResend}
              disabled={cooldown > 0 || pending}
              className="mazed-btn-quiet tap-target flex h-12 w-full items-center justify-center text-[14px] disabled:opacity-50"
            >
              {cooldown > 0 ? ta("otp.resendIn", { seconds: cooldown }) : ta("otp.resend")}
            </button>
            <button
              type="button"
              onClick={() => {
                setPhase("phone");
                setError(null);
                setCode("");
              }}
              className="text-[12.5px] font-semibold text-muted underline-offset-4 hover:text-foreground hover:underline"
            >
              {ta("otp.changeNumber")}
            </button>
          </div>
        </form>
      )}

      {phase === "login" && (
        <div className="text-center">
          {loginNote !== "phone_taken" && (
            <CheckCircle2 aria-hidden className="mx-auto size-10 text-[var(--tone-ok)]" strokeWidth={1.75} />
          )}
          <p className="mt-3 text-[13.5px] leading-relaxed text-foreground">
            {t(loginNote === "existing" ? "existingBody" : loginNote === "new_no_session" ? "newNoSessionBody" : "takenBody")}
          </p>
          <a
            href={loginHref()}
            className="mazed-btn-luxe tap-target mt-5 flex h-12 w-full items-center justify-center gap-2 text-[14px]"
          >
            {t("login")}
          </a>
        </div>
      )}
    </Modal>
  );
}
