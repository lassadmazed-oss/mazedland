-- ============================================================================
-- 0228 · Social Publisher: TikTok
--
-- The owner (2026-11-15): an annonce that goes on the « Mazed » Facebook page
-- goes on TikTok (@mazed613) too. The tables took the 'tiktok' channel and
-- platform from the start (0170, 0214); what the engine adds is two reasons a
-- TikTok post is left to a person:
--
--   tiktok_draft      the post was sent as a draft to the TikTok app's inbox
--                     (social_tiktok_draft): someone opens TikTok, adds the
--                     music, posts it, and pastes its link in « File »
--   tiktok_unaudited  TikTok refused a direct post because it has not audited
--                     the app yet (it then only takes private accounts):
--                     switch to drafts, or post it by hand
--
-- The tokens need no column: both (2 h access, 180 days refresh) are sealed
-- together in social_accounts.token_sealed, and token_expires_at is the
-- refresh token's end. The publish_id TikTok gives is kept in container_id,
-- as Instagram's container is, so a retry follows the same post.
--
-- Rollback: supabase/rollbacks/0228_social_tiktok.down.sql. Idempotent.
-- ============================================================================

alter table public.social_publication_jobs
  drop constraint if exists social_publication_jobs_manual_reason_check;
alter table public.social_publication_jobs
  add constraint social_publication_jobs_manual_reason_check
  check (manual_reason is null or manual_reason in (
    'no_account', 'account_expired', 'groups_manual', 'not_supported',
    'limit_reached', 'media_rejected', 'tiktok_draft', 'tiktok_unaudited'));

notify pgrst, 'reload schema';
