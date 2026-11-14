-- ============================================================================
-- 0226 · The phone a profile is born with comes from the server, not the visitor
--
-- Security audit, 2026-11-14. `_on_auth_user_created` (0164) copied
-- `raw_user_meta_data ->> 'phone'` into `profiles.phone`. user_metadata is
-- whatever the caller of Supabase's PUBLIC sign-up endpoint sends — the anon key
-- is in every page, and the project accepted sign-ups — so anyone could create
-- an account carrying a number no code ever proved (verified live: POST
-- /auth/v1/signup with data.phone answered with a session and a profile holding
-- that number). The site treats `profiles.phone` as the number an OTP verified
-- (the profile guard says so), and one number can have one profile: a squatter
-- locks the real owner out of signing up, and the notices meant for the owner
-- reach the squatter's account.
--
-- The three server routes that create accounts after proving the number (sign-up,
-- the guest demande, Prospection) now pass it in `app_metadata`, which only the
-- admin API can write. The trigger reads it from there. A sign-up through the
-- public endpoint now gets a profile with no phone.
--
-- Deploy the code first (it sends both), then apply this.
-- Rollback: supabase/rollbacks/0226_signup_phone_from_the_server.down.sql.
-- ============================================================================

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
    -- The number a code proved: set by the server (admin API) in app_metadata.
    -- Never from user_metadata, which the visitor writes.
    coalesce(new.raw_app_meta_data ->> 'phone', null),
    -- HARDCODED: never trust client metadata for role (re-fix of 0006 C1).
    'individual'::user_role,
    -- The signup page's locale. Only values the column accepts, else French.
    case when new.raw_user_meta_data ->> 'language' in ('fr', 'ar')
         then new.raw_user_meta_data ->> 'language'
         else 'fr' end,
    coalesce(new.raw_user_meta_data ->> 'governorate', null)
  )
  on conflict (id) do nothing;

  -- NOTE: the 0045 `if role = 'admin' then update auth.users ...` mirror
  -- block is deliberately NOT recreated. The JWT admin claim is only ever
  -- set by trusted server-side flows.
  return new;
end;
$function$;
