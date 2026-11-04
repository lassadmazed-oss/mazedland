-- Rollback of 0211_price_offers.sql: the offers, their hourly job, and the
-- leads they opened go back to what 0174 allowed. Offers made are lost.
do $$
begin
  if exists (select 1 from cron.job where jobname = 'mazed-expire-offers') then
    perform cron.unschedule('mazed-expire-offers');
  end if;
end $$;
drop function if exists public.expire_price_offers();

-- A client who came with an offer stays a client, as one added by hand.
update public.leads set source = 'manual' where source = 'offer';
alter table public.leads drop constraint if exists leads_source_check;
alter table public.leads add constraint leads_source_check
  check (source in ('visit', 'manual', 'suggestion'));
alter table public.leads drop column if exists offer_id;

delete from public.notifications where kind like 'offer\_%';
drop table if exists public.price_offers;

notify pgrst, 'reload schema';
