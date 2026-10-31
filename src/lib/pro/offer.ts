import { addMonths } from "./planChange";

/**
 * A plan the console gives an agence — « Offrir une période », the founding
 * agencies' free months (owner, 2026-10-31). No payment behind it: the period
 * carries no payment id, only `granted_by`.
 *
 * It starts today, or when the last period the agence already has ends:
 * an offer never cuts paid time short (grantPlanPeriod replaces smaller
 * periods; a gift must not). It runs `months` calendar months, like a paid one.
 */
export function offeredPeriod(input: {
  now: Date;
  months: number;
  /** The end of each period the agence has running or paid ahead. */
  endsOfActive: readonly Date[];
}): { startsAt: Date; endsAt: Date } {
  const ahead = input.endsOfActive.filter((d) => d.getTime() > input.now.getTime());
  const startsAt = ahead.length ? new Date(Math.max(...ahead.map((d) => d.getTime()))) : input.now;
  return { startsAt, endsAt: addMonths(startsAt, Math.max(1, Math.floor(input.months))) };
}
