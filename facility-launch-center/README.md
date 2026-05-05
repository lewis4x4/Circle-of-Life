# Facility Launch Center

Dependency-light static Facility Launch Center for the Homewood onboarding pilot. The app is a private Facility DNA command center: it learns the facility, captures structured evidence, exposes what is ready/blocked/owned, and exports an executive readiness packet.

## Run locally

From `facility-launch-center/`:

```bash
npm run serve
```

Open `http://localhost:8080`.

Do **not** rely on opening `index.html` directly. The app uses ES modules, and browser `file://` module loading is inconsistent.

## What’s implemented

- Facility Command Center with Launch Narrative / Executive Summary.
- Editable Program Setup / Charter for sponsor, deputy, CFO, COO, onboarder, document custodian, Definition of Live, thresholds, and Homewood scope.
- Owner Worksheet for all 19 modules with owner/source/due/scope/open questions plus module status (`not_started`, `assigned`, `in_progress`, `ready_for_review`, `signed`, `blocked`).
- Readiness Map hero cards showing owner, scope, status, score/completeness, evidence count, stale count, contradiction count, exception count, and next action.
- Complete Intake / Facility DNA workspace with structured capture for all 19 modules:
  - M1 Company / Portfolio.
  - M2 Facility Profile.
  - M3 Rooms / Beds / Units.
  - M4 Employees / Users / Roles.
  - M5 Residents.
  - M6 Resident Rates / Billing / Payer.
  - M7 Care Levels / Service Plans / ADLs.
  - M8 Rounds / Checks / Care Tasks.
  - M9 Schedules / Shifts / Assignments.
  - M10 Medications.
  - M11 Dining / Meals / Dietary.
  - M12 Activities / Life Enrichment.
  - M13 Maintenance / Work Orders / Assets.
  - M14 Admissions / Sales / Move-In Pipeline.
  - M15 Family / Responsible-Party Portal.
  - M16 Incidents / Risk / Claims Awareness.
  - M17 Documents / Insurance / Compliance.
  - M18 Vendors / Contacts / Emergency.
  - M19 Reports / Dashboards / KPIs.
- Each operational module has a purpose statement, checklist, source/owner fields, record-entry form, record table, and deterministic completeness scoring.
- Local document intake row with file-name capture plus manual metadata; no parser/backend.
- Source-of-truth resolver that only accepts document IDs within the selected group.
- Exceptions with approver name and approver role capture.
- Contradictions with generic fields plus structured Homewood rounds Policy vs Reality vs App Setting capture.
- Gate Checks for G0 and G2 with required signer role, signer name/role capture, timestamp, criteria snapshot, and exceptions relied upon.
- Executive markdown + JSON export including signed gates, criteria snapshots, exceptions, contradiction summary, source-of-truth decisions, and recent decision log excerpts.
- Guarded `localStorage` persistence with in-memory fallback if browser storage is blocked.

## Verification

From `facility-launch-center/`:

```bash
npm run verify
```

This runs:

1. `node --check` on every JavaScript module and script.
2. `scripts/smoke-static.mjs`, which serves the app over local HTTP and confirms `index.html`, CSS, and module imports resolve.
3. `scripts/verify.mjs`, which executes an end-to-end seeded remediation flow covering Gate 0, all 19 module intake surfaces, resident/rate/rounds/dining/vendor/KPI records, owner worksheet statuses, document intake/metadata, source-of-truth validation, approved exceptions, structured contradictions, Gate 2 signing, and executive export content.

## Demo walkthrough

1. Click **Reset Demo**.
2. Start at **Facility Command Center**:
   - Read the north-star narrative: Homewood evidence becomes a verified Facility DNA operating model.
   - Confirm Homewood-specific complexity is visible: dual entities, stale docs, duplicate docs, rounds contradiction, claims-awareness routing.
3. Open **Program Charter**:
   - Edit sponsor/deputy/CFO/COO/onboarder/document custodian.
   - Edit Definition of Live, thresholds, and Homewood scope.
   - Watch Gate 0 checklist update.
4. Open **Owner Worksheet**:
   - Fill owner/source/due/status/next action for incomplete rows, or document an approved module exception.
5. Open **Complete Intake / Facility DNA**:
   - M1: complete parent/DBA/operating/property/contact/time-zone fields.
   - M2: complete license/address/phone/capacity/floors/wings/leadership/emergency fields and confirm operating address.
   - M3: add a representative room with floor, wing, type, bed count, care designation, status; fill bed/unit totals.
   - M4: add a representative employee with role/credential/login metadata and role coverage notes.
   - M5-M19: enter residents, rates, care plans, rounds, schedules, meds, dining, activities, maintenance, admissions, family contacts, incident workflows, vendors, and executive KPIs.
6. Open **Document Intake**:
   - Add a local intake row manually or choose a file to capture its name.
   - Set artifact type, entity/facility, term/effective/expiration, currency, approval, confidence/notes.
   - Resolve GL and property duplicate groups by selecting one source-of-truth in each group.
   - Route stale docs or request/approve exceptions.
7. Open **Contradictions**:
   - Review the Homewood rounds Policy vs Reality vs App Setting fields.
   - Assign owner/decision owner and add resolution notes when ready.
8. Open **Readiness Map**:
   - Use cards to see score/completeness, owner, evidence, stale docs, contradictions, exceptions, and next action for each module.
9. Open **Gate Checks**:
   - Confirm G0/G2 criteria pass.
   - Enter signer name and role, then sign G0/G2.
10. Open **Export**:
   - Generate markdown/JSON readiness packet for executive review.
   - Confirm it includes launch narrative, signed gate records, criteria snapshot, exceptions relied upon, source-of-truth decisions, contradiction summary, and recent decision log excerpts.

## Static deployment handoff

See `PRODUCTION_HANDOFF.md` before deploying.

Short version:

- Publish **only** the contents of `facility-launch-center/` as the static root.
- Host privately over HTTPS with access control.
- Keep `robots.txt` and the `noindex` meta tag.
- Use no-store/no-cache policies because assets are not content-hashed.
- Run `npm run verify` before deployment.
- Run the post-deploy smoke checklist in `PRODUCTION_HANDOFF.md` after deployment.

## Data handling and security warning

This prototype stores all state in browser `localStorage` with an in-memory fallback. It has no backend auth, encryption, server-side access control, audit service, or real document storage.

Treat all entered data and exports as confidential. Do **not** enter real PHI, sensitive employee data, payment/bank data, claims narratives, legal strategy, or production-sensitive documents unless the app is hosted privately and data handling has been approved.

Sensitive examples include:

- Employee names, phone numbers, credentials.
- Resident/family/payer fields if added during demo.
- Insurance, claim, and litigation metadata.
- File names that disclose facility risk or coverage.
- Markdown/JSON readiness exports.

## Practical local verification checklist

- [ ] App loads over `http://localhost:8080` with no console syntax errors.
- [ ] Command Center explains Facility DNA, readiness, blockers, ownership, and recent changes.
- [ ] Program Charter edits affect Gate 0.
- [ ] Owner Worksheet includes module status select.
- [ ] M1-M19 have structured onboarding capture, not just notes.
- [ ] Document intake can add a local metadata row and capture a file name.
- [ ] Source-of-truth resolver rejects out-of-group document IDs.
- [ ] Exceptions capture approver name/role.
- [ ] Contradictions show Policy vs Reality vs App Setting for Homewood rounds.
- [ ] Readiness Map cards show owner/scope/status/score/evidence/stale/contradiction/exception/next action.
- [ ] Gate signing stores signer, role, timestamp, criteria snapshot, and relied-upon exceptions.
- [ ] Export generates executive-ready markdown + JSON and logs export action.

## Current architecture limits

- Pure client-side state (`localStorage` with fallback), no backend auth/workflows.
- File input captures file names/metadata only; no upload storage or parsing.
- Static app demonstrates and supports the complete onboarding capture workflow; backend persistence/auth/file automation would need to be wired if this becomes a multi-user PHI/PII production system.
