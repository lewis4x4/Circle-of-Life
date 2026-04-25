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

/**
 * List+detail pair prefixes. The middleware rewrites `<prefix>` AND
 * `<prefix>/<one-segment>` only — never deeper paths. This protects V1 routes
 * like `/admin/residents/[id]/care-plan` from being rewritten before their V2
 * implementations land in S10/S11.
 */
export const UI_V2_IMPLEMENTED_PREFIXES = new Set<string>([
  // S9 (W2 P0 list+detail pairs)
  "/residents", // list + /residents/[id]
  "/incidents", // list + /incidents/[id]
  "/admissions", // list + /admissions/[id]
  "/executive/alerts", // list + /executive/alerts/[id]
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

function isExactMatchOrOneDeep(adminRoute: string, prefix: string): boolean {
  if (adminRoute === prefix) return true;
  if (!adminRoute.startsWith(`${prefix}/`)) return false;
  // Allow exactly one segment beyond the prefix (the dynamic [id] segment)
  // — anything deeper means a sub-route the V2 build doesn't yet handle.
  const remainder = adminRoute.slice(prefix.length + 1);
  return remainder.length > 0 && !remainder.includes("/");
}

export function resolveUiV2AdminRewritePath(
  pathname: string,
  options: {
    enabled?: boolean;
    implementedRoutes?: ReadonlySet<string>;
    implementedPrefixes?: ReadonlySet<string>;
  } = {},
): string | null {
  const enabled = options.enabled ?? uiV2();
  if (!enabled) return null;

  const adminRoute = normalizeAdminRoute(pathname);
  if (!adminRoute) return null;

  const implementedRoutes = options.implementedRoutes ?? UI_V2_IMPLEMENTED_ROUTES;
  const implementedPrefixes = options.implementedPrefixes ?? UI_V2_IMPLEMENTED_PREFIXES;

  const exactMatch = implementedRoutes.has(adminRoute);
  const prefixMatch =
    !exactMatch &&
    Array.from(implementedPrefixes).some((prefix) =>
      isExactMatchOrOneDeep(adminRoute, prefix),
    );

  if (!exactMatch && !prefixMatch) return null;

  if (adminRoute === "/") return UI_V2_INTERNAL_ROUTE_PREFIX;
  return `${UI_V2_INTERNAL_ROUTE_PREFIX}${adminRoute}`;
}
