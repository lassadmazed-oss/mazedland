-- Rollback of 0227 · the OTP routes go back to reading and writing in two steps
-- (the code that calls otp_issue / otp_check must be rolled back first).

drop function if exists public.otp_issue(text, text, int, int, int, int);
drop function if exists public.otp_check(text, text, int);

-- check_auth_ratelimit as 0061 wrote it: no lock.
create or replace function public.check_auth_ratelimit(p_ip text)
returns boolean
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_recent int;
begin
  if p_ip is null or p_ip = '' then
    return false;
  end if;
  select count(*) into v_recent
    from public.auth_attempts
   where ip = p_ip
     and attempted_at >= now() - interval '5 minutes';
  delete from public.auth_attempts where attempted_at < now() - interval '1 day';
  if v_recent >= 20 then
    return true;
  end if;
  insert into public.auth_attempts (ip) values (p_ip);
  return false;
end;
$function$;
