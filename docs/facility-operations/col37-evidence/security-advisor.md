# COL-37 — Security Advisor remediation, batch 1

Measured 2026-09-15 against production `manfqmasfqppukpobpld` and staging
`iwcnajanvjvynolltflw`. Migrations 389 and 390, probe
`supabase/tests/review_col37_security_advisor.sql`.

## What was actually wrong

The issue was written from a 2026-09-04 advisor run. The 2026-09-15 run does not
match it, and one finding turned out to be live rather than theoretical.

`public.resident_billable_status` (created in 217) had no `security_invoker`, so
it ran with its owner's rights and ignored RLS on `public.residents`. Supabase's
default grants had handed the view to `anon`, and the publishable anon key ships
in the browser bundle. Measured before the fix:

```
GET /rest/v1/residents?select=id                      -> 200, content-range */0
GET /rest/v1/resident_billable_status?select=resident_id -> 206, content-range */33
```

Both as `anon`, no session. RLS was holding on the table and the view walked
around it: resident_id, organization_id, facility_id, status and is_billable for
all 33 residents across every facility. The view is also auto-updatable, so the
same default grants carried INSERT/UPDATE/DELETE through to `public.residents`.
Nothing in `src/` reads or writes the view — the grants were never deliberate.

After 389:

```
GET /rest/v1/resident_billable_status -> 401 42501 permission denied for view
GET /rest/v1/residents                -> 200, content-range */0   (unchanged)
```

## Two findings that are not what they look like

- **`public.haven_assert_authorized_request()` keeps its anon grant.** It is the
  PostgREST `pgrst.db_pre_request` hook, set on the `authenticator` role in 326.
  PostgREST runs it as the request role before every request, anonymous ones
  included, so revoking it refuses the entire hosted API. It returns void and
  discloses nothing when called directly. Documented on the function itself and
  asserted by the probe, so a later advisor sweep cannot revoke it on sight.
  This is the one remaining `anon_security_definer_function_executable`.

- **The payroll guards were a real finding.** `haven_payroll_batch_guard` and
  `haven_payroll_line_guard` are BEFORE-row trigger functions from 334 that kept
  the default EXECUTE to PUBLIC/anon/authenticated. They predate the repo's
  convention of revoking trigger functions (349, 353, 354, 359–361, 368, 369,
  374, 386). Section 4 of the probe proves a trigger still fires for a role
  without EXECUTE on its function rather than asserting it, because the payroll
  write path is what would break if that were false.

## Counts

| Lint | 2026-09-04 (issue) | 2026-09-15 before | after |
|---|---|---|---|
| `security_definer_view` (ERROR) | 2 | 1 | **0** |
| `function_search_path_mutable` | 12 | 10 | **0** |
| `anon_security_definer_function_executable` | not listed | 3 | **1** (documented exception) |
| `authenticated_security_definer_function_executable` | 14 | 55 | 53 |
| `extension_in_public` | 3 | 3 | 3 |
| `auth_leaked_password_protection` | on | on | on |
| `rls_enabled_no_policy` (INFO) | 2 | 76 | 76 |

## Applied

| Where | 389 | 390 | Probe |
|---|---|---|---|
| Staging `iwcnajanvjvynolltflw` | applied, ledger row | applied, ledger row | pass |
| Production `manfqmasfqppukpobpld` | applied, ledger row `389` | applied, ledger row `390` | pass |

Both carry `NOTIFY pgrst, 'reload schema'` — the grants moved, so PostgREST's
cached view of the API was stale. Negative control: the probe run against
production before 389 failed on assertion 1 by name, so it discriminates.

Staging is still missing 387 and 388 (pre-existing drift, not from this work).

---

# COL-391 — per-function rulings, pass 1 (NLQ threads, sequence allocators)

Migration 397, 2026-09-15. Nine of the 53 ruled, plus five that arrived mid-pass.

## The defect the rulings turned up

All six NLQ thread RPCs (275, 276, 277) open their role guard with

```sql
IF COALESCE(haven.app_role(), '') NOT IN ('owner', 'org_admin') THEN
```

and `haven.app_role()` has returned the `public.app_role` enum since 004 — it was
never text. COALESCE resolves `''` to that enum, Postgres folds the coercion at
plan time, and the statement raises `22P02 invalid input value for enum
app_role: ""` on every call, before the guard decides anything. Measured on
staging with a fully resolved owner actor: the same test written against enum
literals returns "guard passed" while the COALESCE form raises.

So `rename_nlq_thread`, `set_nlq_thread_pinned`, `set_nlq_thread_archived`,
`delete_nlq_thread`, `search_nlq_threads` and `set_nlq_message_feedback` have
never worked — renaming, pinning, archiving, deleting, searching and rating a
Haven Insight thread all failed for every user since those migrations shipped.
Production carries 0 rows in `exec_nlq_sessions`, which is consistent. Scanning
`prosrc` on production finds the shape in exactly those six functions.

397 casts to text before the COALESCE.

```
before 397, staging, owner actor, calling the shipped definition:
  rename_nlq_thread -> 22P02 invalid input value for enum app_role: ""

after 397, production, real owner actor, read-only (every call names an id that
does not exist, so nothing is written):
  rename=P0002 pin=P0002 archive=P0002 delete=P0002
  search=ok(0 rows) feedback=ok(no row matched)
```

`P0002` is the function's own `not_found` — the guard now runs and the statement
reaches the row it was asked about. Section 9 of the probe refuses the pattern
from now on: a role check that raises instead of deciding is worse than none,
because it reads like protection.

## The rulings

| Function | Ruling |
|---|---|
| `rename_nlq_thread` | incidental → **SECURITY INVOKER** |
| `set_nlq_thread_pinned` | incidental → **SECURITY INVOKER** |
| `set_nlq_thread_archived` | incidental → **SECURITY INVOKER** |
| `search_nlq_threads` | incidental → **SECURITY INVOKER** |
| `delete_nlq_thread` | **definer required** — sets `deleted_at`, and `exec_nlq_sessions_update`'s WITH CHECK demands `deleted_at IS NULL` |
| `set_nlq_message_feedback` | **definer required** — `exec_nlq_messages` has no UPDATE policy, and its AFTER trigger is an invoker that updates a table caregiver/family cannot |
| `allocate_incident_number` | **definer required** — `incident_sequences` RLS excludes caregiver, who files incidents; the max-so-far scan must see every incident or it reissues a number |
| `allocate_vendor_po_number` | **definer required** — `vendor_po_sequences` has RLS on and no policies at all; this is the counter's only door |
| `haven_assert_authorized_request` | **definer required** — restated from 389 so it carries the ruling marker |
| the five `care_plan_alert_*` | **revoked** — see below |

The four invoker switches are safe because each body's checks are a restatement
of the policy on the table it touches. Proven on staging against a synthetic
owner actor, rolled back: rename, pin, archive/unarchive and search all take, a
second user's thread is still refused `not_found`, and the two that kept definer
rights still work. Script: `col391-invoker-evidence.sql` in this directory.

## What the ratchet caught on its first run

Section 7 fails on any `public` SECURITY DEFINER function executable by
`authenticated` that carries no `COL-37 ruling:` comment, except the 44 named in
its pending list — which only ever shrinks. Run against production it immediately
named five functions that were not in the 53: `care_plan_alert_on_*` and
`care_plan_alerts_resolve_on_activation`, added by migration 394 and applied to
production while this pass was being written. They are trigger functions that
kept the default EXECUTE grant to PUBLIC/anon/authenticated/service_role — the
same oversight 389 found in the payroll guards. PL/pgSQL refuses a trigger
function called as an ordinary function, so this was not an open write path; it
was definer surface granted to roles with no use for it. 397 revokes all five and
section 3 now holds them revoked and still attached.

## Counts (production)

| | before 397 | after 397 |
|---|---|---|
| `authenticated_security_definer_function_executable` | 58 (53 + 394's five) | **49** |
| of those, carrying a recorded ruling | 0 | **5** |
| still to rule on | 53 | **44** |
| `anon_security_definer_function_executable` | 1 | 1 (documented exception) |

## Applied

| Where | 397 | Probe |
|---|---|---|
| Staging `iwcnajanvjvynolltflw` | applied, ledger row `397` | pass |
| Production `manfqmasfqppukpobpld` | applied, ledger row `397` | pass |

Negative control: before 397 the probe failed on production by naming all
fourteen unruled functions, so section 7 discriminates.

---

# COL-391 — per-function rulings, pass 2 (referral)

Migration 399, 2026-09-15. Fifteen ruled: thirteen keep definer rights, two do
not. The ratio runs the other way from pass 1, and the reason is on purpose.

## Why this family is almost all category 1

Migration 379 (COL-328 / REF-01) made the referral module RPC-only and said so
in its header: *"denies direct reads of sensitive lead columns, and exposes the
minimum RPC doors needed by the existing referral UI."* Measured on production:

| Table | What `authenticated` holds |
|---|---|
| `referral_leads` | column-level SELECT on 48 columns — and **no** INSERT/UPDATE/DELETE, and no SELECT on `phone`, `email`, `notes`, `date_of_birth`, `external_reference`, `closure_note`, `competitor_chosen`, `satisfaction_rating` |
| `referral_triage_inbox` | nothing — `REVOKE ALL … FROM PUBLIC, anon, authenticated` (379) |
| `referral_episode_events` | nothing (380) |
| `referral_people`, `referral_opportunities`, `referral_contacts`, `referral_person_contacts`, `referral_contact_permissions`, `referral_facility_considerations` | nothing (380) |
| `referral_sources` | `SELECT, INSERT, UPDATE` |

Those tables still carry RLS policies keyed on `haven.referral_capability()`.
The policies are the second lock, standing behind a grant that was deliberately
withheld — worth knowing before reading a policy as evidence that a role can
reach a table.

The boundary that matters here is a **column** grant, and that is the one thing
row-level security cannot express: RLS chooses rows, not columns. So the
sensitive-field split these RPCs implement — returning `phone`/`email`/`notes`
only when the caller holds `clinical_read` and the lead is `clinical_precheck` —
is definer work by construction. Several functions additionally call `haven`
helpers that `authenticated` deliberately cannot execute
(`lock_referral_episode`, `activate_referral_command`, `referral_request_lock`,
`write_referral_episode_event`, `lock_referral_actor_authority`,
`referral_downstream_snapshot`, `referral_empty_revision`), so they would fail at
their first statement as invokers.

Every one of the fifteen checks the caller itself through
`haven.referral_capability()` before it touches anything —
`referral_episode_command` does it six times, once per command group, rather
than once at the door.

## The two that are not

| Function | Ruling |
|---|---|
| `referral_source_create` | **SECURITY INVOKER.** `referral_sources` is the one referral table 379 left granted, and `referral_sources_insert` restates the function's own guard (organization, `source_manage`, facility access). The function is *stricter* — it demands `has_facility_access(p_facility_id)` even when the row lands org-wide with `facility_id NULL` — so every call it admits, the policy admits. `RETURNING id` is covered by `referral_sources_select`, and the `BEFORE` trigger `haven.guard_referral_source_authority()` re-asserts everything on the row and stamps `created_by` either way. Net effect: one more lock, same admitted set. |
| `referral_leads_authorized_export` | **SECURITY INVOKER.** It reads no table at all — checks `lead_export`, validates the page bounds, and returns what `referral_leads_authorized_read` gives it. `authenticated` may execute both. The definer bit was doing nothing. |

Proven on staging against a synthetic owner actor, rolled back: both create paths
(org-wide and facility-scoped) take and the guard trigger stamps
`organization_id` and `created_by`; the export returns and still refuses a
5000-row page with `22023`; the definer-required neighbours
(`referral_triage_authorized_read`, `referral_triage_submit`,
`referral_episode_initial_revision`) are unaffected; and after demoting the same
actor to `caregiver`, both invoker functions refuse with `42501`. Script:
`col391-referral-evidence.sql` in this directory.

## One narrow case worth naming

`referral_episode_initial_revision()` takes no arguments, reads nothing and
returns a constant — 64 zeroes, the sentinel revision an episode carries before
its first event. It looks like the definition of a pointless definer. It is not:
it wraps `haven.referral_empty_revision()`, which `authenticated` cannot execute,
so as an invoker it would raise permission denied. This is exactly the
invoker-wrapper case `COL-18-BASELINE.md` warns against revoking on sight, and it
is why the ruling is per function rather than per lint line.

## Counts (production)

| | before 399 | after 399 |
|---|---|---|
| `authenticated_security_definer_function_executable` | 49 | **47** |
| carrying a recorded ruling | 5 | **18** |
| switched to invoker by a COL-391 pass (cumulative) | 4 | **6** |
| still to rule on | 44 | **29** |

## Applied

| Where | 399 | Probe |
|---|---|---|
| Staging `iwcnajanvjvynolltflw` | applied, ledger row `399` | pass |
| Production `manfqmasfqppukpobpld` | applied, ledger row `399` | pass |

Negative control: before 399 the probe failed on production by naming all
fifteen referral functions with their argument lists, so section 7 discriminates.

---

## Left open

- **29 `authenticated`-executable SECURITY DEFINER functions.** Resident record
  intake (7), finance and payroll (6), corporate deliverables (3), employee file
  (3), system alerts (3), compliance/observation/misc (5), actor/shell (2). Each
  needs a per-function ruling on whether the definer is doing authorization work
  the caller's RLS could not. `docs/facility-operations/COL-18-BASELINE.md` warns
  against revoking invoker wrappers blindly, and it is right. Not a batch edit.
  The probe's pending list is the backlog; take a family per pass and delete its
  names from the array in the same change.
- **`vector`, `pg_trgm`, `btree_gist` in `public`.** Moving them changes
  unqualified operator and index-opclass resolution across the schema, and this
  repo already has a hosted-extension failure mode (`migrations:check:hosted`,
  migration 380). Needs its own migration and a replay.
- **76 tables with RLS on and no policy.** Mostly `haven.*`, `job_monitor.*` and
  `officer.*` — schemas PostgREST does not expose, where "no policy" means
  service-role-only by design. Needs to be stated as an intentional posture per
  schema rather than left as 76 open findings.
- **Leaked password protection.** Dashboard setting, no migration.
- The issue's exit criterion ("zero errors and zero warnings with High
  Compliance") still depends on COL-5, the HIPAA add-on and BAA.
