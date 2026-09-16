# Closing the merged-but-unapplied migration gap (COL-444)

**Date:** 2026-09-16
**Projects:** production `manfqmasfqppukpobpld`, Haven HFO Staging `iwcnajanvjvynolltflw`
**Trigger:** `migrations:verify:ledger` reported five unapplied on production and seven on staging while applying 411 for COL-438.

## The real hole

`care_events`, `care_event_deliveries` and `care_event_escalation_policies` **did not exist in either environment**, while the caregiver "Something happened" flow that writes to them has been on `main` and deployed. The flow's only write path is a direct PostgREST RPC call to `submit_care_event` from the browser — so it could not have worked in production. Confirmed absent by catalog query before applying, not inferred from the ledger.

## What each file turned out to need

Existence of an object is not evidence a migration ran. Checking function *bodies* separated these two cases:

| Migration | Staging before | Production before | Action |
|---|---|---|---|
| 387 shell actor | function existed but body had **no** `must_change_password` | applied (recorded `20260915182400`) | applied to staging |
| 388 bed occupancy | fully present, 0 stranded beds | applied | ledger row only |
| 400–403 care events | absent | absent | **applied to both** |
| 410 assessment hold | fully present | fully present | ledger row only |

410 was already applied in both environments by the COL-430 session and only lacked its ledger row. Re-running it failed on `42701 column "held_reason" of relation "assessment_templates" already exists` — it is not transaction-wrapped, so a blind retry is not safe. The correct response was to verify each object, not to force it.

## Order applied

Staging first, in dependency order, then production:

```
staging:     387, (388 ledger), 400 → 401 → 402 → 403, (410 ledger)
production:  400 → 401 → 402 → 403, (410 ledger)
```

Each file carries its own `NOTIFY pgrst, 'reload schema';`. Applied with
`supabase db query --linked -f <file>` from a **dedicated worktree** linked
explicitly to the intended project — the shared checkout's link changed twice
during this session.

## Verification

Identical on both environments after the run:

```
tables      care_event_deliveries, care_event_escalation_policies, care_events
functions   12
policies    8
RLS enabled 3 of 3
escalation_policies seeded   12
care_events rows             0
```

- `submit_care_event(p_payload jsonb)` and `append_care_event_note(p_care_event_id, p_note, p_photo_path)` match `src/lib/care-events/submit.ts` exactly.
- `care_event_derive('fall', …)` returns `level 2`, `fall_without_injury`.
- **PostgREST cache confirmed live**: unauthenticated `POST /rest/v1/rpc/submit_care_event` on production returns **401, not 404**. A 404 would mean the schema cache never reloaded and the surface is invisible to the app.
- `npm run migrations:verify:ledger` and `-- --staging` both **PASS**.

## Ledger format

Every row recorded as bare number + stem:

```
400=care_events   401=care_events_rls   402=care_events_functions
403=care_events_seed_col   410=assessment_instrument_hold
411=facility_identity_health_scope_comment
```

Never the timestamp version, never a name carrying its own `NNN_` prefix — `check-migration-ledger.mjs` matches on version then name, and a prefixed name matches neither, so the migration reads as unapplied. See CLAUDE.md § Migrations.

## Left alone

`care_events` has zero rows in both environments. The tables are live but nothing has been written through them yet; the caregiver flow still needs a real end-to-end smoke on a device before it is relied on.
