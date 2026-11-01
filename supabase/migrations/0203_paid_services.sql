-- ============================================================================
-- 0203 · The paid services the site lives on, and an SMS before one stops.
--
-- On 2026-11-01 both sites answered 402 for fifteen hours: Vercel had
-- soft-blocked team « lassad » for an invoice nobody saw. The owner asked for
-- one console page (/admin/abonnements) listing every paid thing — Vercel,
-- Supabase, the domains, the SMS credit, the AI — with when each renews, and
-- an SMS to their phone a few days before anything ends.
--
--   paid_services        one row per subscription, domain or credit. What the
--                        provider itself reports (Vercel's billing period and
--                        block, a domain's expiry from RDAP, the WinSMS credit
--                        and licence) is refreshed hourly by
--                        /api/cron/services into the auto_* columns.
--   paid_service_alerts  every SMS sent or tried, one per service, stage,
--                        cycle and number: the unique index is what makes « no
--                        duplicates » hold when two runs overlap.
--   services_watch       the state of the watchdog below.
--
-- The hourly run lives on Vercel, so it cannot report Vercel blocking the
-- site — it is blocked with it. services_watchdog() runs here instead, every
-- ten minutes: it fetches the site through pg_net, and on a 402 (blocked), a
-- site that stops answering, or the hourly run going silent, it sends the SMS
-- itself through WinSMS, with the key from the Vault (winsms_api_key). The
-- SMS settings are the console's (app_settings services_*), read with the
-- registry's defaults. Without the Vault key it watches and sends nothing.
--
-- Closed to the client roles: the console reads and writes through the
-- service role, after requireAdmin("abonnements") (owner-only). Idempotent.
--
-- Rollback: supabase/rollbacks/0203_paid_services.down.sql
-- ============================================================================

create table if not exists public.paid_services (
  id              uuid primary key default gen_random_uuid(),
  -- The rows this migration seeds, so a re-run does not seed them twice.
  seed_key        text unique,
  kind            text not null default 'other'
                    check (kind in ('hosting', 'database', 'domain', 'sms', 'email', 'ai', 'other')),
  provider        text not null check (char_length(provider) between 1 and 60),
  name            text not null check (char_length(name) between 1 and 120),
  purpose         text check (purpose is null or char_length(purpose) <= 300),
  -- Null: not known yet (never guessed).
  cost            numeric(12, 2) check (cost is null or cost >= 0),
  currency        text not null default 'USD' check (currency in ('USD', 'EUR', 'TND')),
  cycle           text not null default 'monthly'
                    check (cycle in ('monthly', 'yearly', 'prepaid', 'usage', 'once')),
  -- The next renewal or expiry, as a Tunis day. Null: not known yet.
  renews_on       date,
  -- Paid by itself (a card on file) or by hand.
  auto_renew      boolean not null default true,
  account         text check (account is null or char_length(account) <= 160),
  payment_note    text check (payment_note is null or char_length(payment_note) <= 200),
  billing_url     text check (billing_url is null or (billing_url ~ '^https://' and char_length(billing_url) <= 300)),
  -- Days before the end the first SMS goes; null = services_lead_days.
  lead_days       int check (lead_days is null or lead_days between 1 and 60),
  active          boolean not null default true,
  notes           text check (notes is null or char_length(notes) <= 1000),
  -- What the provider says (src/lib/services/providers.ts).
  auto_source     text check (auto_source is null or auto_source in ('vercel', 'supabase', 'rdap', 'winsms', 'anthropic')),
  auto_ref        text check (auto_ref is null or char_length(auto_ref) <= 120),
  auto_status     text check (auto_status is null or auto_status in ('ok', 'unpaid', 'blocked', 'low', 'error')),
  auto_detail     jsonb not null default '{}'::jsonb,
  auto_checked_at timestamptz,
  sort_order      int not null default 0,
  created_by      uuid references auth.users(id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

drop trigger if exists _touch_paid_services on public.paid_services;
create or replace function public._touch_paid_services() returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;
create trigger _touch_paid_services before update on public.paid_services
  for each row execute function public._touch_paid_services();

create table if not exists public.paid_service_alerts (
  id          bigint generated always as identity primary key,
  -- Null: the site itself (the watchdog's alerts).
  service_id  uuid references public.paid_services(id) on delete cascade,
  stage       text not null check (stage in (
                'lead', 'day_before', 'day', 'overdue', 'unpaid', 'blocked', 'low',
                'site_blocked', 'site_down', 'site_ok', 'monitor_stale', 'test')),
  -- The renewal day the reminder was for, or 'open' for a condition still on
  -- (a block, a low credit): renamed 'closed:<id>' once it clears, so the
  -- next one alerts again.
  cycle_key   text not null,
  phone       text not null,
  status      text not null default 'sending' check (status in ('sending', 'sent', 'failed')),
  attempts    int not null default 1,
  message     text,
  error       text,
  created_at  timestamptz not null default now(),
  sent_at     timestamptz
);

create unique index if not exists paid_service_alerts_once
  on public.paid_service_alerts (service_id, stage, cycle_key, phone) nulls not distinct;
create index if not exists paid_service_alerts_recent on public.paid_service_alerts (created_at desc);

alter table public.paid_services       enable row level security;
alter table public.paid_service_alerts enable row level security;
revoke all on table public.paid_services, public.paid_service_alerts from anon, authenticated;

-- ── One SMS per service, stage, cycle and number ────────────────────────────
-- The id of a row to send now, or null: already sent, being sent, or given up
-- after p_max_attempts. A failed send is retried by the next run.
create or replace function public.claim_service_alert(
  p_service uuid, p_stage text, p_cycle text, p_phone text, p_max_attempts int default 3
) returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id bigint;
begin
  insert into public.paid_service_alerts (service_id, stage, cycle_key, phone)
  values (p_service, p_stage, p_cycle, p_phone)
  on conflict (service_id, stage, cycle_key, phone) do update
    set attempts = public.paid_service_alerts.attempts + 1, status = 'sending', error = null
    where public.paid_service_alerts.status = 'failed'
      and public.paid_service_alerts.attempts < p_max_attempts
  returning id into v_id;
  return v_id;
end $$;

revoke all on function public.claim_service_alert(uuid, text, text, text, int) from public, anon, authenticated;
grant execute on function public.claim_service_alert(uuid, text, text, text, int) to service_role;

-- ── What is known today (2026-11-01) ────────────────────────────────────────
-- Dates and prices the providers report are filled by the first hourly run;
-- what nobody knows yet stays empty for the owner to complete.
insert into public.paid_services
  (seed_key, kind, provider, name, purpose, cost, currency, cycle, renews_on, auto_renew, account,
   billing_url, auto_source, auto_ref, sort_order)
values
  ('vercel', 'hosting', 'Vercel', 'Vercel Pro', 'Héberge www.mazed.immo et www.mazedauto.com',
   20, 'USD', 'monthly', '2026-12-01', true, 'lassad.mazed@gmail.com (équipe « lassad »)',
   'https://vercel.com/lassad/~/settings/billing', 'vercel', 'team_DNguYjDcPZfEF2PCrJH5zowJ', 10),
  ('supabase', 'database', 'Supabase', 'Supabase Pro', 'Base de données, comptes, photos et tâches planifiées',
   null, 'USD', 'monthly', null, true, null,
   'https://supabase.com/dashboard/org/_/billing', 'supabase', 'sajxoovrsoacfnytiijv', 20),
  ('domain-mazed-immo', 'domain', 'Hostinger', 'mazed.immo', 'Le nom de domaine de Mazed Immo',
   null, 'USD', 'yearly', '2027-10-13', true, null,
   'https://hpanel.hostinger.com/domains', 'rdap', 'mazed.immo', 30),
  ('domain-mazedauto-com', 'domain', 'Hostinger', 'mazedauto.com', 'Le nom de domaine de Mazed Auto',
   null, 'USD', 'yearly', '2027-10-21', true, null,
   'https://hpanel.hostinger.com/domains', 'rdap', 'mazedauto.com', 40),
  ('winsms', 'sms', 'WinSMS', 'WinSMS', 'Les SMS du site : codes de connexion, avis, ces alertes',
   null, 'TND', 'prepaid', '2027-10-04', false, null,
   'https://www.winsmspro.com/sms/', 'winsms', null, 50),
  ('anthropic', 'ai', 'Anthropic', 'Claude (API)', 'L''assistant qui remplit les annonces et la recherche en phrases',
   null, 'USD', 'prepaid', null, false, null,
   'https://platform.claude.com/settings/billing', 'anthropic', null, 60)
on conflict (seed_key) do nothing;

-- ── The watchdog, outside Vercel ────────────────────────────────────────────
create table if not exists public.services_watch (
  id               int primary key default 1 check (id = 1),
  ping_request_id  bigint,
  ping_sent_at     timestamptz,
  last_code        int,
  last_checked_at  timestamptz,
  -- Answers in a row that were not a page (timeout, 5xx).
  failures         int not null default 0,
  -- 'site_blocked' | 'site_down' | 'monitor_stale' while one is on.
  incident         text,
  incident_since   timestamptz
);
insert into public.services_watch (id) values (1) on conflict (id) do nothing;
alter table public.services_watch enable row level security;
revoke all on table public.services_watch from anon, authenticated;

-- A console setting as the registry reads it: the stored value, else the default.
create or replace function public._services_setting(p_key text, p_default jsonb) returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce((select value from public.app_settings where key = p_key), p_default)
$$;
revoke all on function public._services_setting(text, jsonb) from public, anon, authenticated;

create or replace function public.services_watchdog() returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  w            public.services_watch%rowtype;
  v_resp       record;
  v_code       int;
  v_failures   int;
  v_incident   text;
  v_since      timestamptz;
  v_beat       timestamptz;
  v_req        bigint;
  v_key        text;
  v_sender     text;
  v_arabic     boolean;
  v_hour       int;
  v_qs         int;
  v_qe         int;
  v_quiet      boolean;
  v_phone      text;
  v_digits     text;
  v_id         bigint;
  v_msg        text;
  v_stage      text;
  v_time       text;
begin
  select * into w from public.services_watch where id = 1 for update skip locked;
  if not found then return; end if;

  -- 1. The answer to the previous ping (pg_net keeps responses for hours).
  v_code := w.last_code;
  v_failures := w.failures;
  if w.ping_request_id is not null then
    select status_code, timed_out into v_resp from net._http_response where id = w.ping_request_id;
    if found then
      v_code := case when v_resp.timed_out or v_resp.status_code is null then 0 else v_resp.status_code end;
    elsif w.ping_sent_at < now() - interval '5 minutes' then
      v_code := 0;
    else
      v_code := null; -- still in flight: judge it next time
    end if;
  end if;

  if v_code is not null and w.ping_request_id is not null then
    v_failures := case when v_code = 0 or v_code >= 500 then w.failures + 1 else 0 end;
  end if;

  -- 2. What is wrong, if anything. A 402 is Vercel's block (billing): at once.
  --    No answer twice in a row (20 minutes) is the site down. A site that
  --    answers while the hourly run has not stamped for three hours is the
  --    monitor itself stopped — reminders would no longer go.
  select last_run into v_beat from public.cron_heartbeat where job = 'services_watch';
  v_incident := case
    when v_code = 402 then 'site_blocked'
    when v_failures >= 2 then 'site_down'
    when v_beat is not null and v_beat < now() - interval '3 hours' then 'monitor_stale'
    else null
  end;
  v_since := case
    when v_incident is null then null
    when v_incident = w.incident then w.incident_since
    else now()
  end;

  -- 3. Ping again for next time.
  select net.http_get(
    url := 'https://www.mazed.immo/robots.txt',
    headers := jsonb_build_object('User-Agent', 'MazedWatchdog/1 (+https://www.mazed.immo)'),
    timeout_milliseconds := 15000
  ) into v_req;

  update public.services_watch
     set ping_request_id = v_req,
         ping_sent_at = now(),
         last_code = coalesce(v_code, w.last_code),
         last_checked_at = case when v_code is not null then now() else w.last_checked_at end,
         failures = v_failures,
         incident = v_incident,
         incident_since = v_since
   where id = 1;

  -- 4. The SMS, when the console allows it.
  if v_incident is null and w.incident is null then return; end if;
  if (public._services_setting('services_alerts_enabled', 'true'::jsonb)) #>> '{}' <> 'true' then return; end if;
  if (public._services_setting('sms_daily_cap', '6'::jsonb)) #>> '{}' = '0' then return; end if;
  select decrypted_secret into v_key from vault.decrypted_secrets where name = 'winsms_api_key';
  if v_key is null then return; end if;
  select decrypted_secret into v_sender from vault.decrypted_secrets where name = 'winsms_sender_id';

  v_arabic := (public._services_setting('services_sms_arabic', 'true'::jsonb)) #>> '{}' = 'true';
  v_hour := extract(hour from now() at time zone 'Africa/Tunis')::int;
  v_qs := coalesce((public._services_setting('services_quiet_start', '22'::jsonb) #>> '{}')::int, 22);
  v_qe := coalesce((public._services_setting('services_quiet_end', '8'::jsonb) #>> '{}')::int, 8);
  v_quiet := case
    when v_qs = v_qe then false
    when v_qs > v_qe then v_hour >= v_qs or v_hour < v_qe
    else v_hour >= v_qs and v_hour < v_qe
  end;

  if v_incident is not null then
    v_stage := v_incident;
    -- A blocked or dead site is urgent; the stopped monitor waits for the morning.
    if v_quiet and (v_incident = 'monitor_stale'
                    or (public._services_setting('services_urgent_at_night', 'true'::jsonb)) #>> '{}' <> 'true') then
      return;
    end if;
  else
    -- Back to normal: say so, only to whoever heard about the incident.
    v_stage := 'site_ok';
    if v_quiet or w.incident = 'monitor_stale' then return; end if;
  end if;

  v_time := to_char(coalesce(v_since, w.incident_since, now()) at time zone 'Africa/Tunis', 'HH24:MI');
  v_msg := case v_stage
    when 'site_blocked' then case when v_arabic
      then 'Mazed Immo - تنبيه' || chr(10) || 'الموقع www.mazed.immo مسكّر من Vercel على خاطر الخلاص. خلّص الفاتورة توّا: vercel.com ← lassad ← Settings ← Billing'
      else 'Mazed Immo - ALERTE' || chr(10) || 'Le site www.mazed.immo est bloqué par Vercel (paiement). Payez la facture : vercel.com > lassad > Settings > Billing' end
    when 'site_down' then case when v_arabic
      then 'Mazed Immo - تنبيه' || chr(10) || 'الموقع www.mazed.immo ما يجاوبش من ' || v_time || '. ثبّت في Vercel و Supabase.'
      else 'Mazed Immo - ALERTE' || chr(10) || 'Le site www.mazed.immo ne répond plus depuis ' || v_time || '. Vérifiez Vercel et Supabase.' end
    when 'monitor_stale' then case when v_arabic
      then 'Mazed Immo' || chr(10) || 'مراقبة الاشتراكات وقفت من ' || v_time || '. حلّ صفحة /admin/abonnements.'
      else 'Mazed Immo' || chr(10) || 'La surveillance des abonnements ne tourne plus depuis ' || v_time || '. Ouvrez /admin/abonnements.' end
    else case when v_arabic
      then 'Mazed Immo' || chr(10) || 'الموقع www.mazed.immo رجع يخدم.'
      else 'Mazed Immo' || chr(10) || 'Le site www.mazed.immo répond de nouveau.' end
  end;

  for v_phone in
    select jsonb_array_elements_text(public._services_setting('services_sms_recipients', '["+216 98 124 111"]'::jsonb))
  loop
    v_digits := regexp_replace(v_phone, '[^0-9]', '', 'g');
    if length(v_digits) = 8 then v_digits := '216' || v_digits; end if;
    if length(v_digits) < 8 then continue; end if;

    if v_stage = 'site_ok' then
      -- Only the numbers that were told about this incident.
      if not exists (
        select 1 from public.paid_service_alerts
         where service_id is null and stage = w.incident and cycle_key = w.incident_since::text
           and phone = v_digits and status = 'sent'
      ) then continue; end if;
      v_id := public.claim_service_alert(null, 'site_ok', w.incident_since::text, v_digits);
    else
      v_id := public.claim_service_alert(null, v_stage, v_since::text, v_digits);
    end if;
    if v_id is null then continue; end if;

    perform net.http_get(
      url := 'https://www.winsmspro.com/sms/sms/api',
      params := jsonb_build_object(
        'action', 'send-sms', 'api_key', v_key, 'to', v_digits,
        'from', coalesce(nullif(v_sender, ''), 'MAZED'), 'sms', v_msg, 'response', 'json'
      ) || case when v_arabic then '{"unicode": "1"}'::jsonb else '{}'::jsonb end,
      headers := jsonb_build_object(
        'Accept', 'application/json, text/plain, */*',
        'User-Agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36'
      ),
      timeout_milliseconds := 10000
    );
    -- pg_net answers later; handed to the gateway is what this side can know.
    update public.paid_service_alerts set status = 'sent', sent_at = now(), message = v_msg where id = v_id;
  end loop;
end $$;

revoke all on function public.services_watchdog() from public, anon, authenticated;

do $$
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    raise notice '0203: pg_cron missing — services_watchdog not scheduled.';
    return;
  end if;
  if exists (select 1 from cron.job where jobname = 'mazed-services-watchdog') then
    perform cron.unschedule('mazed-services-watchdog');
  end if;
  perform cron.schedule('mazed-services-watchdog', '*/10 * * * *', 'select public.services_watchdog()');
  if not exists (select 1 from vault.secrets where name = 'winsms_api_key') then
    raise notice '0203: vault secret "winsms_api_key" not found — the watchdog watches but sends no SMS until it is created.';
  end if;
end $$;

notify pgrst, 'reload schema';
