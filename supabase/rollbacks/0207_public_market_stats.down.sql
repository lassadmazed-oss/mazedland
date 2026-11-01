-- Rollback of 0207 · the public market aggregation goes. Roll the code back
-- first (or switch public_stats_enabled off): /marche calls it. No data is
-- lost — the function reads, it never writes — and the rows it kept in
-- analytics_cache expire with the nightly prune.

drop function if exists public.public_market_stats(int, int, timestamptz);

notify pgrst, 'reload schema';
