-- Rollback of 0217 · floors and levels.
--
-- The « Étage » question comes back on maisons and villas as 0145 seeded it,
-- the « Niveaux » question goes from the three categories, and search_text is
-- rebuilt the way 0159 left it. The answers sellers gave (`levels`,
-- `floor_only` and a house's `floor` in `attributes`) are their data and stay.

insert into public.category_attributes (category_id, field_key, label, data_type, required, filterable, sort_order)
select c.id, 'floor', 'Étage', 'number', false, false, 40
  from public.categories c
 where c.slug in ('maisons', 'villas')
on conflict (category_id, field_key) do nothing;

delete from public.category_attributes a
 using public.categories c
 where c.id = a.category_id
   and c.slug in ('appartements', 'maisons', 'villas')
   and a.field_key = 'levels';

drop index if exists public.listings_search_idx;

alter table public.listings drop column if exists search_text;

alter table public.listings
  add column search_text text generated always as (
    public.f_unaccent(lower(
      coalesce(title, '') || ' ' || coalesce(governorate, '') || ' ' ||
      coalesce(delegation, '') || ' ' || coalesce(address, '') || ' ' ||
      coalesce(description, '') || ' ' || coalesce(reference, '')
    ))
  ) stored;

create index listings_search_idx on public.listings using gin (search_text gin_trgm_ops);

grant select (search_text) on public.listings to anon, authenticated;

notify pgrst, 'reload schema';
