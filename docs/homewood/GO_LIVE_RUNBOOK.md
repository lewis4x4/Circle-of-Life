# Homewood Lodge ALF — Go-Live Runbook

This is the manual procedure for launching Haven at Homewood. The runbook is **self-contained** — every step is actionable without external context.

- **Pilot facility:** Homewood Lodge ALF, Florida
- **Target date:** T+0 (to be set by Operations)
- **Launch gate variable:** `vars.HAVEN_UI_GATES_ENABLED` (GitHub repo variable; controls every CI gate)
- **Project:** https://manfqmasfqppukpobpld.supabase.co
- **Sentry:** `blackrockai / javascript-nextjs-col` (`https://blackrockai.sentry.io/issues/?project=4511196343959552`)

---

## T-1 week — Pre-launch checklist

Run through this list in order. Every box must be checked before proceeding to T-0.

- [ ] **Configure secrets.** Verify in GitHub repo settings:
  - `HOMEWOOD_LAUNCH_PASSWORD` (secret) — the launch password for every Homewood account
  - `SENTRY_DSN`, `NEXT_PUBLIC_SENTRY_DSN`, `SENTRY_AUTH_TOKEN`, `SENTRY_ORG`, `SENTRY_PROJECT` (secrets)
  - `SUPABASE_URL_TEST`, `SUPABASE_ANON_KEY_TEST`, `SUPABASE_SERVICE_ROLE_KEY_TEST` (secrets)
  - `HOMEWOOD_FACILITY_ID` (repo variable)
- [ ] **Run every Homewood script and review the report.** From a checkout of `main` with `.env.local` populated:
  ```bash
  npm run homewood:audit
  npm run homewood:verify-auth
  BASE_URL=http://127.0.0.1:4310 npm run homewood:verify-rbac
  BASE_URL=http://127.0.0.1:4310 npm run homewood:test-launch
  npm run homewood:perf-baseline
  BASE_URL=http://127.0.0.1:4310 npm run homewood:a11y-baseline
  npm run homewood:preflight
  ```
  - [ ] `DATA_AUDIT.md` — zero CRITICAL anomalies
  - [ ] `AUTH_VERIFICATION.md` — every Homewood account authenticates (n/n)
  - [ ] `RBAC_MATRIX.md` + verify run — every cell matches reality
  - [ ] `LAUNCH_WORKFLOW_TESTS.md` + Playwright run — 7/7 green
  - [ ] `PERF_BASELINE.md` — all 5 routes within 300kb gzip threshold
  - [ ] `A11Y_BASELINE.md` — 0 critical, 0 serious violations on the 5 routes
  - [ ] `GO_LIVE_REPORT.md` shows **GO** at the top
- [ ] **Sentry smoke test.** `npm run smoke:sentry` and verify the event appears in `https://blackrockai.sentry.io/issues/?project=4511196343959552`.
- [ ] **Browser smoke.** From a clean session, sign in as each Homewood role (owner / facility_admin / nurse / caregiver / med_tech / family / dietary). Confirm each lands on the documented route per `RBAC_MATRIX.md`.
- [ ] **Backup taken.** Take a manual snapshot of the Supabase project before any go-live writes. Pro-tier projects do this automatically; verify the most recent backup is < 24 hours old.
- [ ] **Tag main pre-launch:**
  ```bash
  git tag homewood-pre-launch
  git push origin homewood-pre-launch
  ```
  This is the rollback target.
- [ ] **Homewood ED dry run.** Walk Homewood Executive Director through caregiver shift, med pass, and incident workflows on a staging environment. Capture every "where do I…" question — log them in a punch list for launch-day support.
- [ ] **Schedule on-site.** Owner / launch lead on-site at Homewood T+0 through T+3 (covering days, evenings, and a weekend day).
- [ ] **Comms plan.** Confirm the support phone line, the staff-facing Slack / WhatsApp channel, and the escalation chain (below). Distribute one-page laminated cheat-sheet to every Homewood employee.

## T-0 — Launch day

- [ ] **Confirm GO.** From `main`, run `npm run homewood:preflight`. Top line must say **GO**.
- [ ] **Owner on-site at Homewood.** Phone reachable; laptop on the corporate network.
- [ ] **Flip the CI gate.** In GitHub → Settings → Variables → Repository variables, set `HAVEN_UI_GATES_ENABLED = 'true'`. This activates every gating workflow.
- [ ] **Activate Sentry alerts.** Confirm in Sentry → Alerts that on-call gets paged on any new error from `javascript-nextjs-col`.
- [ ] **Announce go-live.** Brief huddle with Homewood staff: where to sign in, who to call when something doesn't work, what to do if the network drops.
- [ ] **Monitor.** Watch Sentry, watch the Slack/WhatsApp channel, watch the support phone. First 4 hours are highest-risk.
- [ ] **End-of-day check-in.** Run `npm run homewood:audit` and `npm run homewood:verify-auth` again. No new CRITICAL anomalies. Note any unresolved issues in the open-incident log.

## T+1 through T+7 — First week

Every day for 7 days:

- [ ] Review Sentry. Acknowledge / triage / dismiss new issues.
- [ ] Run `npm run homewood:preflight` from `main`. Top line must stay **GO**.
- [ ] 10-minute check-in with Homewood ED. Three open questions per the launch punch list.
- [ ] Update the launch tracker (Linear / Notion) with: incidents opened, incidents resolved, staff feedback themes, performance complaints, accessibility complaints.

If a gate flips to **NO-GO** during the first week, treat as a P1 — see Rollback below.

## Rollback procedure

### Soft rollback (preferred)

Used when a regression is detected but data is intact.

```bash
# 1. Revert the offending PR(s) on main
git revert <pr-merge-sha>

# 2. Re-deploy Netlify (auto-triggers from main)
# 3. Confirm preflight returns GO
npm run homewood:preflight

# 4. Notify Homewood staff: "We pushed a fix; please refresh your browser."
```

### Hard rollback (last resort)

Used when soft rollback fails or the codebase is structurally compromised.

```bash
# 1. Reset main to the pre-launch tag
git checkout main
git reset --hard homewood-pre-launch
git push --force-with-lease origin main

# 2. Disable the gate
# In GitHub: set HAVEN_UI_GATES_ENABLED = 'false'

# 3. Notify Homewood: "Switching back to paper for the rest of the shift; revised launch will be communicated."
```

### Read-only mode (data integrity risk)

If data integrity is at risk (corruption, RLS bypass, mass-write incident):

```bash
# 1. Pause writes via Supabase Studio
#    → Database → Roles → revoke INSERT/UPDATE/DELETE from `authenticated` role
# 2. Audit recent writes via audit_log
# 3. Restore from PITR if necessary (only available on Pro plan + BAA + PITR confirmed)
```

After restore, run `npm run homewood:audit` and confirm CRITICAL count is 0 before re-enabling writes.

## Support escalation

| Severity | Owner | Response time |
|---|---|---|
| P1 — site down, data integrity at risk | On-call engineer + launch lead | 15 min |
| P2 — workflow broken for one role | Launch lead | 60 min |
| P3 — cosmetic / minor regression | Daily punch list | next business day |

Contacts are maintained in `~/.claude/projects/-Users-brianlewis/memory/Contacts.md` and in Notion. **Do not page the on-call engineer without first confirming the issue reproduces.**

## Communication plan

- **Inside Homewood staff:** Slack/WhatsApp launch channel, plus laminated cheat-sheet at the nurses' station.
- **Owner / corporate:** Daily standup at 4 PM Eastern for the first week. Subject: "Homewood T+N report".
- **Resident families:** No public communication about the system itself. The family portal goes live silently — if a family member calls about it, route them to the standard family-services number.
- **Florida AHCA / regulatory:** No notification required for this system change. The clinical record-of-truth is unchanged in shape; only the access medium changes.

## When this runbook is wrong

Update it. The runbook lives in `main` and is versioned with the codebase. Every change to the launch posture (new gates, new alerts, changed contacts) must land here in the same PR.
