-- Rollback of 0208: every guide written in the console goes with the table
-- (export them first: select * from public.articles). The covers stay in the
-- `properties` bucket under articles/ until the nightly sweep (0197) finds
-- nothing naming them.

drop table if exists public.articles;
drop function if exists public._touch_articles();

notify pgrst, 'reload schema';
