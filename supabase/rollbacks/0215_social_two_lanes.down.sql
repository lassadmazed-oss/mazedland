-- Rollback of 0215 (the seller's ask and Mazed's side by side). Back to one
-- live ask per annonce. Where an annonce has two live asks by then, the
-- index below cannot be built: cancel the newer one first (its posts stay on
-- the pages, to take down by hand if needed), e.g.
--
--   select listing_id, array_agg(ref order by created_at) from public.social_publication_requests
--    where status in ('draft', 'pending_approval', 'scheduled', 'published', 'failed')
--    group by listing_id having count(*) > 1;

drop trigger if exists _social_requests_no_overlap on public.social_publication_requests;
drop function if exists public._social_requests_no_overlap();

create unique index if not exists social_requests_one_open
  on public.social_publication_requests (listing_id)
  where status in ('draft', 'pending_approval', 'scheduled', 'published', 'failed');
drop index if exists public.social_requests_one_open_per_lane;

notify pgrst, 'reload schema';
