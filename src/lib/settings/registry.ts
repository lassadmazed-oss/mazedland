/**
 * Every setting an admin changes in /admin/settings, in one list.
 *
 * Adding a setting is one entry here plus its label and hint under
 * `settingsRegistry.<key>` in both message files. The console lists it, the
 * API checks it against this definition, and `getSettings()` hands it to the
 * code that applies it with this default when nothing is stored. Keys that
 * existed before this list (payee, company, free places, banned words, AI,
 * social) keep their names, so what was saved stays saved.
 *
 * `client: true` sends the value to every page (feature switches the browser
 * applies, limits a form enforces before sending). Never on a secret.
 */
import type { SettingDef, ValueOf } from "./define";
import { GA_ID_PATTERN } from "@/lib/analytics/ga";

export const SETTINGS = {
  // ── Features: each one switched off disappears from the site and its API
  //    refuses, without touching what already exists (a visit already asked
  //    stays in « Mes visites », a placement already bought runs its course).
  feature_visits: { group: "features", type: "bool", default: true, client: true },
  feature_compare: { group: "features", type: "bool", default: true, client: true },
  feature_requests: { group: "features", type: "bool", default: true, client: true, href: "/admin/demandes" },
  feature_pro_signup: { group: "features", type: "bool", default: true, client: true, href: "/admin/agences" },
  // Opening an agence asks for its plan and the plan's receipt in the same
  // form, sent as one request the console decides whole (the owner,
  // 2026-10-31). Off: the agence alone, its plan chosen and paid after.
  feature_pro_signup_plan: { group: "features", type: "bool", default: true, href: "/admin/agences" },
  feature_promos: { group: "features", type: "bool", default: true, client: true, href: "/admin/offres" },
  social_enabled: { group: "features", type: "bool", default: true, href: "/admin/social" },
  ai_enabled: { group: "features", type: "bool", default: true },
  // « Décrivez votre bien en une phrase » at the top of the form: the assistant
  // fills the steps from one sentence. Off until the owner turns it on
  // (asked 2026-10-31).
  feature_publish_ai_fill: { group: "features", type: "bool", default: false, client: true },
  // The microphone of « Publier en parlant », in the page's language.
  feature_ai_voice: { group: "features", type: "bool", default: true, client: true },
  // « Publier en parlant » (version B): an annonce made in a conversation, voice
  // first. Off until the owner turns it on (asked 2026-10-31).
  feature_publish_chat: { group: "features", type: "bool", default: false, client: true },
  // « Vendre » opens version B instead of the form (the form stays one tap away).
  publish_chat_default: { group: "features", type: "bool", default: false },
  feature_listing_edit: { group: "features", type: "bool", default: true, client: true, href: "/admin/annonces?status=edits" },
  feature_reports: { group: "features", type: "bool", default: true, client: true },
  feature_price_help: { group: "features", type: "bool", default: true, client: true },
  feature_watermark: { group: "features", type: "bool", default: true, client: true },
  feature_natural_search: { group: "features", type: "bool", default: true },
  // A microphone in the search boxes (P5): spoken words fill the box, then search.
  feature_voice_search: { group: "features", type: "bool", default: true, client: true },
  // « Installer l'app » in the public header (the console always has its own).
  feature_install_button: { group: "features", type: "bool", default: true, client: true },
  // « Partager » on every annonce: the phone's share sheet, else WhatsApp, Facebook, copy.
  feature_share: { group: "features", type: "bool", default: true, client: true },
  feature_arabic_redirect: { group: "features", type: "bool", default: true, client: true },
  feature_whatsapp: { group: "features", type: "bool", default: true, client: true },
  // Advertising spaces sold to companies (0177), managed in /admin/publicites.
  feature_ads: { group: "features", type: "bool", default: true, href: "/admin/publicites" },
  // Promoters' projects and their units (0179): the « Projets » tab and pages.
  feature_projects: { group: "features", type: "bool", default: true, client: true, href: "/admin/agences" },
  // What a period brought to an agence's annonces (0183): the « Rapports » tab.
  feature_pro_reports: { group: "features", type: "bool", default: true },
  // « Agences recommandées » above the catalogue's annonces: the open agences whose
  // running plan is big enough (agency_strip_min_quota), in an order that turns
  // each day (src/lib/pro/featured.ts).
  feature_agency_strip: { group: "features", type: "bool", default: true, href: "/admin/agences" },
  // « Agence réactive »: the badge an agence earns by answering its visit
  // requests fast (src/lib/pro/reactivity.ts). Off: no badge anywhere.
  feature_agency_reactive: { group: "features", type: "bool", default: true, href: "/admin/agences" },
  // « Agences fondatrices : X places sur 10 » on the Pro page: the places the
  // console has not yet given a free period to (src/lib/pro/founding.ts).
  feature_founding_counter: { group: "features", type: "bool", default: true, href: "/admin/agences" },
  // « Ouvrir » on an agence with no plan gives it the founding offer by itself while places last;
  // off: such an agence must pay (or be given its period by hand) before it opens.
  feature_founding_auto: { group: "features", type: "bool", default: true, href: "/admin/agences" },
  // « Importer plusieurs annonces » in the agence's dashboard: a CSV (or lines
  // pasted from Excel) becomes drafts (src/lib/listings/importRows.ts).
  feature_listing_import: { group: "features", type: "bool", default: true },
  // « Simulez votre crédit » on an annonce for sale (src/lib/credit.ts).
  feature_credit_simulator: { group: "features", type: "bool", default: true },
  // The admins hear of a crash in production the first time it happens (0185).
  feature_error_alerts: { group: "features", type: "bool", default: true, href: "/admin/activity?type=error" },
  // « Guides » (0208): the articles written in /admin/contenu and read on
  // /guides. Off: the pages answer not found, the footer link and the
  // « Guides utiles » strips go; what is written stays in the console.
  guides_enabled: { group: "features", type: "bool", default: true, href: "/admin/contenu" },
  // « Aide à la rédaction » in the guide editor: the AI drafts a section the
  // editor reads and changes. Nothing it writes is published by itself.
  guides_ai_assist: { group: "features", type: "bool", default: true, href: "/admin/contenu" },

  // ── Home page: the rails of annonces and the ads move by themselves.
  home_rail_autoplay: { group: "home", type: "bool", default: true, client: true },
  home_rail_seconds: { group: "home", type: "int", default: 5, min: 3, max: 15, unit: "seconds", client: true },
  // How many annonces a rail holds — the limit of its query — and which rails
  // there are. A rail switched off is neither queried nor shown; one with
  // fewer than three annonces hides itself either way (src/lib/home/rails.ts).
  home_rail_size: { group: "home", type: "int", default: 12, min: 4, max: 24 },
  home_rail_featured: { group: "home", type: "bool", default: true, href: "/admin/home" },
  home_rail_most_viewed: { group: "home", type: "bool", default: true },
  home_rail_new: { group: "home", type: "bool", default: true },
  home_rail_rent: { group: "home", type: "bool", default: true },
  home_rail_deals: { group: "home", type: "bool", default: true },
  home_rail_appartements: { group: "home", type: "bool", default: true },
  home_rail_villas: { group: "home", type: "bool", default: true },
  home_rail_maisons: { group: "home", type: "bool", default: true },
  home_rail_terrain: { group: "home", type: "bool", default: true },
  home_rail_explore: { group: "home", type: "bool", default: true },
  ads_rotate_seconds: { group: "home", type: "int", default: 6, min: 3, max: 30, unit: "seconds", client: true },
  // Off: the banners always turn (asked 2026-11-01). On: they hold still under
  // the pointer, the keyboard, or a device asking for reduced motion.
  ads_rotate_pause: { group: "home", type: "bool", default: false, client: true },

  // ── Moderation: how much of the site runs by itself.
  free_listing_limit: { group: "moderation", type: "int", default: 2, min: 0, max: 50 },
  moderation_auto_publish: { group: "moderation", type: "bool", default: true },
  moderation_min_photos: { group: "moderation", type: "int", default: 3, min: 0, max: 12, unit: "photos", client: true },
  moderation_report_threshold: { group: "moderation", type: "int", default: 3, min: 1, max: 50 },
  moderation_banned_words: { group: "moderation", type: "list", default: [], maxItems: 200, maxLen: 40, lower: true },

  // ── Publication.
  listing_default_days: { group: "publication", type: "int", default: 30, min: 1, max: 365, unit: "days" },
  listing_max_photos: { group: "publication", type: "int", default: 12, min: 1, max: 30, unit: "photos", client: true },
  catalogue_page_size: { group: "publication", type: "int", default: 24, min: 12, max: 60 },
  // How many annonces side by side on a phone's catalogue: one, with big
  // photos (Idealista, Rightmove), or two, denser (Tayara). Tablets and up
  // always lay out three or four.
  catalogue_phone_columns: { group: "publication", type: "int", default: 1, min: 1, max: 2, choices: [1, 2] },
  // A project goes public only while its agence has a running plan.
  projects_need_plan: { group: "publication", type: "bool", default: true },
  projects_max_units: { group: "publication", type: "int", default: 300, min: 10, max: 2000 },
  // The same agence plan can be renewed only this many days before it ends (planChange.ts).
  plan_renew_days: { group: "publication", type: "int", default: 5, min: 1, max: 30, unit: "days", choices: [3, 5, 7, 15] },
  // The most lines one imported file may hold.
  import_max_rows: { group: "publication", type: "int", default: 60, min: 5, max: 300, choices: [30, 60, 120, 300] },
  // « Offrir une période » in the agences console: how long the offered plan runs (src/lib/pro/offer.ts).
  founding_offer_months: { group: "publication", type: "int", default: 3, min: 1, max: 12, unit: "months", choices: [1, 2, 3, 6, 12] },
  // How many agences the founding offer is for, and where (« les 10 premières
  // agences de Sfax »); an empty place says « les 10 premières agences ».
  founding_seats: { group: "publication", type: "int", default: 50, min: 1, max: 200, choices: [10, 20, 50, 100] },
  founding_offer_place: { group: "publication", type: "text", default: "", max: 40 },
  // The plan the offer gives (the slug of an offer on sale). With feature_founding_auto, « Ouvrir »
  // gives it by itself to an agence that has no plan, while places last (src/lib/pro/founding.ts).
  founding_offer_plan: { group: "publication", type: "text", default: "pro-pro", max: 40, ltr: true },
  // « Envoyer sans payer » under the agence request: the agence comes alone,
  // for the founding offer the console then gives (« Offrir une période »).
  pro_signup_pay_later: { group: "publication", type: "bool", default: true },
  // The guides (0208): how many cards a page of /guides holds, how many
  // « Guides liés » close a guide, how many « Guides utiles » stand beside an
  // annonce and under the catalogue (0 = no strip), and from how many
  // headings a guide gets a table of contents (0 = never).
  guides_per_page: { group: "publication", type: "int", default: 9, min: 3, max: 30, choices: [6, 9, 12, 18, 24] },
  guides_related_count: { group: "publication", type: "int", default: 3, min: 0, max: 6, choices: [0, 2, 3, 4, 6] },
  guides_strip_count: { group: "publication", type: "int", default: 3, min: 0, max: 6, choices: [0, 2, 3, 4] },
  guides_toc_min: { group: "publication", type: "int", default: 3, min: 0, max: 10, choices: [0, 2, 3, 4, 5] },

  // ── Buyers: visits, compare, demandes.
  visits_max_slots: { group: "buyers", type: "int", default: 3, min: 1, max: 5, client: true },
  visits_horizon_days: { group: "buyers", type: "int", default: 30, min: 3, max: 90, unit: "days", client: true },
  compare_max: { group: "buyers", type: "int", default: 3, min: 2, max: 4, client: true },
  requests_max_active: { group: "buyers", type: "int", default: 10, min: 1, max: 50 },
  requests_days: { group: "buyers", type: "int", default: 60, min: 7, max: 365, unit: "days" },
  // The strip's size, and the smallest plan that earns a place in it: the plan's
  // annonces (10 Starter and up, 40 Pro and up, 120 Business only).
  agency_strip_max: { group: "buyers", type: "int", default: 6, min: 2, max: 12, choices: [4, 6, 8, 12] },
  // The badge's rule: at least `min_rate` percent of the visit requests judged over
  // the last `days` days answered within `hours` hours, and at least
  // `min_requests` of them. The strip puts the reactive agences first.
  reactive_hours: { group: "buyers", type: "int", default: 24, min: 1, max: 168, unit: "hours", choices: [2, 6, 12, 24, 48] },
  reactive_min_rate: { group: "buyers", type: "int", default: 80, min: 50, max: 100, unit: "percent", choices: [60, 70, 80, 90] },
  reactive_min_requests: { group: "buyers", type: "int", default: 3, min: 1, max: 50, choices: [2, 3, 5, 10] },
  reactive_days: { group: "buyers", type: "int", default: 90, min: 7, max: 365, unit: "days", choices: [30, 60, 90, 180] },
  agency_strip_reactive_first: { group: "buyers", type: "bool", default: true },
  // What the credit simulator opens on. The rate is indicative: the bank sets the real one.
  credit_rate_percent: { group: "buyers", type: "number", default: 10, min: 1, max: 30, step: 0.5, unit: "percent" },
  credit_years: { group: "buyers", type: "int", default: 20, min: 5, max: 30, unit: "years", choices: [10, 15, 20, 25] },
  credit_down_percent: { group: "buyers", type: "int", default: 20, min: 0, max: 90, unit: "percent", choices: [10, 20, 30, 40, 50] },
  // Below this price a loan is not what the buyer is asking about: no simulator.
  credit_min_price: { group: "buyers", type: "int", default: 30000, min: 0, max: 5000000, unit: "tnd" },
  agency_strip_min_quota: { group: "buyers", type: "int", default: 40, min: 1, max: 1000, choices: [10, 40, 120] },

  // ── How people reach Mazed Immo.
  contact_whatsapp: { group: "contact", type: "text", default: "+216 58 415 510", max: 30, ltr: true, client: true },
  contact_email: { group: "contact", type: "text", default: "contact@mazed.immo", max: 120, ltr: true },
  contact_phone: { group: "contact", type: "text", default: "", max: 30, ltr: true },

  // ── Social Publisher (0170) and the listing assistant (0169).
  social_price_tnd: { group: "social", type: "number", default: 0, min: 0, max: 1000, unit: "tnd" },
  social_auto_approve: { group: "social", type: "bool", default: false },
  social_daily_limit: { group: "social", type: "int", default: 10, min: 1, max: 100, unit: "per_day" },
  ai_daily_budget_usd: { group: "social", type: "number", default: 2, min: 0, max: 100, step: 0.5 },
  // One account's share of it: at about 4 cents a call, half a dollar is a dozen conversations.
  ai_user_daily_budget_usd: { group: "social", type: "number", default: 0.5, min: 0, max: 100, step: 0.1 },

  // ── Where sellers pay (manual transfer / D17). Secret: the checkout reads
  //    them on the server, for a payer with an open payment only.
  payee_name: { group: "payment", type: "text", default: "", max: 200, secret: true },
  payee_bank: { group: "payment", type: "text", default: "", max: 200, secret: true },
  payee_rib: { group: "payment", type: "text", default: "", max: 40, ltr: true, secret: true },
  payee_iban: { group: "payment", type: "text", default: "", max: 40, ltr: true, secret: true },
  payee_d17: { group: "payment", type: "text", default: "", max: 40, ltr: true, secret: true },

  // ── On every invoice (0175): copied into each one when it is issued.
  company_name: { group: "company", type: "text", default: "", max: 200 },
  company_tax_id: { group: "company", type: "text", default: "", max: 40, ltr: true },
  company_address: { group: "company", type: "text", default: "", max: 200, multiline: true },
  invoice_vat_rate: { group: "company", type: "number", default: null, min: 0, max: 50, unit: "percent", optional: true },

  // ── Abuse limits: how often one person may do a thing.
  limit_visits_per_day: { group: "limits", type: "int", default: 10, min: 1, max: 200, unit: "per_day" },
  limit_drafts_per_account: { group: "limits", type: "int", default: 30, min: 1, max: 500 },
  limit_reports_per_hour: { group: "limits", type: "int", default: 10, min: 1, max: 200, unit: "per_hour" },
  limit_edits_per_hour: { group: "limits", type: "int", default: 20, min: 1, max: 200, unit: "per_hour" },
  limit_phone_reveals_per_hour: { group: "limits", type: "int", default: 40, min: 1, max: 1000, unit: "per_hour" },
  limit_suggestions_per_day: { group: "limits", type: "int", default: 30, min: 1, max: 500, unit: "per_day" },
  limit_shop_create_per_hour: { group: "limits", type: "int", default: 5, min: 1, max: 50, unit: "per_hour" },
  // Adding to an agence's team says whether a phone number has an account (the members route).
  limit_member_adds_per_hour: { group: "limits", type: "int", default: 20, min: 1, max: 200, unit: "per_hour" },
  sms_daily_cap: { group: "limits", type: "int", default: 6, min: 0, max: 50, unit: "per_day" },
  // One alert per error per this many hours (0185 reads it with the same default).
  error_alert_hours: { group: "limits", type: "int", default: 6, min: 1, max: 24, unit: "hours", choices: [1, 6, 24] },

  // ── Personal data (0182): the version of the CGU and privacy policy people
  //    accept, and how long the nightly jobs keep each trace. The SQL jobs
  //    read these keys with the same defaults; 0 keeps that trace. Payments,
  //    invoices and the admin audit trail are never deleted by them.
  legal_version: { group: "privacy", type: "text", default: "2026-10", max: 40, ltr: true },
  privacy_anonymize_days: { group: "privacy", type: "int", default: 30, min: 1, max: 90, unit: "days", choices: [7, 14, 30, 60, 90] },
  privacy_page_views_days: { group: "privacy", type: "int", default: 90, min: 0, max: 730, unit: "days", choices: [30, 60, 90, 180, 365, 0] },
  privacy_activity_days: { group: "privacy", type: "int", default: 365, min: 0, max: 730, unit: "days", choices: [90, 180, 365, 730, 0] },
  privacy_notifications_days: { group: "privacy", type: "int", default: 30, min: 0, max: 365, unit: "days", choices: [7, 14, 30, 60, 90, 180, 0] },
  privacy_traces_days: { group: "privacy", type: "int", default: 365, min: 0, max: 730, unit: "days", choices: [90, 180, 365, 730, 0] },
  // The scheduled jobs' run log (0188): technical, no personal data, and it
  // grew to half the database. Always pruned — no 0 here.
  cron_history_days: { group: "privacy", type: "int", default: 7, min: 1, max: 90, unit: "days", choices: [3, 7, 14, 30, 90] },
  // Uploads no row names (0197): the photos of a wizard never sent, the
  // receipts of a payment never made. Swept nightly once older than this; the
  // delay keeps an upload still in flight out of the sweep.
  uploads_prune_days: { group: "privacy", type: "int", default: 2, min: 1, max: 30, unit: "days", choices: [1, 2, 3, 7, 14, 30] },

  // ── Google Analytics 4 (src/components/analytics/GoogleAnalytics.tsx), on
  //    top of the site's own page-view log. Nothing from Google loads while
  //    the switch is off or the ID empty, nor on the console.
  analytics_ga_enabled: { group: "analytics", type: "bool", default: true, client: true },
  // The property's measurement ID, as GA4 shows it: « G-XXXXXXXXXX ».
  analytics_ga_id: { group: "analytics", type: "text", default: "", max: 20, ltr: true, upper: true, pattern: GA_ID_PATTERN, client: true },
  // On: Google loads only once the visitor said yes to the bar (and never
  // after a no). Off: it loads for everyone, with advertising signals denied.
  analytics_ask_consent: { group: "analytics", type: "bool", default: true, client: true },

  // ── The site's own count (0204 site_events, src/lib/analytics/events.ts):
  //    every search, annonce opened, number shown, step of the publish form…
  //    kept in the database, exact and per annonce, beside Google's sampled
  //    and consent-gated figures. No name, number, e-mail or address.
  analytics_events_enabled: { group: "analytics", type: "bool", default: true, client: true },
  // On: the site's own count waits for the visitor's yes too (when asked):
  // nothing leaves the browser before « Accepter ». Off: it counts everyone,
  // pseudonymously, with a key that changes every day and no cookie.
  analytics_events_consent: { group: "analytics", type: "bool", default: true, client: true },
  // How long an event is kept before the nightly job deletes it.
  analytics_events_days: { group: "analytics", type: "int", default: 365, min: 30, max: 730, unit: "days", choices: [90, 180, 365, 730] },
  // What one browser may send in an hour: a reader opens a few dozen annonces in an evening.
  analytics_events_per_hour: { group: "analytics", type: "int", default: 600, min: 100, max: 5000, unit: "per_hour", choices: [200, 600, 1200, 3000] },
  // The GA4 property the console reads reports from (Administration → Paramètres
  // de la propriété → « ID de la propriété », a number). The service account's
  // key is the GA4_SERVICE_ACCOUNT_JSON environment variable, never a setting.
  analytics_ga_property_id: { group: "analytics", type: "text", default: "", max: 20, ltr: true, pattern: /^[0-9]{5,15}$/ },
  // A report fetched from Google is reused for this long before it is asked again.
  analytics_ga_cache_minutes: { group: "analytics", type: "int", default: 60, min: 5, max: 1440, unit: "minutes", choices: [15, 30, 60, 180, 360, 1440] },
  // ── The page's rules (/admin/analytics).
  // How many rows each ranking shows (annonces, agences, searches, governorates).
  analytics_top_limit: { group: "analytics", type: "int", default: 10, min: 5, max: 100, choices: [5, 10, 20, 50] },
  // An annonce « expiring soon » ends within this many days.
  analytics_expiring_days: { group: "analytics", type: "int", default: 7, min: 1, max: 60, unit: "days", choices: [3, 7, 14, 30] },
  // Insights: how many sentences « À retenir » shows at most.
  analytics_insights_limit: { group: "analytics", type: "int", default: 8, min: 3, max: 20, choices: [5, 8, 12] },
  // Insights: the weeks before the latest one a figure is compared with.
  analytics_baseline_weeks: { group: "analytics", type: "int", default: 8, min: 4, max: 26, choices: [4, 8, 12] },
  // Insights: a figure this many standard deviations from its baseline average is an anomaly.
  analytics_anomaly_sigma: { group: "analytics", type: "number", default: 2, min: 1, max: 4, step: 0.5, choices: [1.5, 2, 2.5, 3] },
  // Insights: a figure that moved by at least this much week over week is a mover…
  analytics_mover_min_percent: { group: "analytics", type: "int", default: 20, min: 5, max: 100, unit: "percent", choices: [10, 20, 30, 50] },
  // …as long as one of the two weeks reached this many (two to three is no news).
  analytics_mover_min_count: { group: "analytics", type: "int", default: 5, min: 1, max: 1000, choices: [5, 10, 20] },
  // Insights: a search with no result repeated this many times deserves a look.
  analytics_zero_search_min: { group: "analytics", type: "int", default: 3, min: 1, max: 100, choices: [2, 3, 5, 10] },
  // Insights: an annonce seen this many times without one contact is flagged.
  analytics_no_contact_min_views: { group: "analytics", type: "int", default: 30, min: 5, max: 1000, choices: [10, 20, 30, 50, 100] },
  // Insights: a governorate searched at least this often…
  analytics_gov_demand_min: { group: "analytics", type: "int", default: 20, min: 5, max: 1000, choices: [10, 20, 50, 100] },
  // …with fewer annonces online than this lacks supply.
  analytics_gov_low_supply: { group: "analytics", type: "int", default: 5, min: 1, max: 100, choices: [3, 5, 10, 20] },

  // ── Paid services (0203, /admin/abonnements): an SMS before Vercel,
  //    Supabase, a domain or a credit runs out. The watchdog in the database
  //    (services_watchdog) reads the same keys with the same defaults.
  services_alerts_enabled: { group: "services", type: "bool", default: true, href: "/admin/abonnements" },
  // Who gets them: the owner's number by default (« lassad », 2026-11-01).
  services_sms_recipients: { group: "services", type: "list", default: ["+216 98 124 111"], maxItems: 5, maxLen: 20 },
  // The first SMS, this many days before the end; each service may say otherwise.
  services_lead_days: { group: "services", type: "int", default: 4, min: 1, max: 30, unit: "days", choices: [1, 3, 4, 7, 14] },
  services_alert_day_before: { group: "services", type: "bool", default: true },
  services_alert_on_day: { group: "services", type: "bool", default: true },
  // No reminder between these hours (Tunis time); it goes when they end.
  services_quiet_start: { group: "services", type: "int", default: 22, min: 0, max: 23, unit: "hour_of_day", choices: [20, 21, 22, 23] },
  services_quiet_end: { group: "services", type: "int", default: 8, min: 0, max: 23, unit: "hour_of_day", choices: [6, 7, 8, 9, 10] },
  // A blocked or unreachable site is sent even at night.
  services_urgent_at_night: { group: "services", type: "bool", default: true },
  services_sms_arabic: { group: "services", type: "bool", default: true },
  // Below this many SMS left on WinSMS, one SMS says to top up. 0 = never.
  services_sms_low_balance: { group: "services", type: "int", default: 200, min: 0, max: 5000, unit: "sms", choices: [100, 200, 500, 1000, 0] },
} as const satisfies Record<string, SettingDef>;

export type SettingKey = keyof typeof SETTINGS;
export type Settings = { [K in SettingKey]: ValueOf<(typeof SETTINGS)[K]> };
export type ClientSettingKey = {
  [K in SettingKey]: (typeof SETTINGS)[K] extends { client: true } ? K : never;
}[SettingKey];
export type ClientSettings = Pick<Settings, ClientSettingKey>;

/** The console's tabs, in order. */
export const SETTING_GROUPS = [
  "features", "home", "moderation", "publication", "buyers", "contact", "social", "payment", "company", "limits", "privacy", "analytics", "services",
] as const;

export function isSettingKey(k: string): k is SettingKey {
  return Object.prototype.hasOwnProperty.call(SETTINGS, k);
}
