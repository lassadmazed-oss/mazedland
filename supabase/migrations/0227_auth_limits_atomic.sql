-- ============================================================================
-- 0227 · The SMS-code and sign-in limits hold when requests arrive together
--
-- Security audit, 2026-11-14. Four limits of the phone flow were « read, then
-- write » across two requests, so a burst of parallel ones all read the same
-- state and all passed:
--
--   · /api/auth/phone/send read the last send and the hourly count, then upserted:
--     N parallel requests for one number sent N SMS (cost, and a stranger's
--     phone ringing). The cooldown and the cap are now one locked function.
--   · /api/auth/phone/verify read `attempts`, compared, then wrote attempts + 1:
--     parallel guesses all saw 0, so « 5 tries per code » was not 5. The row is
--     now locked while it is judged.
--   · check_auth_ratelimit (0061) counted the IP's recent hits, then inserted its
--     own: same race. Now under an advisory lock, as check_rate_limit has been
--     since 0196.
--
-- Service role only (they hold the code's hash and decide who may send).
--
-- Rollback: supabase/rollbacks/0227_auth_limits_atomic.down.sql. Idempotent.
-- ============================================================================

-- ── 1. The per-IP limit ─────────────────────────────────────────────────────
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
    return false; -- can't identify caller → don't block (route also limits)
  end if;
  -- Held until the calling transaction ends (one statement, through PostgREST):
  -- the count and the insert below are one step per address.
  perform pg_advisory_xact_lock(hashtext('auth_attempts:' || p_ip));
  select count(*) into v_recent
    from public.auth_attempts
   where ip = p_ip
     and attempted_at >= now() - interval '5 minutes';
  -- Opportunistic cleanup so the table never grows unbounded.
  delete from public.auth_attempts where attempted_at < now() - interval '1 day';
  if v_recent >= 20 then
    return true; -- blocked
  end if;
  insert into public.auth_attempts (ip) values (p_ip);
  return false;
end;
$function$;

-- ── 2. Issue a code: the cooldown, the hourly cap and the write are one step ──
-- Returns { status: 'ok' } after storing the hash and counting the send, or
-- { status: 'cooldown', retry_after: seconds } / { status: 'too_many' }.
create or replace function public.otp_issue(
  p_phone         text,
  p_hash          text,
  p_ttl_secs      int,
  p_cooldown_secs int,
  p_window_secs   int,
  p_max           int
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
declare
  r        public.phone_otps%rowtype;
  v_count  int := 1;
  v_wstart timestamptz := now();
begin
  perform pg_advisory_xact_lock(hashtext('otp:' || p_phone));

  select * into r from public.phone_otps where phone = p_phone;
  if found then
    if now() < r.last_sent_at + make_interval(secs => p_cooldown_secs) then
      return jsonb_build_object(
        'status', 'cooldown',
        'retry_after', ceil(extract(epoch from (r.last_sent_at + make_interval(secs => p_cooldown_secs) - now())))::int
      );
    end if;
    if now() < r.window_start + make_interval(secs => p_window_secs) then
      if r.send_count >= p_max then
        return jsonb_build_object('status', 'too_many');
      end if;
      v_count := r.send_count + 1;
      v_wstart := r.window_start;
    end if;
  end if;

  insert into public.phone_otps (phone, code_hash, expires_at, attempts, verified_at, send_count, window_start, last_sent_at)
  values (p_phone, p_hash, now() + make_interval(secs => p_ttl_secs), 0, null, v_count, v_wstart, now())
  on conflict (phone) do update
     set code_hash    = excluded.code_hash,
         expires_at   = excluded.expires_at,
         attempts     = 0,
         -- A new code retires the previous verification.
         verified_at  = null,
         send_count   = excluded.send_count,
         window_start = excluded.window_start,
         last_sent_at = excluded.last_sent_at;

  return jsonb_build_object('status', 'ok');
end;
$function$;

-- ── 3. Judge a guess: the row is locked while it is read and counted ─────────
-- Returns 'no_code' | 'expired' | 'too_many' | 'wrong' | 'ok'. A right guess
-- stamps verified_at and empties the hash (the code cannot be used twice).
create or replace function public.otp_check(p_phone text, p_hash text, p_max_attempts int)
returns text
language plpgsql
security definer
set search_path = public
as $function$
declare
  r public.phone_otps%rowtype;
begin
  select * into r from public.phone_otps where phone = p_phone for update;
  if not found then
    return 'no_code';
  end if;
  if r.expires_at < now() then
    delete from public.phone_otps where phone = p_phone;
    return 'expired';
  end if;
  if r.attempts >= p_max_attempts then
    return 'too_many';
  end if;
  -- An emptied hash is a code already spent: it matches nothing.
  if r.code_hash = '' or r.code_hash <> p_hash then
    update public.phone_otps set attempts = attempts + 1 where phone = p_phone;
    return 'wrong';
  end if;
  update public.phone_otps
     set verified_at = now(), code_hash = '', attempts = 0
   where phone = p_phone;
  return 'ok';
end;
$function$;

revoke all on function public.otp_issue(text, text, int, int, int, int) from public, anon, authenticated;
revoke all on function public.otp_check(text, text, int) from public, anon, authenticated;
grant execute on function public.otp_issue(text, text, int, int, int, int) to service_role;
grant execute on function public.otp_check(text, text, int) to service_role;
