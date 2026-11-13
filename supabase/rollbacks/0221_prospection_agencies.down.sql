-- Rollback of 0221 · « interested » goes. The rows that say it are rewritten
-- first, or the narrower lists below would refuse them: an interested agency
-- becomes « thinking », and its event a note.

update public.prospect_leads set outcome = 'thinking' where outcome = 'interested';
update public.prospect_events set kind = 'note', note = coalesce(note, 'interested') where kind = 'interested';

alter table public.prospect_leads drop constraint if exists prospect_leads_outcome_check;
alter table public.prospect_leads add constraint prospect_leads_outcome_check
  check (outcome is null or outcome in ('no_answer', 'thinking', 'refused', 'wrong_number'));

alter table public.prospect_events drop constraint if exists prospect_events_kind_check;
alter table public.prospect_events add constraint prospect_events_kind_check
  check (kind in (
    'created', 'contacted', 'no_answer', 'thinking', 'refused', 'wrong_number',
    'confirmed', 'published', 'sms', 'note', 'assigned', 'broker'
  ));
