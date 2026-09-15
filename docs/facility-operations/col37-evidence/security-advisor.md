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

## Left open

- **53 `authenticated`-executable SECURITY DEFINER functions.** These are real
  RPCs — referral commands, resident record intake, finance, NLQ threads — and
  each needs a per-function ruling on whether the definer is doing authorization
  work the caller's RLS could not. `docs/facility-operations/COL-18-BASELINE.md`
  warns against revoking invoker wrappers blindly, and it is right. Not a batch
  edit.
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
