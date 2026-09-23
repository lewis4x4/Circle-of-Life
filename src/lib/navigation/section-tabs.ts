/**
 * Which tab of a section strip (Billing, Vendors, Reports…) owns `pathname`
 * (COL-655). The longest tab whose route is the path or an ancestor of it on
 * whole segments wins, so `/admin/billing/invoices/abc` lights "Invoices"
 * and `/admin/billing/invoices/opening-balance` lights "Opening balance" —
 * never both, and never nothing on a record page inside a tab's tree. The
 * section root — the first href, e.g. "Overview" at `/admin/billing` —
 * matches only itself, so a page that is not a tab (billing settings) lights
 * no tab rather than a wrong "Overview". V2 URLs are matched as their
 * canonical `/admin` path.
 */
export function activeSectionTabHref(pathname: string | null | undefined, hrefs: readonly string[]): string | null {
  const path = (pathname ?? "").replace(/^\/admin\/v2(?=\/|$)/, "/admin").replace(/\/+$/, "") || "/";
  let best: string | null = null;
  for (const [index, href] of hrefs.entries()) {
    const within = path === href || (index > 0 && path.startsWith(`${href}/`));
    if (within && (best === null || href.length > best.length)) best = href;
  }
  return best;
}
