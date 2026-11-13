-- ============================================================================
-- 0221 · Prospection: an agency is not an owner
--
-- The team meets two kinds of posters in the Facebook groups: private owners,
-- and agencies. An owner is asked for his yes and his annonce is put online for
-- him (0218). An agency gets another message — the agencies' offer — and is
-- invited to open an agence of its own: nothing is published for it. The lead's
-- `is_broker` already says which it is; what it lacked is a way to record that an
-- agency answered « interested ».
--
-- So the two lists the app checks against get one more word each:
--   prospect_leads.outcome   'interested'  (the agency wants to hear more)
--   prospect_events.kind     'interested'
--
-- Rollback: supabase/rollbacks/0221_prospection_agencies.down.sql. Idempotent.
-- ============================================================================

alter table public.prospect_leads drop constraint if exists prospect_leads_outcome_check;
alter table public.prospect_leads add constraint prospect_leads_outcome_check
  check (outcome is null or outcome in ('no_answer', 'thinking', 'interested', 'refused', 'wrong_number'));

alter table public.prospect_events drop constraint if exists prospect_events_kind_check;
alter table public.prospect_events add constraint prospect_events_kind_check
  check (kind in (
    'created', 'contacted', 'no_answer', 'thinking', 'interested', 'refused', 'wrong_number',
    'confirmed', 'published', 'sms', 'note', 'assigned', 'broker'
  ));
