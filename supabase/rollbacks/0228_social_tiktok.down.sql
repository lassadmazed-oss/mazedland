-- Rollback of 0228 (TikTok's reasons for a task left to a person). The jobs
-- that carry one become « not_supported » first, so the narrower check holds.

update public.social_publication_jobs
   set manual_reason = 'not_supported'
 where manual_reason in ('tiktok_draft', 'tiktok_unaudited');

alter table public.social_publication_jobs
  drop constraint if exists social_publication_jobs_manual_reason_check;
alter table public.social_publication_jobs
  add constraint social_publication_jobs_manual_reason_check
  check (manual_reason is null or manual_reason in (
    'no_account', 'account_expired', 'groups_manual', 'not_supported',
    'limit_reached', 'media_rejected'));

notify pgrst, 'reload schema';
