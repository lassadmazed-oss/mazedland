-- ============================================================================
-- 0208 · Guides: articles written in the console, read on /guides.
--
-- The owner asked (2026-11-01) for articles and practical information —
-- how to buy step by step, which papers to check, what a notary costs, how
-- a rent contract works — written from the console and published on the
-- site in French and Arabic, for readers and for search engines.
--
--   articles   one row per guide, both languages side by side. A guide may
--              exist in one language only: the page shows the other with a
--              note. The body is Markdown, rendered by the site's own small
--              renderer (src/lib/guides/markdown.ts): no HTML is ever stored
--              as HTML, so nothing an editor pastes can run in a reader's
--              browser. `source_key` names the starter guide a row came from
--              (docs/guides/), so « Importer les guides de départ » never
--              inserts the same one twice.
--
-- Covers live in the public `properties` bucket under `articles/`, uploaded
-- by the console through a signed URL like the ads' banners (0177); the
-- nightly sweep of unreferenced uploads (0197) reads `cover_path` so a cover
-- a guide names is never removed.
--
-- The client roles read published rows only; every write goes through the
-- service role from /api/admin/content, after requireAdmin("content"), and
-- leaves an admin_audit entry. Idempotent.
--
-- Rollback: supabase/rollbacks/0208_articles.down.sql
-- ============================================================================

create table if not exists public.articles (
  id                 uuid primary key default gen_random_uuid(),
  -- The address under /guides/: lower-case words joined by dashes, made
  -- from the French title and fixed once the guide exists.
  slug               text not null unique
                       check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and char_length(slug) between 3 and 80),
  status             text not null default 'draft' check (status in ('draft', 'published')),
  -- The first publication; kept through an unpublish, so a guide put back
  -- online keeps its date.
  published_at       timestamptz,
  cover_path         text check (cover_path is null or char_length(cover_path) <= 300),
  title_fr           text check (title_fr is null or char_length(title_fr) <= 160),
  title_ar           text check (title_ar is null or char_length(title_ar) <= 160),
  excerpt_fr         text check (excerpt_fr is null or char_length(excerpt_fr) <= 400),
  excerpt_ar         text check (excerpt_ar is null or char_length(excerpt_ar) <= 400),
  -- Markdown (src/lib/guides/markdown.ts).
  body_fr            text check (body_fr is null or char_length(body_fr) <= 60000),
  body_ar            text check (body_ar is null or char_length(body_ar) <= 60000),
  -- From the list in src/lib/guides/articles.ts (ARTICLE_TAGS): what the
  -- guide is about, and which annonces it is shown beside.
  tags               text[] not null default '{}'::text[] check (cardinality(tags) <= 8),
  seo_title_fr       text check (seo_title_fr is null or char_length(seo_title_fr) <= 120),
  seo_title_ar       text check (seo_title_ar is null or char_length(seo_title_ar) <= 120),
  seo_description_fr text check (seo_description_fr is null or char_length(seo_description_fr) <= 300),
  seo_description_ar text check (seo_description_ar is null or char_length(seo_description_ar) <= 300),
  author_id          uuid references public.profiles(id) on delete set null,
  source_key         text unique check (source_key is null or char_length(source_key) <= 80),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  -- Online only with a title and a body in at least one language.
  constraint articles_published_complete check (
    status <> 'published'
    or (title_fr is not null and body_fr is not null)
    or (title_ar is not null and body_ar is not null)
  )
);

comment on table public.articles is
  'Guides (0208): articles written in the console, published on /guides in fr and ar. Markdown bodies; published rows are public.';

create index if not exists articles_published_idx on public.articles (status, published_at desc);
create index if not exists articles_tags_idx on public.articles using gin (tags);

drop trigger if exists _touch_articles on public.articles;
create or replace function public._touch_articles() returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;
create trigger _touch_articles before update on public.articles
  for each row execute function public._touch_articles();

-- ─── Who reads, who writes ──────────────────────────────────────────────────
alter table public.articles enable row level security;
revoke all on table public.articles from anon, authenticated;
grant select on table public.articles to anon, authenticated;
grant all on table public.articles to service_role;

drop policy if exists articles_public_read on public.articles;
create policy articles_public_read on public.articles
  for select to anon, authenticated
  using (status = 'published');
-- No insert, update or delete policy: the client roles cannot write, the
-- service role (the console's routes) bypasses RLS.

notify pgrst, 'reload schema';
