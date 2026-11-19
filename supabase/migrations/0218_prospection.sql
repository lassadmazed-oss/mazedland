-- ============================================================================
-- 0218 · Prospection: the owners the team brings to Mazed Immo
--
-- Many private owners post their property in Facebook groups and never think of
-- a classifieds site. A small team finds the post, asks the owner, and — once
-- the owner has said yes — puts the annonce online for them. This is the work
-- the console's « Prospection » screen holds:
--
--   prospect_leads   one post found: its text, the draft read from it, the
--                    owner's number, where the conversation stands, and — once
--                    the owner said yes — the account and the annonce made.
--   prospect_events  what was done, by whom, and when (append-only in use:
--                    nothing updates or deletes a row).
--   prospect_dnc     numbers that said no, or asked not to be written to
--                    again: a new lead on one of them is refused.
--   listing_manage_tokens
--                    the private link sent by SMS with the online annonce:
--                    it lets the owner take the annonce down or mark it sold
--                    without a password (only the token's hash is kept).
--   listings.team_confirmed_at
--                    set when the team confirmed the annonce with its owner:
--                    the public page may say so.
--
-- Every table is closed to the browser (RLS on, no policy): the console's API
-- routes read and write them with the service role after checking the
-- « prospection » section of the team (src/lib/admin/sections.ts).
--
-- Rollback: supabase/rollbacks/0218_prospection.down.sql. Idempotent.
-- ============================================================================

-- ── 1. Leads ────────────────────────────────────────────────────────────────
create table if not exists public.prospect_leads (
  id                   uuid primary key default gen_random_uuid(),
  status               text not null default 'to_contact'
    check (status in ('to_contact', 'contacted', 'confirmed', 'online', 'declined')),
  -- The owner's number, as +216XXXXXXXX (src/lib/prospection/model.ts).
  phone                text check (phone is null or phone ~ '^\+216[0-9]{8}$'),
  poster_name          text check (poster_name is null or char_length(poster_name) <= 120),
  source_url           text check (source_url is null or char_length(source_url) <= 600),
  source_text          text not null check (char_length(source_text) between 1 and 8000),
  language             text not null default 'ar' check (language in ('ar', 'fr')),
  -- What the assistant read from the post (src/lib/ai/listing.ts ListingDraft),
  -- plus anything the team corrected by hand.
  draft                jsonb not null default '{}'::jsonb,
  is_broker            boolean not null default false,
  assigned_to          uuid references public.profiles(id) on delete set null,
  created_by           uuid references public.profiles(id) on delete set null,
  follow_up_at         timestamptz,
  -- The last answer while the lead is not yet a yes.
  outcome              text check (outcome is null or outcome in ('no_answer', 'thinking', 'refused', 'wrong_number')),
  confirmation_text    text check (confirmation_text is null or char_length(confirmation_text) <= 2000),
  confirmation_channel text check (confirmation_channel is null or confirmation_channel in ('whatsapp', 'sms', 'call', 'messenger', 'other')),
  confirmed_at         timestamptz,
  confirmed_by         uuid references public.profiles(id) on delete set null,
  seller_id            uuid references public.profiles(id) on delete set null,
  listing_id           uuid references public.listings(id) on delete set null,
  published_at         timestamptz,
  sms_sent_at          timestamptz,
  sms_error            text check (sms_error is null or char_length(sms_error) <= 200),
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

create index if not exists prospect_leads_status_idx on public.prospect_leads (status, created_at desc);
create index if not exists prospect_leads_assignee_idx on public.prospect_leads (assigned_to, status);
create index if not exists prospect_leads_phone_idx on public.prospect_leads (phone) where phone is not null;
create index if not exists prospect_leads_listing_idx on public.prospect_leads (listing_id) where listing_id is not null;

drop trigger if exists _touch_prospect_leads on public.prospect_leads;
create trigger _touch_prospect_leads before update on public.prospect_leads
  for each row execute function public._touch_updated_at();

-- ── 2. What was done ────────────────────────────────────────────────────────
create table if not exists public.prospect_events (
  id         uuid primary key default gen_random_uuid(),
  lead_id    uuid not null references public.prospect_leads(id) on delete cascade,
  kind       text not null check (kind in (
    'created', 'contacted', 'no_answer', 'thinking', 'refused', 'wrong_number',
    'confirmed', 'published', 'sms', 'note', 'assigned', 'broker'
  )),
  channel    text check (channel is null or channel in ('whatsapp', 'sms', 'call', 'messenger', 'other')),
  note       text check (note is null or char_length(note) <= 2000),
  actor_id   uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists prospect_events_lead_idx on public.prospect_events (lead_id, created_at);
-- The day's count per member (the daily cap) and the team's figures.
create index if not exists prospect_events_actor_idx on public.prospect_events (actor_id, kind, created_at desc);

-- ── 3. « Ne pas contacter » ─────────────────────────────────────────────────
create table if not exists public.prospect_dnc (
  phone      text primary key check (phone ~ '^\+216[0-9]{8}$'),
  reason     text check (reason is null or char_length(reason) <= 300),
  added_by   uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

-- ── 4. The owner's private link ─────────────────────────────────────────────
create table if not exists public.listing_manage_tokens (
  token_hash   text primary key,
  listing_id   uuid not null references public.listings(id) on delete cascade,
  seller_id    uuid not null references public.profiles(id) on delete cascade,
  expires_at   timestamptz not null default (now() + interval '365 days'),
  last_used_at timestamptz,
  created_at   timestamptz not null default now()
);

create index if not exists listing_manage_tokens_listing_idx on public.listing_manage_tokens (listing_id);

-- ── 5. « Confirmé par l'équipe » on the annonce ─────────────────────────────
alter table public.listings add column if not exists team_confirmed_at timestamptz;
comment on column public.listings.team_confirmed_at is
  'When the Mazed team confirmed this annonce with its owner (Prospection, 0218). The public page may say so. Only the service role writes it (0195).';

-- ── 6. Closed to the browser ────────────────────────────────────────────────
alter table public.prospect_leads enable row level security;
alter table public.prospect_events enable row level security;
alter table public.prospect_dnc enable row level security;
alter table public.listing_manage_tokens enable row level security;

revoke all on table public.prospect_leads from anon, authenticated;
revoke all on table public.prospect_events from anon, authenticated;
revoke all on table public.prospect_dnc from anon, authenticated;
revoke all on table public.listing_manage_tokens from anon, authenticated;

grant select, insert, update, delete on table public.prospect_leads to service_role;
grant select, insert on table public.prospect_events to service_role;
grant select, insert, delete on table public.prospect_dnc to service_role;
grant select, insert, update, delete on table public.listing_manage_tokens to service_role;

notify pgrst, 'reload schema';
