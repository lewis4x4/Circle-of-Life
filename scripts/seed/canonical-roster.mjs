/**
 * Canonical demo-auth roster — now deliberately EMPTY.
 *
 * Every account this roster used to name was a fictitious `@circleoflifealf.com`
 * persona (Milton Smith, Jessica Murphy, Sarah Williams, Maria Garcia, David
 * Martinez and the rest). They were retired from the pilot project on
 * 2026-09-16: all facility grants revoked, all profiles soft-deleted, all
 * `auth.users` rows banned, and the eleven with no immutable `audit_log`
 * history deleted outright. The four that signed April incidents and referral
 * leads — `medtech@`, `maria.garcia@`, `milton.smith@`, `admin@` — survive only
 * as banned, zero-grant tombstones so `audit_log` keeps a resolvable actor.
 * `audit_log.user_id -> auth.users` is `ON DELETE NO ACTION` and the table is
 * immutable by design, so those four cannot be removed without destroying
 * audit history.
 *
 * The list MUST stay empty unless the accounts it names really exist. This is
 * not a passive record: `repair-demo-auth.mjs` calls `auth.admin.createUser`
 * with each entry's fixed UUID, so re-adding a retired persona here silently
 * RESURRECTS it in the pilot project — recreating the very duplicate-identity
 * findings the Data Health panel exists to surface (COL-438). `marcus.bell@`
 * was in this list for months while having no `auth.users` row at all; the
 * repair script would have created him on its next run.
 *
 * If a future audit phase needs to authenticate as a role, add a real,
 * intentionally-provisioned account — not a persona — and say in this comment
 * who owns it.
 *
 * Historical context for the accounts that used to live here:
 * `supabase/migrations/166_rebuild_demo_auth_with_triggers.sql` plus the
 * role-specific seeds (170 med_tech, 175 dietary). Those migrations are
 * applied history and are deliberately left untouched.
 */

/** @typedef {{ id: string; email: string; appRole: string; fullName: string; shell: string }} CanonicalAccount */

/**
 * Empty by design — see the file header. Consumers (`repair-demo-auth.mjs`,
 * `verify-auth-fixtures.mjs`, `tests/homewood-launch/_helpers.ts`) all iterate
 * this array, so an empty roster makes them no-ops rather than breaking them.
 *
 * @type {readonly CanonicalAccount[]}
 */
export const CANONICAL_ROSTER = Object.freeze([]);

/**
 * The canonical password every account in the roster must authenticate
 * against. The string lives in source by owner choice — see
 * `SEED_DRIFT.md` for the GitGuardian-false-positive rationale.
 *
 * Override via the `PHASE1_DEMO_PASSWORD` env var when running against a
 * non-pilot project or after a rotation.
 */
export const CANONICAL_PASSWORD = process.env.PHASE1_DEMO_PASSWORD ?? "HavenDemo2026!";
