# Phase 1 — Supabase Auth debug handoff

**Purpose:** Historical dashboard/support handoff for the Track A auth incident; **retain** if Auth regresses. Phase 1 acceptance **resumed** after 2026-04-09.

**Canonical repro:** `npm run demo:auth-check`

**Status (2026-04-16):** **RESOLVED for target** — hosted Auth issues pilot JWTs again; the current pilot matrix was re-verified with:

- `milton.smith@circleoflifealf.com`
- `jessica.murphy@circleoflifealf.com`
- `maria.garcia@circleoflifealf.com`
- `linda.chen@circleoflifealf.com`

All use `HavenDemo2026!`, and owner / facility_admin / caregiver / family shell routing was rechecked locally against the target project.

---

## Project and scope

| Field | Value |
|-------|-------|
| Supabase project ref | `manfqmasfqppukpobpld` |
| Supabase URL | `https://manfqmasfqppukpobpld.supabase.co` |
| Phase / track | `Track A` — Phase 1 acceptance closeout |
| ~~Current blocker~~ | ~~Valid pilot-role login fails before shell routing~~ — **cleared 2026-04-09** |
| What was blocked | Real-auth UAT — **unblocked**; **RLS** — **PASS** (owner sign-off 2026-04-09) per [PHASE1-RLS-VALIDATION-RECORD.md](./PHASE1-RLS-VALIDATION-RECORD.md) |

---

## Current known-good facts

- Remote migrations are aligned through `001–095`.
- Auth remediation migrations `093`, `094`, and `095` are already applied on the target project.
- `auth/v1/settings` responds successfully.
- Email/password auth is enabled.
- Legacy `.demo` addresses now fail as plain `invalid_credentials`, which is expected after email normalization.
- Current verified pilot addresses are:
  - `milton.smith@circleoflifealf.com`
  - `jessica.murphy@circleoflifealf.com`
  - `maria.garcia@circleoflifealf.com`
  - `linda.chen@circleoflifealf.com`

---

## Canonical repro evidence

Run:

```bash
npm run demo:auth-check
```

Latest observed result on 2026-04-16:

- `settings.ok = true`
- `settings.email_provider_enabled = true`
- `settings.disable_signup = false`
- `pilot_login_ok = true`
- current pilot matrix authenticates with email/password again

Pilot emails checked:

- `milton.smith@circleoflifealf.com`
- `jessica.murphy@circleoflifealf.com`
- `maria.garcia@circleoflifealf.com`
- `linda.chen@circleoflifealf.com`

Expected success condition:

- At least one pilot user returns `has_access_token = true`
- `/login` can complete shell routing for `facility_admin`, `caregiver`, and `family`

---

## Dashboard inspection checklist

Complete these in order and capture screenshots or copied values:

1. Confirm the active project ref is `manfqmasfqppukpobpld`.
2. Open **Authentication → Users** and search for:
   - `jessica@circleoflifealf.com`
   - `maria.garcia@circleoflifealf.com`
   - `robert.sullivan@circleoflifealf.com`

**Owner completion (2026-04-06):**

| Item | Status | Evidence |
|------|--------|----------|
| **1** — Project ref `manfqmasfqppukpobpld` | **DONE** | Owner confirmed active project ref matches repo canonical URL. |
| **2** — **Authentication → Users** | **DONE** | Owner provided screenshot: **PRODUCTION**, **Circle of Life**, Users list shows 8 users including `@circleoflifealf.com` pilot identities (Email provider). Confirms pilot accounts exist in hosted Auth for the target project. |

3. For each user, record:
   - auth user id
   - email
   - provider list
   - created date
   - last sign-in date
   - email confirmed state
   - disabled / banned state if shown
4. Open **Authentication → Providers / Settings** and record:
   - email provider enabled
   - confirm-email requirement
   - any domain allow/deny configuration
   - whether any custom auth hooks are enabled
5. Open **Logs** for Auth around a failed `demo:auth-check` run and capture:
   - timestamp
   - request id if present
   - full error message
   - any failing SQL object, relation, trigger, or schema reference
6. If the dashboard exposes SQL or config for auth hooks / custom claims, confirm whether any hook references a missing table, function, or schema.
7. If available, inspect whether the project has an Auth schema drift warning or failed migration note in the dashboard.

Stop and escalate if the logs mention:

- missing relation or column in `auth`
- missing trigger/function
- auth hook failure
- schema or permission error during token issuance

---

## Support handoff packet

Use this exact summary when opening Supabase support or internal escalation:

```text
Project ref: manfqmasfqppukpobpld
Issue: Email/password token issuance fails for existing pilot users with 500 unexpected_failure / "Database error querying schema".

What we already verified:
- auth/v1/settings returns 200
- email provider is enabled
- repo and remote migrations are aligned through 001-095
- repo-side auth remediation migrations 093, 094, and 095 are already applied
- current pilot addresses are normalized to @circleoflifealf.com
- canonical repro command: npm run demo:auth-check

Known failing users:
- jessica@circleoflifealf.com
- maria.garcia@circleoflifealf.com
- robert.sullivan@circleoflifealf.com

Observed behavior:
- POST /auth/v1/token?grant_type=password returns 500
- error_code = unexpected_failure
- msg = Database error querying schema

Please identify what Auth-side schema/configuration issue is causing token issuance to fail for these users on this project and what project-level fix is required.
```

Attach:

- latest `npm run demo:auth-check` output
- dashboard user screenshots
- auth log entry screenshot or copied raw log

---

## Exit criteria to resume Track A

**Met (2026-04-09):**

1. `npm run demo:auth-check` — pilot login succeeds (owner-verified).
2. `/login` — owner, facility_admin, caregiver, family reach correct shells.
3. `PHASE1-EXECUTION-LOG.md` — **PH1-P03** and **PH1-A01** **PASS**.
4. `PHASE1-RLS-VALIDATION-RECORD.md` — **PASS** for single-facility pilot (2026-04-09); re-run **RLS-02** when multi-facility.

If Auth breaks again, require items **1–4** before treating RLS/UAT as valid.

---

## References

- [PHASE1-CLOSURE-RECORD.md](./PHASE1-CLOSURE-RECORD.md)
- [PHASE1-EXECUTION-LOG.md](./PHASE1-EXECUTION-LOG.md)
- [PHASE1-RLS-VALIDATION-RECORD.md](./PHASE1-RLS-VALIDATION-RECORD.md)
- [PHASE1-ENV-CONFIRMATION.md](./PHASE1-ENV-CONFIRMATION.md)
- [DEMO-SEED-RUNBOOK.md](./DEMO-SEED-RUNBOOK.md)
