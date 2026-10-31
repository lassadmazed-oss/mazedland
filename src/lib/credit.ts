/**
 * « Simulez votre crédit » on an annonce for sale (owner, 2026-10-31, after
 * Tayara's own). A fixed-rate loan repaid in equal monthly instalments: what a
 * buyer wants to know before calling is whether the monthly payment is within
 * reach. Indicative — insurance, fees and the bank's own rate are not in it.
 */
export type CreditInput = {
  /** The annonce's price. */
  price: number;
  /** Part of the price paid up front, 0–90. */
  downPercent: number;
  years: number;
  /** Annual rate, in percent. */
  ratePercent: number;
};

export type CreditResult = {
  /** What the bank lends. */
  borrowed: number;
  downPayment: number;
  monthly: number;
  /** Everything repaid over the loan. */
  total: number;
  interest: number;
};

/** The equal monthly instalment of a loan: P·r / (1 − (1 + r)^−n), P/n at no interest. */
export function monthlyPayment(principal: number, annualRatePercent: number, years: number): number {
  const n = Math.round(years * 12);
  if (!(principal > 0) || !(n > 0)) return 0;
  const r = annualRatePercent / 100 / 12;
  if (!(r > 0)) return principal / n;
  return (principal * r) / (1 - Math.pow(1 + r, -n));
}

export function simulateCredit(input: CreditInput): CreditResult {
  const down = Math.min(90, Math.max(0, input.downPercent));
  const downPayment = Math.round((input.price * down) / 100);
  const borrowed = Math.max(0, input.price - downPayment);
  const monthly = monthlyPayment(borrowed, input.ratePercent, input.years);
  const total = monthly * Math.round(input.years * 12);
  return {
    borrowed,
    downPayment,
    monthly: Math.round(monthly),
    total: Math.round(total),
    interest: Math.max(0, Math.round(total - borrowed)),
  };
}

/** Rates the buyer can pick, whole percents around the default (which is always one of them). */
export function rateChoices(defaultRate: number): number[] {
  const out = new Set<number>();
  for (let r = 6; r <= 14; r++) out.add(r);
  if (Number.isFinite(defaultRate) && defaultRate > 0) out.add(defaultRate);
  return [...out].sort((a, b) => a - b);
}
