-- ============================================================================
-- 0232 · A category for the immeuble — « عمارة »
--
-- There was none: sellers of a whole building filed it under « Maisons » and
-- were asked « Pièces » (they answered 3, or 0 — MZ-02037, MZ-02112, MZ-02114
-- are three of them), so what a buyer of a building asks first — how many
-- flats, of which size, how many shops, what it brings in — was lost. The
-- owner (2026-11-20): add « Immeubles », with the detail of its flats.
--
--   category     `immeubles`, under « Résidentiel », sold only (the code says
--                so: a whole building is not a rental — src/lib/listings/deal.ts)
--   questions    area_sqm (required), levels (a building's: no « one floor of it »),
--                `units` — « 4 × S+2, 2 × S+3, 1 local » as a short answer
--                (src/lib/listings/units.ts) —, rent_income (what the rented
--                flats bring in a month), titled, year_built, elevator, parking
--
-- The category is created INACTIVE: the code that knows its form ships first,
-- then it is switched on (update categories set is_active = true …), so a
-- page of the old build never offers a category it cannot ask properly.
-- Existing annonces are not moved: only their sellers' own words could say
-- which of them are buildings, and that is the owner's call.
--
-- Rollback: supabase/rollbacks/0232_immeubles.down.sql. Idempotent.
-- Wrapped in one transaction by scripts/apply-migrations.mjs.
-- ============================================================================

insert into public.categories (parent_id, slug, label_fr, label_ar, kind, icon, sort_order, is_active)
select p.id, 'immeubles', 'Immeubles', 'عمارات', 'residential', null, 40, false
  from public.categories p
 where p.slug = 'residentiel'
on conflict (slug) do nothing;

insert into public.category_attributes (category_id, field_key, label, data_type, unit, required, filterable, sort_order, deal_types)
select c.id, q.field_key, q.label, q.data_type, q.unit, q.required, q.filterable, q.sort_order, q.deal_types
  from public.categories c
 cross join (values
   ('area_sqm',   'Surface',                         'number',  'm²', true,  true,  10, null::text[]),
   ('levels',     'Niveaux',                         'number',  null, false, false, 20, null::text[]),
   ('units',      'Appartements et locaux',          'text',    null, false, false, 30, null::text[]),
   ('rent_income','Loyers perçus par mois',          'number',  'DT', false, false, 40, array['sale']),
   ('titled',     'Titre foncier',                   'boolean', null, false, true,  50, array['sale']),
   ('year_built', 'Année de construction',           'number',  null, false, false, 60, null::text[]),
   ('elevator',   'Ascenseur',                       'boolean', null, false, true,  70, null::text[]),
   ('parking',    'Parking / garage',                'boolean', null, false, true,  80, null::text[])
 ) as q(field_key, label, data_type, unit, required, filterable, sort_order, deal_types)
 where c.slug = 'immeubles'
on conflict (category_id, field_key) do nothing;

notify pgrst, 'reload schema';
