-- Rollback of 0232 · annonces filed under « Immeubles » go back to « Maisons » (their answers stay in
-- `attributes`), then the category and its questions go.
update public.listings
   set category_id = (select id from public.categories where slug = 'maisons')
 where category_id = (select id from public.categories where slug = 'immeubles');

delete from public.category_attributes
 where category_id = (select id from public.categories where slug = 'immeubles');

delete from public.categories where slug = 'immeubles';

notify pgrst, 'reload schema';
