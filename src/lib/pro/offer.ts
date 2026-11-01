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

/**
 * A gift is not lost to a purchase (2026-11-01). Buying a bigger plan used to
 * cancel every smaller period still ahead — and a founding agency's free
 * months, queued behind its paid Starter, are exactly that: paying for the
 * upgrade it chose would have silently taken the three months back (and freed
 * the founding place).
 *
 * A gift that has not started when the new paid period begins, and would
 * begin before that period ends, now starts when it ends — the same length,
 * after what was paid for. A gift already running is left alone (its months
 * are being used), and one that starts after the new period anyway does not
 * move.
 */
export function shiftedGifts(input: {
  gifts: readonly { id: string; startsAt: Date; endsAt: Date }[];
  /** When the new paid period starts, and when it ends. */
  from: Date;
  to: Date;
}): { id: string; startsAt: Date; endsAt: Date }[] {
  const from = input.from.getTime();
  const to = input.to.getTime();
  return input.gifts
    .filter((g) => g.startsAt.getTime() >= from && g.startsAt.getTime() < to)
    .map((g) => ({ id: g.id, startsAt: new Date(to), endsAt: new Date(to + (g.endsAt.getTime() - g.startsAt.getTime())) }));
}
