-- Rollback of 0210 · back to the checks of 0203. Rows that say « duplicate »
-- are set back to « ok » first (the next hourly run reads them again), and
-- their alert rows are dropped, or the old checks would refuse them.

update public.paid_services set auto_status = 'ok' where auto_status = 'duplicate';
delete from public.paid_service_alerts where stage = 'duplicate';

alter table public.paid_services drop constraint if exists paid_services_auto_status_check;
alter table public.paid_services add constraint paid_services_auto_status_check
  check (auto_status is null or auto_status in ('ok', 'unpaid', 'blocked', 'low', 'error'));

alter table public.paid_service_alerts drop constraint if exists paid_service_alerts_stage_check;
alter table public.paid_service_alerts add constraint paid_service_alerts_stage_check
  check (stage in (
    'lead', 'day_before', 'day', 'overdue', 'unpaid', 'blocked', 'low',
    'site_blocked', 'site_down', 'site_ok', 'monitor_stale', 'test'));
