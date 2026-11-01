# Statistiques — what the site counts, and where it shows

Two layers, both exact about what they do not record: no name, phone number,
e-mail or address, no raw IP, no browser string.

## 1. Google Analytics 4 (Réglages → Statistiques)

`src/lib/analytics/ga.ts` loads gtag.js on the public site only, after the
visitor's « Accepter » when `analytics_ask_consent` is on, never on `/admin`.
Every event below goes to Google through `track()` once it is loaded;
events sent before are queued and dropped if Google never loads.

The console reads Google's reports (Statistiques → Trafic) through the Data
API with a service account: `GA4_SERVICE_ACCOUNT_JSON` in the environment
(the key file, as is or base64) and `analytics_ga_property_id` in the
settings; `src/lib/analytics/ga4-data.ts`, cached in `analytics_cache` for
`analytics_ga_cache_minutes`.

## 2. The site's own count (`site_events`, migration 0204)

`src/lib/analytics/events.ts` → `POST /api/events` (batches of 25, sent by
`sendBeacon`) → `public.site_events`, append-only, pruned nightly after
`analytics_events_days`. Switched by `analytics_events_enabled`; waits for the
visitor's yes when `analytics_events_consent` is on. One browser may send
`analytics_events_per_hour` events an hour.

A visitor is `u:<account id>` when signed in, `c:<random id>` when they
accepted analytics (the browser keeps the id in `localStorage` as
`mazed-cid`), else `a:<hash>` of the address and the browser, salted and
changed every day.

What the server records itself (`src/lib/analytics/server-events.ts`),
counted once whatever the browser did: `sign_up`, `login`, `logout`,
`payment_submit` (the receipt route), `listing_import`.

## The events

| Event | When | Parameters (besides `listing_id` / `shop_id`) |
|---|---|---|
| `page_view` | every navigation (site only) | path |
| `search` | the catalogue shows a search | `q` / `search_term` (masked), `deal`, `cat`, `gov`, `results`, `understood` |
| `catalogue_view` | the catalogue shows with a filter or an order | `deal`, `cat`, `gov`, `sort`, `filters[]`, `results`, `page` |
| `listing_impression` | a rail or grid of annonces comes on screen | `surface`, `count`, `ids[]` (site only) |
| `listing_view` | an annonce stayed on screen 1.5 s | `deal`, `cat`, `gov` |
| `gallery_open` | the full-screen gallery opens | `index`, `of` |
| `gallery_photo` | a reader moves to a photo (once per photo) | `index`, `of`, `where` |
| `phone_reveal` | the number shows | |
| `contact_call` / `contact_whatsapp` | a tap on the number / WhatsApp | |
| `agence_view` | an agence page opens | `kind`, `gov` |
| `agence_contact` | a tap on Appeler / WhatsApp / E-mail / Site | `via` |
| `visit_request_open` / `visit_request` | the form opens / is sent | `slots` |
| `favourite_add` / `favourite_remove` | the heart | |
| `compare_add` / `compare_remove` / `compare_open` | the comparator | `count` |
| `share` | a share | `method`, `content_type`, `item_id` |
| `credit_simulator_open` / `credit_simulator_use` | the loan simulator | `field`, `value` |
| `pro_cta` | the Pro landing's buttons | `cta`, `plan` |
| `plan_choose` | a plan picked (sign-up or dashboard) | `plan`, `where` |
| `payment_start` | the checkout opens | `kind`, `amount`, `payment` |
| `payment_submit` | a receipt handed in (server) | `method`, `kind`, `again` |
| `payment_cancel` | a payment cancelled | `kind`, `payment` |
| `publish_start` | the publish form opens on a new annonce | `method` |
| `publish_step` | a step of the form is reached | `step` (category, photos, details, review), `index` |
| `publish_photos` | the photos step is left | `count` |
| `publish_listing` | the annonce is sent (form, chat, edit) | `method`, `mode`, `status` |
| `publish_abandon` | the form is left before sending | `step`, `index` |
| `voice_publish_start` / `voice_publish_finish` | the conversation publisher | `status` |
| `upload_failed` | a photo or a receipt did not upload | `kind`, `reason`, `status` |
| `demande_create` | a demande saved | `deal`, `govs`, `mode` |
| `agence_request` | an agence asked to open | `plan`, `method`, `value` |
| `listing_import` | a spreadsheet imported (server) | `count` |
| `sign_up` / `login` / `logout` | accounts (server) | `method` |
| `install_shown` / `install_click` / `install_done` | the install button | `state` |
| `consent` | the analytics bar answered | `answer` |
| `language_switch` | the language changed | `from`, `to` |
| `not_found` | a 404 page | path |
| `client_error` | a render or network error (Google only; the activity log keeps them) | `kind` |
| `whatsapp_help` | the help link | `topic` |

## Where it shows

`/admin/analytics` (section `analytics` in `admin_scopes`), six tabs over one
period (7 / 30 / 90 days or two dates, compared with the period before):
Vue d'ensemble (insights, KPIs, trends, funnel), Trafic (Google), Marché,
Demande, Pro & revenus, Comptes. The aggregations are the `analytics_*`
functions of 0204; the insight rules are `src/lib/analytics/insights.ts`;
every threshold is an `analytics_*` setting.
