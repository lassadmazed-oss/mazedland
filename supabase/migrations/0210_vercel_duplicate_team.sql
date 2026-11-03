-- ============================================================================
-- 0210 · The paid-services watch tells the owner when a second Vercel team pays.
--
-- On 2026-11-03 the projects moved to a new Vercel team (« lassad-757960fc »)
-- while the old one (« lassad ») kept its Pro plan: both were charged 20 USD
-- for the same month, and nobody saw it until the owner read the bank
-- statement. The hourly run (src/lib/services/providers.ts) now lists every
-- team the token sees; another team on a paid plan sets the Vercel row to
-- « duplicate », and the console texts the owner once (stage « duplicate »,
-- cycle « open », re-armed once it clears, like a low credit).
--
-- Only widens two checks, so the code before it keeps working. Idempotent.
--
-- Rollback: supabase/rollbacks/0210_vercel_duplicate_team.down.sql
-- ============================================================================

alter table public.paid_services drop constraint if exists paid_services_auto_status_check;
alter table public.paid_services add constraint paid_services_auto_status_check
  check (auto_status is null or auto_status in ('ok', 'unpaid', 'blocked', 'low', 'duplicate', 'error'));

alter table public.paid_service_alerts drop constraint if exists paid_service_alerts_stage_check;
alter table public.paid_service_alerts add constraint paid_service_alerts_stage_check
  check (stage in (
    'lead', 'day_before', 'day', 'overdue', 'unpaid', 'blocked', 'low', 'duplicate',
    'site_blocked', 'site_down', 'site_ok', 'monitor_stale', 'test'));
