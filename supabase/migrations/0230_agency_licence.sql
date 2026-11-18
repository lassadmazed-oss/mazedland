-- ============================================================================
-- 0230 · The licence of an agency
--
-- A real-estate agency in Tunisia needs the Ministry of Commerce's licence
-- (agrément): a company number or a patente is not enough, and the ministry
-- has been closing the agencies that work without one. The site said « Vérifiée »
-- when the team had checked the company's papers (RNE or patente); that is not
-- the same claim, so the licence has its own number and its own check.
--
--   shops.licence_number      what the agency says its licence is (agencies
--                             only; the form asks for it, Réglages can make it
--                             required).
--   shops.licence_checked_at  when an admin checked it against the licence the
--   shops.licence_checked_by  agency showed. Only then does the public page say
--                             « Agence agréée ». Changing the number takes the
--                             check off (the route), like the identity fields
--                             take « Vérifiée » off.
--
-- Rollback: supabase/rollbacks/0230_agency_licence.down.sql. Idempotent.
-- ============================================================================

alter table public.shops
  add column if not exists licence_number     text check (licence_number is null or char_length(licence_number) <= 60),
  add column if not exists licence_checked_at timestamptz,
  add column if not exists licence_checked_by uuid references public.profiles(id) on delete set null;

-- A check without a number to check is not a check.
alter table public.shops drop constraint if exists shops_licence_check_has_number;
alter table public.shops add constraint shops_licence_check_has_number
  check (licence_checked_at is null or licence_number is not null);

comment on column public.shops.licence_number is
  'The agency''s licence (agrément) number from the Ministry of Commerce, as the agency gave it. 0230.';
comment on column public.shops.licence_checked_at is
  'When an admin checked licence_number against the licence shown (the public « Agence agréée » badge). 0230.';

notify pgrst, 'reload schema';

-- The licence itself can be sent with the other papers (Documents tab), and the console reads it beside the number.
alter table public.shop_documents drop constraint if exists shop_documents_kind_check;
alter table public.shop_documents add constraint shop_documents_kind_check
  check (kind in ('rne', 'patente', 'identity', 'licence', 'other'));

notify pgrst, 'reload schema';
