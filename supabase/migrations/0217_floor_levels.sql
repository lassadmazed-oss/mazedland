-- ============================================================================
-- 0217 · Floors and levels: a duplex, a triplex, a villa on two levels
--
-- Every residential and professional category asked one number, « Étage »
-- (0 = RDC). It is the right question for a flat or an office and the wrong
-- one for a house: the 12 published houses and villas that answered it all
-- said « RDC » — MZ-01706 among them, a villa « sur 2 niveaux » — and no
-- annonce could say duplex or triplex, which about twenty of them wrote by
-- hand in their description instead (read-only audit, 2026-11-13).
--
-- 1. `levels` — how many levels — is asked of appartements, beside its floor
--    (one level, duplex, triplex), and of maisons and villas instead of the
--    floor (1, 2, 3, 4 and more, or one floor of the house, which then asks
--    which floor and stores floor_only). src/lib/listings/levels.ts reads the
--    two shapes from whether the category also asks « floor », so an admin
--    who moves the questions in /admin/catalogue moves the form with them.
-- 2. The « floor » question of maisons and villas goes. Its old answers stay
--    in `attributes`, untouched: the pages stop showing a floor on a whole
--    building, and the seller's next save of the form retires it.
-- 3. `search_text` folds « duplex » / « triplex », in Latin and in Arabic
--    letters, for levels 2 and 3, so a search for « دوبلكس » finds the flats
--    and the villas alike — the natural search no longer reads the word as
--    « appartement » (src/lib/search/understand.ts). Rebuilt the way 0159
--    did: a generated column's expression cannot be altered in place, and its
--    trigram index and the two client roles' SELECT grant come back with it.
--    Checked on the live database on 2026-11-13: only that index depends on
--    the column, and no function reads it.
--
-- rollbacks/0217_floor_levels.down.sql undoes all three.
-- Wrapped in one transaction by scripts/apply-migrations.mjs.
-- ============================================================================

-- 1. « Niveaux », as admins type labels; the pages translate the known key.
insert into public.category_attributes (category_id, field_key, label, data_type, required, filterable, sort_order)
select c.id, 'levels', 'Niveaux', 'number', false, false,
       case c.slug when 'appartements' then 45 else 40 end
  from public.categories c
 where c.slug in ('appartements', 'maisons', 'villas')
on conflict (category_id, field_key) do nothing;

-- 2. A whole house is not « on a floor ».
delete from public.category_attributes a
 using public.categories c
 where c.id = a.category_id
   and c.slug in ('maisons', 'villas')
   and a.field_key = 'floor';

-- 3. « duplex » and « triplex » in the search text.
drop index if exists public.listings_search_idx;

alter table public.listings drop column if exists search_text;

alter table public.listings
  add column search_text text generated always as (
    public.f_unaccent(lower(
      coalesce(title, '') || ' ' || coalesce(governorate, '') || ' ' ||
      coalesce(delegation, '') || ' ' || coalesce(address, '') || ' ' ||
      coalesce(description, '') || ' ' || coalesce(reference, '') ||
      case attributes->>'levels'
        when '2' then ' duplex دوبلكس دوبليكس'
        when '3' then ' triplex تريبلكس تريبليكس'
        else ''
      end
    ))
  ) stored;

create index listings_search_idx on public.listings using gin (search_text gin_trgm_ops);

grant select (search_text) on public.listings to anon, authenticated;

notify pgrst, 'reload schema';
