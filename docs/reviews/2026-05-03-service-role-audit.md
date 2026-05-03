# Service-role route audit continuation — 2026-05-03

Mission alignment: **pass** — tightening service-role boundaries protects resident, clinical, workforce, and financial data before Homewood real data entry.

## Scope

Follow-up pass over `src/app/api/**` routes that directly import `createServiceRoleClient`.

Current direct service-role API usage found in 17 route files:

- `src/app/api/admin/facilities/[facilityId]/rates/[rateId]/route.ts`
- `src/app/api/care-plans/[id]/approve/route.ts`
- `src/app/api/controlled-substance/verify-co-sign/route.ts`
- `src/app/api/cron/reputation/google-reviews/route.ts`
- `src/app/api/executive/standup/[week]/pdf/route.ts`
- `src/app/api/infection-control/evaluate-outbreak/route.ts`
- `src/app/api/infection-control/evaluate-vitals/route.ts`
- `src/app/api/insurance/renewal-narrative/route.ts`
- `src/app/api/knowledge/document-audit/route.ts`
- `src/app/api/knowledge/obsidian-draft/route.ts`
- `src/app/api/med-tech/incidents/route.ts`
- `src/app/api/pilot-feedback/route.ts`
- `src/app/api/reputation/integrations/google/route.ts`
- `src/app/api/reputation/integrations/status/route.ts`
- `src/app/api/reputation/oauth/google/callback/route.ts`
- `src/app/api/reputation/replies/[id]/post-google/route.ts`
- `src/app/api/reputation/sync/google/route.ts`

## Completed in this pass

### `/api/pilot-feedback`

Status: **hardened**

Changes now covered by route tests:

- Facility-scoped POST checks `serviceRoleUserHasFacilityAccess` before inserting.
- Facility-scoped GET checks `serviceRoleUserHasFacilityAccess` for non-org-wide reviewers.
- Owner/org-admin GET can filter by facility without per-facility lookup.
- Oversized text fields are trimmed before service-role insert.

## Remaining service-role audit queue

Priority order for next route-by-route hardening:

1. **Reputation OAuth / sync / post routes**
   - Routes: `reputation/**`, `cron/reputation/google-reviews`.
   - Risk: external provider tokens and public review replies.
   - Required check: confirm actor organization/facility ownership before token read/write, sync, or public reply; cron remains secret-gated and organization-scoped.

2. **Clinical write routes**
   - Routes: `care-plans/[id]/approve`, `controlled-substance/verify-co-sign`, `med-tech/incidents`, infection-control evaluate routes.
   - Risk: clinical state transitions, medication/incident safety workflow.
   - Required check: actor role + facility access + resident/facility match before service-role mutation.

3. **Document / AI narrative routes**
   - Routes: `knowledge/document-audit`, `knowledge/obsidian-draft`, `insurance/renewal-narrative`, `executive/standup/[week]/pdf`.
   - Risk: document visibility, AI-generated or exportable operational summaries.
   - Required check: route-specific role gate, organization match, facility access when facility-scoped, and explicit audit metadata.

4. **Admin facility rates route**
   - Route: `admin/facilities/[facilityId]/rates/[rateId]`.
   - Risk: financial configuration changes.
   - Required check: owner/org-admin/facility-admin role gate, facility access, rate belongs to requested facility and organization.

## Recommended shared cleanup

Implement a small shared API guard before continuing one-off patches:

- `requireApiActor()` — resolves session user + profile once.
- `requireReviewerRole(actor, roles)` — role allow-list helper.
- `requireFacilityAccess(actor, facilityId)` — wraps `serviceRoleUserHasFacilityAccess` and returns 404 on inaccessible facilities.
- `assertSameOrganization(row, actor.profile.organization_id)` — prevents cross-org service-role reads/writes.

Then convert the remaining routes to use those helpers and add route tests per risk class.
