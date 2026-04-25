export const UI_V2_ADMIN_ROUTE_PREFIX = "/admin";
export const UI_V2_INTERNAL_ROUTE_PREFIX = "/admin/v2";

/**
 * Routes that have a V2 implementation under `src/app/(admin)/admin/v2/<seg>/`.
 * Middleware (`src/proxy.ts`) consults this set after the flag check; only
 * routes listed here are rewritten to their `/admin/v2/...` counterpart when
 * `NEXT_PUBLIC_UI_V2=true`. Adding a route here without shipping the page file
 * causes a 404 on the rewrite path.
 *
 * Each entry uses the post-`/admin` segment ("/" for `/admin`).
 */
export const UI_V2_IMPLEMENTED_ROUTES = new Set<string>([
  // S8 (W1 P0 dashboards)
  "/", // /admin
  "/executive", // /admin/executive
  "/quality", // /admin/quality
  "/rounding", // /admin/rounding
]);

export function uiV2(env: Record<string, string | undefined> = process.env): boolean {
  return env.NEXT_PUBLIC_UI_V2 === "true";
}

export function normalizeAdminRoute(pathname: string): string | null {
  if (pathname === UI_V2_ADMIN_ROUTE_PREFIX) return "/";
  if (!pathname.startsWith(`${UI_V2_ADMIN_ROUTE_PREFIX}/`)) return null;
  if (pathname === UI_V2_INTERNAL_ROUTE_PREFIX || pathname.startsWith(`${UI_V2_INTERNAL_ROUTE_PREFIX}/`)) {
    return null;
  }
  return pathname.slice(UI_V2_ADMIN_ROUTE_PREFIX.length) || "/";
}

export function resolveUiV2AdminRewritePath(
  pathname: string,
  options: {
    enabled?: boolean;
    implementedRoutes?: ReadonlySet<string>;
  } = {},
): string | null {
  const enabled = options.enabled ?? uiV2();
  if (!enabled) return null;

  const adminRoute = normalizeAdminRoute(pathname);
  if (!adminRoute) return null;

  const implementedRoutes = options.implementedRoutes ?? UI_V2_IMPLEMENTED_ROUTES;
  if (!implementedRoutes.has(adminRoute)) return null;

  if (adminRoute === "/") return UI_V2_INTERNAL_ROUTE_PREFIX;
  return `${UI_V2_INTERNAL_ROUTE_PREFIX}${adminRoute}`;
}
