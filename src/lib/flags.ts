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
  // S10 (W3 analytics + W4 finance)
  "/executive/standup", // /admin/executive/standup
  "/executive/reports", // /admin/executive/reports
  "/executive/benchmarks", // /admin/executive/benchmarks
  "/finance", // /admin/finance hub
  "/finance/ledger", // /admin/finance/ledger (labor analytics proxy)
  "/finance/trial-balance", // /admin/finance/trial-balance (revenue proxy)
  // S11 (W5 settings)
  "/settings/thresholds", // /admin/settings/thresholds — facility metric thresholds CRUD
  "/settings/audit-log", // /admin/settings/audit-log — global audit log viewer
  "/settings/users", // /admin/settings/users — read-only roster
  "/settings/notifications", // /admin/settings/notifications — V2 stub
]);

/**
 * List+detail pair prefixes. The middleware rewrites `<prefix>` AND
 * `<prefix>/<one-segment>` only — never deeper paths. This protects V1 routes
 * like `/admin/residents/[id]/care-plan` from being rewritten before their V2
 * implementations land in S10/S11.
 */
export const UI_V2_IMPLEMENTED_PREFIXES = new Set<string>([
  // S9 (W2 P0 list+detail pairs)
  "/residents", // list + /residents/[id] + /residents/new
  "/incidents", // list + /incidents/[id] + /incidents/new
  "/admissions", // list + /admissions/[id] + /admissions/new
  "/executive/alerts", // list + /executive/alerts/[id]
  // S10 — facility deep-dive analytic
  "/executive/facility", // /executive/facility/[id]
]);

/**
 * UI-V2 is the canonical admin shell. The flag is retained as an explicit
 * KILL-SWITCH only: setting `NEXT_PUBLIC_UI_V2=false` reverts to V1 (V1 page
 * files still exist on disk; middleware stops rewriting). Any other value —
 * including absent — keeps V2 on. Defaults to TRUE so production renders V2
 * without requiring an env-var flip.
 */
export function uiV2(env: Record<string, string | undefined> = process.env): boolean {
  return env.NEXT_PUBLIC_UI_V2 !== "false";
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
