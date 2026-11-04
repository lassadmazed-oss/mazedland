-- ============================================================================
-- 0211 · Price offers (« Proposer un prix »)
--
-- The owner, 2026-11-04: a visitor likes an annonce but finds it too dear —
-- « let me propose a price and see ». A signed-in buyer proposes an amount
-- below the asking price; the seller (or, for a shop's annonce, its team)
-- accepts, refuses, or answers once with another price, which the buyer
-- accepts or refuses. Nothing is binding and no money moves: an accepted
-- offer shows each side the other's number, the sale happens at the notary.
--
--   pending   → accepted | declined | countered   (seller's side)
--   pending   → withdrawn                         (buyer)
--   countered → accepted | declined | withdrawn   (buyer)
--   pending | countered → expired                 (expire_price_offers, hourly)
--
-- The amount lies between the console's floor (offers_min_percent of the
-- asking price) and the asking price — checked by the API, which knows the
-- setting; the table only keeps the order of the figures. Offers are private
-- between the two sides: never shown on the annonce.
--
-- One open offer per buyer and annonce. On a shop's annonce the buyer also
-- becomes one of the shop's clients, at the « negotiation » stage
-- (leads.source 'offer', leads.offer_id).
--
-- Server only (service role). Idempotent.
-- ============================================================================

-- ── 1. price_offers ────────────────────────────────────────────────────────
create table if not exists public.price_offers (
  id              uuid primary key default gen_random_uuid(),
  listing_id      uuid not null references public.listings(id) on delete cascade,
  buyer_id        uuid not null references public.profiles(id) on delete cascade,
  seller_id       uuid not null references public.profiles(id) on delete cascade,
  shop_id         uuid references public.shops(id) on delete set null,
  -- The annonce's price when the offer was made: an edit later does not move it.
  asking_price    numeric(14, 2) not null check (asking_price > 0),
  amount          numeric(14, 2) not null check (amount > 0 and amount <= asking_price),
  -- The seller's one answer with another price, between the offer and the asking price.
  counter_amount  numeric(14, 2) check (counter_amount is null or (counter_amount > amount and counter_amount <= asking_price)),
  financing       text check (financing is null or financing in ('cash', 'loan')),
  buyer_name      text not null check (char_length(buyer_name) between 1 and 120),
  -- Null once the buyer deleted their account.
  buyer_phone     text check (buyer_phone is null or char_length(buyer_phone) between 8 and 24),
  message         text check (message is null or char_length(message) <= 600),
  seller_note     text check (seller_note is null or char_length(seller_note) <= 400),
  status          text not null default 'pending'
                    check (status in ('pending', 'countered', 'accepted', 'declined', 'withdrawn', 'expired')),
  -- When the side being waited on must have answered (offers_days, reset by a counter).
  expires_at      timestamptz not null,
  decided_by      uuid references public.profiles(id) on delete set null,
  decided_at      timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create unique index if not exists price_offers_open_once
  on public.price_offers (listing_id, buyer_id)
  where status in ('pending', 'countered');
create index if not exists price_offers_seller_idx on public.price_offers (seller_id, created_at desc);
create index if not exists price_offers_buyer_idx  on public.price_offers (buyer_id, created_at desc);
create index if not exists price_offers_shop_idx   on public.price_offers (shop_id, created_at desc) where shop_id is not null;
create index if not exists price_offers_due_idx    on public.price_offers (expires_at) where status in ('pending', 'countered');

drop trigger if exists _touch_price_offers on public.price_offers;
create trigger _touch_price_offers before update on public.price_offers
  for each row execute function public._touch_updated_at();

alter table public.price_offers enable row level security;
revoke all on table public.price_offers from anon, authenticated;

-- ── 2. A shop's client who came with an offer ──────────────────────────────
alter table public.leads add column if not exists offer_id uuid unique references public.price_offers(id) on delete set null;
alter table public.leads drop constraint if exists leads_source_check;
alter table public.leads add constraint leads_source_check
  check (source in ('visit', 'manual', 'suggestion', 'offer'));

-- ── 3. Offers nobody answered in time ──────────────────────────────────────
-- An offer still waiting on the seller tells the buyer (they may offer again);
-- a counter still waiting on the buyer tells the seller. In the site only —
-- neither is in src/lib/sms-kinds.ts. Hourly; the API also treats an offer
-- past its time as expired, so a late run changes nothing a person can do.
create or replace function public.expire_price_offers()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count int := 0;
  r record;
begin
  for r in
    select o.id, o.status, o.buyer_id, o.seller_id, o.listing_id, o.amount, o.counter_amount, l.title
      from public.price_offers o
      join public.listings l on l.id = o.listing_id
     where o.status in ('pending', 'countered')
       and o.expires_at <= now()
       for update of o skip locked
  loop
    update public.price_offers set status = 'expired' where id = r.id;
    if r.status = 'pending' then
      insert into public.notifications (user_id, kind, title, body, link, payload)
      values (
        r.buyer_id, 'offer_expired', 'Offre expirée',
        format('Le vendeur n''a pas répondu à temps à votre offre sur « %s ».', r.title),
        format('/account/offres?tab=sent&o=%s', r.id),
        jsonb_build_object('vars', jsonb_build_object('title', r.title, 'amount', r.amount, 'variant', 'pending'))
      );
    else
      insert into public.notifications (user_id, kind, title, body, link, payload)
      values (
        r.seller_id, 'offer_expired', 'Contre-proposition expirée',
        format('L''acheteur n''a pas répondu à temps à votre prix pour « %s ».', r.title),
        format('/account/offres?o=%s', r.id),
        jsonb_build_object('vars', jsonb_build_object('title', r.title, 'amount', r.counter_amount, 'variant', 'countered'))
      );
    end if;
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

revoke execute on function public.expire_price_offers() from public, anon, authenticated;
grant execute on function public.expire_price_offers() to service_role;

do $$
begin
  if exists (select 1 from cron.job where jobname = 'mazed-expire-offers') then
    perform cron.unschedule('mazed-expire-offers');
  end if;
  perform cron.schedule('mazed-expire-offers', '13 * * * *', 'select public.expire_price_offers();');
end $$;

notify pgrst, 'reload schema';
