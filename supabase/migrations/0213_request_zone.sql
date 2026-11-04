-- ============================================================================
-- 0213 · A demande's zone, drawn on the map
--
-- The owner, 2026-11-04: on the catalogue map a visitor traces a zone with a
-- finger, and can be told when an annonce appears in it. The zone is kept on
-- the demande (property_requests, 0168) as a ring of [lat, lng] points
-- (src/lib/geo/zone.ts: 3 to 60, in Tunisia); an alert then only goes for an
-- annonce standing inside it — at its public point (0212), or for one without
-- a pin, at its délégation's centre. Null: no zone, the governorates decide.
-- ============================================================================

begin;

alter table public.property_requests
  add column if not exists zone jsonb;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'property_requests_zone_shape') then
    alter table public.property_requests
      add constraint property_requests_zone_shape
      check (zone is null or (jsonb_typeof(zone) = 'array' and jsonb_array_length(zone) between 3 and 60));
  end if;
end
$$;

comment on column public.property_requests.zone is
  'A zone drawn on the catalogue map, [[lat, lng], …] (0213); an alert goes only for an annonce inside it.';

commit;
