/**
 * Canonical destinations whose legacy public paths are permanently redirected
 * by next.config.ts. Keeping the route and backing page together makes an
 * alias regression visible before the redirect reaches a missing destination.
 */
export const CANONICAL_ADMIN_ROUTE_REPAIRS = [
  {
    legacyPathname: "/finance/forecast",
    canonicalPathname: "/admin/finance/forecast",
    pageModulePath: "src/app/(admin)/finance/forecast/page.tsx",
  },
  {
    legacyPathname: "/finance/close",
    canonicalPathname: "/admin/finance/close",
    pageModulePath: "src/app/(admin)/finance/close/page.tsx",
  },
  {
    legacyPathname: "/finance/trust",
    canonicalPathname: "/admin/finance/trust",
    pageModulePath: "src/app/(admin)/finance/trust/page.tsx",
  },
  {
    legacyPathname: "/reports/history/:id",
    canonicalPathname: "/admin/reports/history/:id",
    pageModulePath: "src/app/(admin)/reports/history/[id]/page.tsx",
  },
  {
    legacyPathname: "/training/inservice/new",
    canonicalPathname: "/admin/training/inservice/new",
    pageModulePath: "src/app/(admin)/training/inservice/new/page.tsx",
  },
  {
    legacyPathname: "/transportation/requests/new",
    canonicalPathname: "/admin/transportation/requests/new",
    pageModulePath: "src/app/(admin)/transportation/requests/new/page.tsx",
  },
  {
    legacyPathname: "/transportation/requests/:id",
    canonicalPathname: "/admin/transportation/requests/:id",
    pageModulePath: "src/app/(admin)/transportation/requests/[id]/page.tsx",
  },
] as const;

export function resolveCanonicalAdminRoute(pathname: string): string | null {
  for (const route of CANONICAL_ADMIN_ROUTE_REPAIRS) {
    const legacySegments = route.legacyPathname.split("/");
    const pathnameSegments = pathname.split("/");
    if (legacySegments.length !== pathnameSegments.length) continue;

    const matches = legacySegments.every(
      (segment, index) => segment.startsWith(":") || segment === pathnameSegments[index],
    );
    if (!matches) continue;

    const params = new Map(
      legacySegments
        .map((segment, index) => [segment, pathnameSegments[index]] as const)
        .filter(([segment]) => segment.startsWith(":")),
    );

    return route.canonicalPathname
      .split("/")
      .map((segment) => (segment.startsWith(":") ? params.get(segment) : segment))
      .join("/");
  }
  return null;
}
