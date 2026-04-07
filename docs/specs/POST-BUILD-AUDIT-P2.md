# Post-build audit — P2 issues (documented for follow-up)

**Audit passes:** 2026-04-06 (pass 1) + 2026-04-07 (pass 2)
**Gate artifacts:**
- `test-results/agent-gates/2026-04-06T23-53-25-186Z-post-build-audit-fixes.json`
- `test-results/agent-gates/2026-04-07T00-02-18-609Z-audit-pass-2-fixes.json`

P0 and P1 issues were fixed across both sessions. The items below are medium-priority and should be addressed in future segments.

---

## Database schema

| Table | Issue | Severity | Fix |
|-------|-------|----------|-----|
| `user_profiles` | `organization_id` is nullable — `haven.organization_id()` RLS helper returns NULL if unset, weakening tenant isolation | **High** | Backfill NULLs, then `ALTER TABLE user_profiles ALTER COLUMN organization_id SET NOT NULL;` |
| `vendor_po_sequences` | RLS enabled but no policies defined (default deny — works but intent is ambiguous) | Medium | Add explicit `CREATE POLICY vendor_po_sequences_deny_all ON vendor_po_sequences FOR ALL USING (false);` or document SECURITY DEFINER intent |
| `family_portal_messages` | No index on `author_user_id` (staff/family "my threads" queries) | Medium | `CREATE INDEX idx_family_portal_messages_author ON family_portal_messages (author_user_id, created_at DESC) WHERE deleted_at IS NULL;` |
| `ai_invocations` | No index on `created_by` (per-user audit queries) | Medium | `CREATE INDEX idx_ai_invocations_created_by ON ai_invocations (created_by, created_at DESC);` |
| `residents.code_status` | `text` column — life-safety-adjacent; enum or CHECK reduces bad values | Medium | `ALTER TABLE residents ADD CONSTRAINT chk_code_status CHECK (code_status IN ('full_code', 'dnr', 'dnr_comfort', 'limited_code', 'other'));` |
| `assessments.assessment_type` | `text NOT NULL` — high variance in clinical reporting | Medium | Add CHECK constraint or lookup table |
| `family_consent_records.consent_type` | `text NOT NULL` — legal/consent audit trail | Medium | Enum or FK to `consent_type_definitions` |
| `collection_activities.activity_type` | `text NOT NULL` — collections reporting | Medium | Enum or CHECK constraint |
| `incident_followups.task_type` | `text NOT NULL` — incident workflow | Medium | Enum aligned with workflow |
| Multiple tables | FKs to `auth.users` and `residents` missing `ON DELETE` clause — intentional for retention but document the deletion strategy | Low | Document soft-delete as canonical; add explicit `ON DELETE RESTRICT` where hard-delete prevention is the goal |

---

## Frontend

| File | Issue | Severity |
|------|-------|----------|
| `src/app/api/controlled-substance/verify-co-sign/route.ts` | **Fixed in Track B:** in-memory failure limiter now returns `429` + `Retry-After` after repeated failures; remaining gap is distributed/shared-store enforcement across instances | Medium |
| Multiple files | `as unknown as` type assertion chains (billing, incidents, admin) weaken compile-time safety | Medium |
| `src/app/(admin)/residents/[id]/page.tsx` (~1010 lines) | Large client component — split by section when touched | Low |
| Rare use of `Suspense` in `src/` | Most routes are client-heavy; streaming boundaries are optional but would improve perceived perf | Low |

---

## Edge Functions

| Item | Issue | Severity | Notes |
|------|-------|----------|-------|
| `_shared/cors.ts` | Now supports `CORS_ALLOWED_ORIGINS` env var but defaults to `*` when unset | Medium | Set `CORS_ALLOWED_ORIGINS` to app domain(s) in Supabase secrets to activate |
| Secret comparison | Not constant-time (timing side channel) — low risk for cron-only callers | Low | Use `crypto.subtle.timingSafeEqual` if moving to user-facing secret auth |

---

## Auth and middleware

| File | Issue | Severity |
|------|-------|----------|
| `src/app/login/page.tsx` | **Fixed:** login now honors safe internal `?next=` values and falls back to role-based shell routing when absent/invalid | Low |
| `src/proxy.ts` | No CSRF layer for cookie session + POST APIs — protection relies on SameSite cookies only | Low |
| Shell UI components (`AdminShell`, `CaregiverShell`, `FamilyShell`) | No client-side auth re-redirect as defense-in-depth if proxy is bypassed or misconfigured | Low |

---

## Async race conditions (stale state after unmount)

Many pages use `useEffect(() => { void load(); }, [load])` with no `cancelled` flag or `AbortController`. In practice, stale updates are a React warning, not a data corruption risk, but they should be addressed as pages are touched.

| File | Function | Notes |
|------|----------|-------|
| `src/app/(admin)/finance/journal-entries/[id]/page.tsx` | `load` | Multi-step setState after awaits |
| `src/app/(admin)/search/page.tsx` | `runSearch` | Results can commit after route change |
| `src/components/compliance/SurveyVisitModeBar.tsx` | `refresh` | Parallel queries, no unmount guard |
| `src/components/compliance/SurveyVisitSearchOverlay.tsx` | `loadChart` | Wrong chart vs selected resident if requests complete out of order — highest risk item for audit accuracy |
| `src/app/(caregiver)/resident/[id]/page.tsx` | `load` | Profile + vitals queries |
| `src/app/(admin)/admin/family-messages/page.tsx` | `loadThreads` | Thread list |

---

## Operational

| Item | Severity |
|------|----------|
| Error tracking is wired in code, but production DSN/source-map env setup is still manual | Medium — see [OBSERVABILITY-SPEC.md](./OBSERVABILITY-SPEC.md) |
| No unit/E2E test tree in repo (relies on segment:gates + manual UAT) | High — see [CI-HARDENING-SPEC.md](./CI-HARDENING-SPEC.md) |
| Mission statement references home health + HCBS but implementation skews ALF/admin-heavy | Medium — intentional pilot scope; track for Phase 7+ |
| `shadcn` package in `dependencies` but unused at runtime — move to `devDependencies` or remove | Low |
