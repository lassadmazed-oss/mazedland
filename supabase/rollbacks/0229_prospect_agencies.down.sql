-- Rollback of 0229 · the agencies list of Prospection goes away, with its events.
-- Nothing else refers to these tables.
drop table if exists public.prospect_agency_events;
drop table if exists public.prospect_agencies;
notify pgrst, 'reload schema';
