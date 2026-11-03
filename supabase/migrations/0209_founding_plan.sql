-- ============================================================================
-- 0209 — The plan an agence asked for with the founding offer (2026-11-03).
--
-- The owner: while the founding places last, an agence that signs up pays
-- nothing — it picks the offer's plan (Pro, 40 annonces, or Business, 120) and
-- sends its request; the console reviews it, and « Ouvrir » gives it that plan
-- free for `founding_offer_months` (src/lib/pro/founding.ts).
--
-- The request has no payment to carry its plan, so the agence carries it: the
-- slug of the plan it picked, read by « Ouvrir », the console's panel and the
-- agence's own dashboard. Null for every agence that paid, or came before.
-- The place is still taken when the console opens the agence, not here.
-- ============================================================================

alter table public.shops
  add column if not exists founding_plan text
    check (founding_plan is null or char_length(founding_plan) between 1 and 40);

comment on column public.shops.founding_plan is
  'Slug of the plan the agence picked with the founding offer at sign-up; « Ouvrir » gives it free (src/lib/pro/founding.ts).';
