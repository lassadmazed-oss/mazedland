-- Rollback of 0226 · the profile trigger reads the phone from user_metadata again
-- (the 0164 body). Only do this if account creation lost its phone.

create or replace function public._on_auth_user_created()
returns trigger
language plpgsql
security definer
set search_path = public
as $function$
begin
  insert into public.profiles (id, full_name, phone, role, language, governorate)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', null),
    coalesce(new.raw_user_meta_data ->> 'phone', null),
    'individual'::user_role,
    case when new.raw_user_meta_data ->> 'language' in ('fr', 'ar')
         then new.raw_user_meta_data ->> 'language'
         else 'fr' end,
    coalesce(new.raw_user_meta_data ->> 'governorate', null)
  )
  on conflict (id) do nothing;
  return new;
end;
$function$;
