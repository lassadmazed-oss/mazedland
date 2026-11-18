-- Rollback of 0230 · the agency licence columns go away (the numbers typed and the checks made with them).
alter table public.shops drop constraint if exists shops_licence_check_has_number;
alter table public.shops
  drop column if exists licence_checked_by,
  drop column if exists licence_checked_at,
  drop column if exists licence_number;
notify pgrst, 'reload schema';

-- Licence documents already sent are kept as « other » so nothing is lost.
update public.shop_documents set kind = 'other' where kind = 'licence';
alter table public.shop_documents drop constraint if exists shop_documents_kind_check;
alter table public.shop_documents add constraint shop_documents_kind_check
  check (kind in ('rne', 'patente', 'identity', 'other'));
notify pgrst, 'reload schema';
