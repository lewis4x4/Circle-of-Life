/**
 * Canonical demo-auth roster.
 *
 * Source of truth for which seeded accounts MUST authenticate against the
 * pilot Supabase project with the canonical password. The repair script
 * (`repair-demo-auth.mjs`) reads this list and enforces it idempotently;
 * the verify script (`verify-auth-fixtures.mjs`) reads it and gates CI on
 * every-account-passes.
 *
 * Add an account here only when an audit phase (or live workflow) actually
 * needs to authenticate as that role. The CI gate fails the build the
 * moment any account in this list stops authenticating — so don't include
 * legacy / deprecated / never-used accounts. They sit in `auth.users` but
 * stay out of the gate.
 *
 * Source: `supabase/migrations/166_rebuild_demo_auth_with_triggers.sql`
 * plus subsequent role-specific seeds (170 med_tech, 175 dietary).
 *
 * Three accounts in this roster were drifted at D0a discovery — `admin@`,
 * `james.thompson@`, `robert.sullivan@` failed `signInWithPassword` against
 * `HavenDemo2026!`. The Phase A ad-hoc service-role repair that fixed
 * `milton.smith` was never applied to those three. The repair script
 * codifies the repair so this can't drift silently again.
 *
 * Note on `marcus.bell@`: migration 175 attempts to seed him, but the
 * live pilot project does NOT have a corresponding row in `auth.users` —
 * the migration may have rolled back partially. The repair script creates
 * him idempotently via the service-role admin API.
 */

/** @typedef {{ id: string; email: string; appRole: string; fullName: string; shell: string }} CanonicalAccount */

/**
 * IDs and full names are observed from the live pilot project after D0a's
 * investigation — NOT inferred from migration 166's `a0000000-…-NN`
 * pattern. The initial roster guess assumed `frontdesk@` was at slot 15
 * and `housekeeper@` was at slot 13 based on the migration order, but the
 * live state has `housekeeper@` at slot 15 (Rosa Alvarez, role
 * `housekeeper`) and `frontdesk@` at a random UUID assigned during a
 * later seed pass (Jessica Lawson, role `admin_assistant`). Slot 13 does
 * not exist. The corrected roster below mirrors the live state — verified
 * via `auth.admin.listUsers()` after the D0a probe.
 *
 * @type {readonly CanonicalAccount[]}
 */
export const CANONICAL_ROSTER = Object.freeze([
  {
    id: "a0000000-0000-0000-0000-000000000001",
    email: "milton.smith@circleoflifealf.com",
    appRole: "owner",
    fullName: "Milton Smith",
    shell: "/admin",
  },
  {
    id: "a0000000-0000-0000-0000-000000000002",
    email: "jessica.murphy@circleoflifealf.com",
    appRole: "facility_admin",
    fullName: "Jessica Murphy",
    shell: "/admin",
  },
  {
    id: "a0000000-0000-0000-0000-000000000003",
    email: "sarah.williams@circleoflifealf.com",
    appRole: "nurse",
    fullName: "Sarah Williams",
    shell: "/admin",
  },
  {
    id: "a0000000-0000-0000-0000-000000000004",
    email: "maria.garcia@circleoflifealf.com",
    appRole: "caregiver",
    fullName: "Maria Garcia",
    shell: "/caregiver",
  },
  {
    id: "a0000000-0000-0000-0000-000000000005",
    email: "james.thompson@circleoflifealf.com",
    appRole: "caregiver",
    fullName: "James Thompson",
    shell: "/caregiver",
  },
  {
    id: "a0000000-0000-0000-0000-000000000007",
    email: "linda.chen@circleoflifealf.com",
    appRole: "family",
    fullName: "Linda Chen",
    shell: "/family",
  },
  {
    id: "a0000000-0000-0000-0000-000000000008",
    email: "admin@circleoflifealf.com",
    appRole: "owner",
    fullName: "David Martinez",
    shell: "/admin",
  },
  {
    id: "a0000000-0000-0000-0000-000000000009",
    email: "dietary@circleoflifealf.com",
    appRole: "dietary",
    fullName: "Patricia Nguyen",
    shell: "/dietary",
  },
  {
    id: "a0000000-0000-0000-0000-000000000010",
    email: "maintenance@circleoflifealf.com",
    appRole: "maintenance_role",
    fullName: "Carlos Rivera",
    shell: "/admin",
  },
  {
    id: "a0000000-0000-0000-0000-000000000011",
    email: "broker@circleoflifealf.com",
    appRole: "broker",
    fullName: "Angela Brooks",
    shell: "/admin",
  },
  {
    id: "a0000000-0000-0000-0000-000000000012",
    email: "medtech@circleoflifealf.com",
    appRole: "med_tech",
    fullName: "Maria Ochoa",
    shell: "/med-tech",
  },
  {
    id: "a0000000-0000-0000-0000-000000000014",
    email: "coordinator@circleoflifealf.com",
    appRole: "coordinator",
    fullName: "Natalie Foster",
    shell: "/admin",
  },
  {
    id: "a0000000-0000-0000-0000-000000000015",
    email: "housekeeper@circleoflifealf.com",
    appRole: "housekeeper",
    fullName: "Rosa Alvarez",
    shell: "/caregiver",
  },
  {
    id: "a0000000-0000-0000-0000-000000000016",
    email: "marcus.bell@circleoflifealf.com",
    appRole: "dietary",
    fullName: "Marcus Bell",
    shell: "/dietary",
  },
  {
    id: "0d8a23fd-fb20-4da1-afdd-e59ad305acb3",
    email: "frontdesk@circleoflifealf.com",
    appRole: "admin_assistant",
    fullName: "Jessica Lawson",
    shell: "/admin",
  },
]);

/**
 * The canonical password every account in the roster must authenticate
 * against. The string lives in source by owner choice — see
 * `SEED_DRIFT.md` for the GitGuardian-false-positive rationale.
 *
 * Override via the `PHASE1_DEMO_PASSWORD` env var when running against a
 * non-pilot project or after a rotation.
 */
export const CANONICAL_PASSWORD = process.env.PHASE1_DEMO_PASSWORD ?? "HavenDemo2026!";
