/**
 * Server redirects served by `next.config.ts` `redirects()`. Kept here so tests can read
 * the same list the build uses.
 *
 * Route group `(admin)` omits `admin` from the path, so `(admin)/<segment>/page.tsx` is
 * also reachable at `/<segment>`. Only `(admin)/admin/layout.tsx` mounts the admin shell
 * (header, nav, facility selector), so a short path that is not redirected renders the
 * page body with no shell (COL-644). Every segment with both `(admin)/<segment>` and
 * `(admin)/admin/<segment>` pages is listed; `route-shell-coverage.test.ts` enforces it.
 */
export const ADMIN_ALIAS_SEGMENTS = [
  "assessments",
  "billing",
  "certifications",
  // "dietary" intentionally omitted — /dietary is the dedicated Lead Cook
  // Command Deck at (dietary)/dietary/page.tsx, not a redirect to admin.
  // Admin dietary hub remains at /admin/dietary (direct path).
  "executive",
  "family-messages",
  "finance",
  "incidents",
  "insurance",
  "payroll",
  "reports",
  "reputation",
  "residents",
  "risk",
  "schedules",
  "search",
  "staff",
  "staffing",
  "time-records",
  "training",
  "transportation",
  "vendors",
] as const;

export type LegacyRedirect = {
  source: string;
  destination: string;
  permanent: boolean;
};

export const LEGACY_REDIRECTS: LegacyRedirect[] = [
  ...ADMIN_ALIAS_SEGMENTS.flatMap((seg) => [
    { source: `/${seg}`, destination: `/admin/${seg}`, permanent: true },
    { source: `/${seg}/:path*`, destination: `/admin/${seg}/:path*`, permanent: true },
  ]),
  // The medication reconciliation hub lives at /admin/discharge; the pipeline URL
  // rendered the same hub outside the admin shell (COL-644).
  {
    source: "/pipeline/discharge-management/new-reconciliation",
    destination: "/admin/discharge/new",
    permanent: true,
  },
  {
    source: "/pipeline/discharge-management",
    destination: "/admin/discharge",
    permanent: true,
  },
  {
    source: "/pipeline/discharge-transition/new",
    destination: "/admin/discharge/new",
    permanent: false,
  },
  {
    source: "/pipeline/discharge-transition",
    destination: "/admin/discharge",
    permanent: false,
  },
  {
    source: "/pipeline/family-portal/:path*",
    destination: "/admin/family-portal/:path*",
    permanent: false,
  },
  {
    source: "/pipeline/family-portal",
    destination: "/admin/family-portal",
    permanent: false,
  },
  // Staff bookmarks often use /admin/family; canonical hub is /admin/family-portal.
  {
    source: "/admin/family/:path*",
    destination: "/admin/family-portal/:path*",
    permanent: false,
  },
  {
    source: "/admin/family",
    destination: "/admin/family-portal",
    permanent: false,
  },
  {
    source: "/admin/facilities/:facilityId/emergency-contacts",
    destination: "/admin/facilities/:facilityId?tab=emergency",
    permanent: false,
  },
  {
    source: "/admin/facilities/:facilityId/surveys",
    destination: "/admin/facilities/:facilityId?tab=licensing",
    permanent: false,
  },
];
