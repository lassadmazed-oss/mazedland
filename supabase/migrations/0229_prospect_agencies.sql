-- ============================================================================
-- 0229 · Prospection: the agencies of Tunisia, and the follow-up of each
--
-- Besides the private owners found in Facebook posts (0218), the team works a
-- list: the real-estate agencies of the whole country. Someone calls each one,
-- says what the offer is, and records what came of it; the owner reads, every
-- evening, who did what, which agency joined, which one posted, which one
-- liked the offer and which one did not (and why).
--
--   prospect_agencies        one agency: its name, number, place, where the
--                            call stands, who is in charge of it, and — found
--                            by the site itself, not typed — the agence it
--                            became (`shop_id`) once it signed up.
--   prospect_agency_events   what was done, by whom, when (append-only in
--                            use). `signed_up` and `posted` are written by the
--                            site when it sees the agency has opened an
--                            agence / put an annonce online (actor null: they
--                            count for the member in charge).
--
-- A number is on the list once (partial unique index): a second row for the
-- same number is a duplicate, not a second chance. The « ne pas contacter »
-- list of 0218 (prospect_dnc) is honoured at import and when someone declines.
--
-- Closed to the browser (RLS on, no policy): the console's routes read and
-- write with the service role after checking the « prospection » section.
--
-- Rollback: supabase/rollbacks/0229_prospect_agencies.down.sql. Idempotent.
-- ============================================================================

create table if not exists public.prospect_agencies (
  id               uuid primary key default gen_random_uuid(),
  name             text not null check (char_length(name) between 1 and 160),
  phone            text check (phone is null or phone ~ '^\+216[0-9]{8}$'),
  phone2           text check (phone2 is null or phone2 ~ '^\+216[0-9]{8}$'),
  governorate      text check (governorate is null or char_length(governorate) <= 40),
  city             text check (city is null or char_length(city) <= 120),
  address          text check (address is null or char_length(address) <= 300),
  website          text check (website is null or char_length(website) <= 300),
  facebook_url     text check (facebook_url is null or char_length(facebook_url) <= 600),
  email            text check (email is null or char_length(email) <= 200),
  -- The company's identifier in the national register, when known, and whether it holds the licence.
  legal_id         text check (legal_id is null or char_length(legal_id) <= 60),
  licensed         boolean,
  -- Where the row came from.
  source           text not null default 'manual'
    check (source in ('csv', 'manual', 'extension', 'google', 'chamber', 'other')),
  source_note      text check (source_note is null or char_length(source_note) <= 200),
  -- Where the call stands. `outcome` is the last answer while it is not decided.
  status           text not null default 'to_call'
    check (status in ('to_call', 'contacted', 'interested', 'declined')),
  outcome          text check (outcome is null or outcome in ('no_answer', 'callback', 'info_sent')),
  decline_reason   text check (decline_reason is null or decline_reason in
    ('price', 'no_time', 'other_platform', 'not_interested', 'closed_down', 'wrong_number', 'other')),
  assigned_to      uuid references public.profiles(id) on delete set null,
  created_by       uuid references public.profiles(id) on delete set null,
  follow_up_at     timestamptz,
  last_contact_at  timestamptz,
  contact_count    integer not null default 0 check (contact_count >= 0),
  -- Found by the site: the agence this one opened, and when it was first seen.
  shop_id          uuid references public.shops(id) on delete set null,
  signed_up_at     timestamptz,
  first_posted_at  timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

-- A number once on the list.
create unique index if not exists prospect_agencies_phone_uq on public.prospect_agencies (phone) where phone is not null;
create index if not exists prospect_agencies_work_idx on public.prospect_agencies (assigned_to, status, follow_up_at);
create index if not exists prospect_agencies_status_idx on public.prospect_agencies (status, created_at desc);
create index if not exists prospect_agencies_gov_idx on public.prospect_agencies (governorate);
create index if not exists prospect_agencies_shop_idx on public.prospect_agencies (shop_id) where shop_id is not null;

drop trigger if exists _touch_prospect_agencies on public.prospect_agencies;
create trigger _touch_prospect_agencies before update on public.prospect_agencies
  for each row execute function public._touch_updated_at();

create table if not exists public.prospect_agency_events (
  id         uuid primary key default gen_random_uuid(),
  agency_id  uuid not null references public.prospect_agencies(id) on delete cascade,
  kind       text not null check (kind in (
    'created', 'imported', 'contacted', 'no_answer', 'callback', 'info_sent',
    'interested', 'declined', 'assigned', 'note', 'reopened', 'signed_up', 'posted'
  )),
  channel    text check (channel is null or channel in ('whatsapp', 'sms', 'call', 'messenger', 'other')),
  note       text check (note is null or char_length(note) <= 2000),
  actor_id   uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists prospect_agency_events_agency_idx on public.prospect_agency_events (agency_id, created_at);
-- The day's figures per member.
create index if not exists prospect_agency_events_actor_idx on public.prospect_agency_events (actor_id, kind, created_at desc);
create index if not exists prospect_agency_events_day_idx on public.prospect_agency_events (created_at desc);

-- ── Closed to the browser ───────────────────────────────────────────────────
alter table public.prospect_agencies enable row level security;
alter table public.prospect_agency_events enable row level security;

revoke all on table public.prospect_agencies from anon, authenticated;
revoke all on table public.prospect_agency_events from anon, authenticated;

grant select, insert, update, delete on table public.prospect_agencies to service_role;
grant select, insert on table public.prospect_agency_events to service_role;

notify pgrst, 'reload schema';
