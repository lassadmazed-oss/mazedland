-- ============================================================================
-- 0231 · A seller can propose another time for a visit
--
-- A visit request (0174) lists up to three half-days the buyer proposes. The
-- seller's side could confirm one, or refuse — and a refusal could name another
-- moment, but only as words in the note: the buyer had to ask again from the
-- annonce. The owner (2026-11-19): the seller must be able to answer « not
-- Saturday, next Friday suits me » (with why: travelling, busy, the keys…) and
-- the buyer must be able to accept it in one tap.
--
--   status 'proposed'   the seller proposed another half-day and waits for the
--                       buyer: requested → proposed → confirmed | cancelled
--                       (the seller may revise the proposal, confirm one of the
--                       buyer's own slots after all, or refuse).
--   proposed_slot       { "day": "2026-11-27", "part": "afternoon" }
--   proposal_reason     why, as a choice (the words are the seller's note)
--   proposal_note       the word the buyer reads with it
--   proposed_at         when
--
-- A proposed visit is still open: one open request per buyer and annonce.
--
-- Rollback: supabase/rollbacks/0231_visit_proposals.down.sql. Idempotent.
-- ============================================================================

alter table public.visit_requests drop constraint if exists visit_requests_status_check;
alter table public.visit_requests add constraint visit_requests_status_check
  check (status in ('requested', 'proposed', 'confirmed', 'declined', 'cancelled', 'done'));

alter table public.visit_requests
  add column if not exists proposed_slot   jsonb,
  add column if not exists proposal_reason text,
  add column if not exists proposal_note   text,
  add column if not exists proposed_at     timestamptz;

alter table public.visit_requests drop constraint if exists visit_requests_proposal_reason_check;
alter table public.visit_requests add constraint visit_requests_proposal_reason_check
  check (proposal_reason is null or proposal_reason in ('travelling', 'busy', 'tenant', 'keys', 'works', 'other'));
alter table public.visit_requests drop constraint if exists visit_requests_proposal_note_check;
alter table public.visit_requests add constraint visit_requests_proposal_note_check
  check (proposal_note is null or char_length(proposal_note) <= 200);

-- One open request per buyer and annonce: a proposed one is open.
drop index if exists public.visit_requests_open_once;
create unique index if not exists visit_requests_open_once
  on public.visit_requests (listing_id, buyer_id)
  where status in ('requested', 'proposed', 'confirmed');

notify pgrst, 'reload schema';
