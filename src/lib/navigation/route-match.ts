/**
 * True when `pathname` is `route` or a page inside it, matched on whole path
 * segments (COL-655): `/caregiver/me` owns `/caregiver/me/profile` but not
 * `/caregiver/meds`. A `#fragment` on `route` is ignored.
 */
export function routeIsWithin(pathname: string, route: string): boolean {
  const base = route.split("#")[0];
  return pathname === base || pathname.startsWith(`${base}/`);
}
