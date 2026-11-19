-- Rollback of 0231 · a proposed visit goes back to « requested » (the buyer's own slots are still there),
-- and the proposal columns go away.
update public.visit_requests
   set status = 'requested', decided_at = null, decided_by = null
 where status = 'proposed';

drop index if exists public.visit_requests_open_once;
create unique index if not exists visit_requests_open_once
  on public.visit_requests (listing_id, buyer_id)
  where status in ('requested', 'confirmed');

alter table public.visit_requests drop constraint if exists visit_requests_status_check;
alter table public.visit_requests add constraint visit_requests_status_check
  check (status in ('requested', 'confirmed', 'declined', 'cancelled', 'done'));

alter table public.visit_requests drop constraint if exists visit_requests_proposal_reason_check;
alter table public.visit_requests drop constraint if exists visit_requests_proposal_note_check;
alter table public.visit_requests
  drop column if exists proposed_at,
  drop column if exists proposal_note,
  drop column if exists proposal_reason,
  drop column if exists proposed_slot;

notify pgrst, 'reload schema';
