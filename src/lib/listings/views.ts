/**
 * Whether an annonce's page shows how many people looked at it.
 *
 * `views` is `listings.view_count`: distinct visitors, a return counted after
 * 30 minutes, the seller never (0152). `min` is the console's
 * `listing_views_public_min`: 0 hides it everywhere, 1 shows it from the first
 * view, 50 (the default) waits until the number reads as « people look here ».
 * On a young catalogue most annonces have a handful of views, and « 3 vues »
 * would tell a buyer the opposite. The seller sees their own in « Mes
 * annonces » whatever the threshold.
 */
export function viewsShown(views: number, min: number): boolean {
  if (!Number.isFinite(min) || min <= 0) return false;
  return Number.isFinite(views) && views >= min;
}
