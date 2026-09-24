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

/**
 * `/admin/v2/<segment>` pages were one-line re-exports of `/admin/<segment>` (COL-654);
 * the tree is retired and each URL 308s to its `/admin` equivalent. Only the flag-gated
 * design-system preview (`/admin/v2/design-preview`) still renders under `/admin/v2`.
 */
export const RETIRED_V2_SEGMENTS = [
  "admissions",
  "executive",
  "finance",
  "incidents",
  "quality",
  "residents",
  "rounding",
  "settings",
] as const;

/**
 * `src/app/(caregiver)/<segment>` pages are also reachable at `/<segment>`, where the
 * floor app's nav shows nothing active (COL-654). `/caregiver/<segment>` is canonical.
 */
export const CAREGIVER_ALIAS_SEGMENTS = [
  "clock",
  "followups",
  "handoff",
  "incident-draft",
  "me",
  "meds",
  "prn-followup",
  "resident",
  "tasks",
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
  { source: "/admin/v2", destination: "/admin", permanent: true },
  // The v2 alert detail only ever redirected to the alert's anchor on the list.
  {
    source: "/admin/v2/executive/alerts/:id",
    destination: "/admin/executive/alerts",
    permanent: true,
  },
  ...RETIRED_V2_SEGMENTS.flatMap((seg) => [
    { source: `/admin/v2/${seg}`, destination: `/admin/${seg}`, permanent: true },
    { source: `/admin/v2/${seg}/:path*`, destination: `/admin/${seg}/:path*`, permanent: true },
  ]),
  ...CAREGIVER_ALIAS_SEGMENTS.flatMap((seg) => [
    { source: `/${seg}`, destination: `/caregiver/${seg}`, permanent: true },
    { source: `/${seg}/:path*`, destination: `/caregiver/${seg}/:path*`, permanent: true },
  ]),
  // /clinical/residents* rendered the admin roster and resident record in a second shell
  // with no sidebar (COL-654); nothing links to it.
  { source: "/clinical/residents/add", destination: "/admin/residents/new", permanent: true },
  { source: "/clinical/residents", destination: "/admin/residents", permanent: true },
  { source: "/clinical/residents/:path*", destination: "/admin/residents/:path*", permanent: true },
  { source: "/clinical", destination: "/admin/residents", permanent: true },
  // Family notes is a view of Family Connections now (COL-707, Brian 2026-09-23).
  // Next passes the incoming query through, so ?filter=triage survives the hop.
  { source: "/admin/family-messages", destination: "/admin/family-portal?tab=notes", permanent: true },
  { source: "/admin/family-messages/:path*", destination: "/admin/family-portal?tab=notes", permanent: true },
  { source: "/family-messages", destination: "/admin/family-portal?tab=notes", permanent: true },
  // Cash and Trust were two pages over one resident-money ledger; Trust is canonical and
  // now carries the petty cash and trust posting workbench (COL-707, Brian 2026-09-23).
  { source: "/admin/cash", destination: "/admin/finance/trust", permanent: true },
  { source: "/admin/cash/:path*", destination: "/admin/finance/trust", permanent: true },
  // Page files that only called redirect() are server redirects instead (COL-707).
  // The vendor directory hosts the inline creator.
  { source: "/admin/vendors/new", destination: "/admin/vendors/directory", permanent: true },
  // The live rounding board is the hub root now; old links keep working.
  { source: "/admin/rounding/live", destination: "/admin/rounding", permanent: true },
  // Create flows not built yet; nothing links here. Temporary so they can ship later.
  { source: "/admin/family-portal/consents/new", destination: "/admin/family-portal", permanent: false },
  { source: "/admin/family-portal/conferences/new", destination: "/admin/family-portal", permanent: false },
  // "Close" was a second tab rendering Period close (COL-654).
  { source: "/admin/finance/close", destination: "/admin/finance/period-close", permanent: true },
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
