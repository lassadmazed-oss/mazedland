-- ============================================================================
-- 0212 · Where an annonce is, on a map
--
-- The owner, 2026-11-04: every annonce may carry its place on a map
-- (optional), and the map shows the properties for sale where they are.
--
-- Two points, because a seller may not want the house itself shown:
--
--   pin_lat / pin_lng   where the seller put the pin. PRIVATE: granted to no
--                       client role (0157 grants listings column by column),
--                       read through the service role by the seller's own
--                       form and by the console only.
--   lat / lng           what visitors see (public since 0001). The pin itself
--                       when the seller chose « exacte »; otherwise a point
--                       drawn at random within the console's radius, so the
--                       circle shown around it holds the house without
--                       pointing at it (src/lib/geo/location.ts). Drawn once
--                       per pin, on the server: saving again does not hand a
--                       visitor a second sample to average.
--   location_exact      the seller's choice, public: the annonce page shows a
--                       pin and a route, or a circle.
-- ============================================================================

begin;

alter table public.listings
  add column if not exists pin_lat numeric(9,6),
  add column if not exists pin_lng numeric(9,6),
  add column if not exists location_exact boolean not null default false;

-- A pin is a pair, and in Tunisia (with its islands and a margin).
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'listings_pin_pair') then
    alter table public.listings
      add constraint listings_pin_pair check ((pin_lat is null) = (pin_lng is null)),
      add constraint listings_pin_in_tunisia check (pin_lat is null or (pin_lat between 30 and 38 and pin_lng between 7 and 12)),
      add constraint listings_point_pair check ((lat is null) = (lng is null));
  end if;
end
$$;

comment on column public.listings.pin_lat is 'Where the seller put the pin (0212). Private: never granted to anon/authenticated.';
comment on column public.listings.pin_lng is 'Where the seller put the pin (0212). Private: never granted to anon/authenticated.';
comment on column public.listings.location_exact is 'The seller shows the pin itself (true) or a circle around a point near it (false, the default) — 0212.';
comment on column public.listings.lat is 'What visitors see: the pin when location_exact, else a point within the radius of it (0212).';

-- The choice is public (the page draws a pin or a circle); the pin is not.
grant select (location_exact) on public.listings to anon, authenticated;

commit;
