-- Rollback of 0218 (Prospection). Drops the leads, their events, the
-- « ne pas contacter » list and the owners' private links, and the column the
-- public page reads. The annonces and accounts the team made stay: they are
-- ordinary rows once created. Take a copy of prospect_leads first if the
-- history matters (the confirmation texts are the proof of each yes).

alter table public.listings drop column if exists team_confirmed_at;

drop table if exists public.listing_manage_tokens;
drop table if exists public.prospect_dnc;
drop table if exists public.prospect_events;
drop table if exists public.prospect_leads;

notify pgrst, 'reload schema';
