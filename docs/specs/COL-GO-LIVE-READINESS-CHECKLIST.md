# Circle of Life / Haven — Go-Live Readiness Checklist

**Last updated:** 2026-05-11  
**Purpose:** Single operational checklist for getting Circle of Life ready to use Haven with real users and real facility data. This is not a feature wishlist; it is the minimum go-live evidence list.

## Current summary

| Area | Status | Notes |
|---|---:|---|
| Facility Launch Gate 0 | **SIGNED** | G0 Program Charter signed by Brian Lewis as Executive Sponsor on 2026-05-12. |
| Facility Launch Gate 2 | **BLOCKED** | Score 68/100. Blockers: data completeness under 95%, stale GL/property docs need routing/approval, rounds contradiction lacks owner, readiness below 90 target. |
| Supabase Pro plan | **CONFIRMED** | Owner confirmed 2026-05-11. |
| Supabase BAA | **CONFIRMED** | Owner confirmed 2026-05-11. |
| Supabase PITR / backup posture | **OPEN** | Must confirm in Supabase dashboard before PHI production reliance. |
| Jessica encrypted email test | **CONFIRMED** | Received 2026-05-12 from `jessicamurphy@circleoflifecommunities.com` via GoDaddy Advanced Email Security / `cloud-protect.net`; one-time-code reader flow worked; message expires in 30 days. |
| QuickMAR upload/import | **WAITING / FUTURE BUILD** | Samples received: `Brian MAR.xlsx` and `PatientMAR.pdf` (QuickMAR/eMAR PDF, 6 pages, text-extractable). Build path: upload/dropbox → parse → review queue → approved write with provenance. |
| User roles/access | **OPEN TONIGHT** | Need named users, roles, facility access, and least-privilege review. Facility Launch export shows M4 Employees / Users / Roles remains 25%. |
| Real data load plan | **PARTIAL** | Facility Launch JSON received 2026-05-12. M1 Company / Portfolio and M3 Rooms / Beds / Units are complete; M2 Facility Profile is partial; resident/staff/rate/care-plan/etc. records remain open. |
| UAT walkthrough | **OPEN TONIGHT** | Need live role-based walkthrough evidence. |
| Edge Functions / cron confirmation | **OPEN TONIGHT** | Prior repo docs show deployed/active as of 2026-04-10; re-confirm target production state before go-live. |

---

## 1. User roles and access matrix

**Goal:** Every production user has the correct role and only the access they need.

| Needed | Owner | Status | Notes |
|---|---|---:|---|
| Final list of production users | Brian / operations | ☐ | Name, email, phone if needed. |
| Assign app role per user | Brian / admin | ☐ | Owner, facility admin, caregiver, family, business office, executive, etc. |
| Assign facility access per user | Brian / admin | ☐ | Which facility/facilities each user can access. |
| Confirm admin users | Brian | ☐ | Who can create/edit/delete operational records. |
| Confirm caregiver users | Facility leader | ☐ | Who can use caregiver shell and resident workflows. |
| Confirm family portal users, if used | Facility leader | ☐ | Resident linkage required before invite. |
| Test wrong-role route blocking | Tester | ☐ | Caregiver/family should not open `/admin/*`. |
| Record first production login test | Tester | ☐ | Confirm each role lands in correct shell. |

### Minimum user role template

| Person | Email | Role | Facility access | Can view PHI? | Can edit PHI? | Notes |
|---|---|---|---|---|---|---|
|  |  |  |  |  |  |  |

---

## 2. Real data load plan

**Goal:** Know exactly what data enters first, who owns it, where it comes from, and how it will be validated.

| Data set | Required before go-live? | Source | Owner | Status | Notes |
|---|---:|---|---|---:|---|
| Organization / legal entities | Yes | Facility Launch Center JSON export | Brian | Captured — import-ready after validation | M1 is 100% complete. Captured operating LLC `Sorensen, Smith & Bay LLC`, property LLC `Homewood Property Company LLC`, and linked entity IDs. |
| Facilities | Yes | Facility Launch Center JSON export | Brian | Partial — validate/import | M2 is 63% complete. Captured Homewood Lodge ALF, FL/AHCA, capacity 36, main phone, ED, business office, mailing address. Missing license number, license expiration, physical/operating address confirmation, DON, maintenance director, after-hours phone. |
| Rooms / beds / units | Yes | Facility Launch Center JSON export | Facility admin | Captured — import-ready after validation | M3 is 100% complete: 20 rooms / 36 beds. Rooms 1–4 are private singles; rooms 5–20 are companion doubles; single floor/no wings. |
| Residents | Yes | Census/export/manual intake | Facility admin | ☐ | Name, DOB, room, payer/rate, care level, contacts. |
| Resident rates / payers | Yes | Business office | CFO/business office | ☐ | Needed for billing readiness. |
| Staff / employees | Yes | HR/staff roster | Facility admin / HR | ☐ | Needed for access, scheduling, compliance. |
| User accounts | Yes | User matrix | Brian / admin | ☐ | Must match roles/access above. |
| Family/responsible-party contacts | Recommended | Admission records | Facility admin | ☐ | Needed for family portal, notifications, emergency contact. |
| Medication/MAR data | Yes for med workflows | QuickMAR export | Facility admin / nurse | Waiting | QuickMAR build pending; do not auto-write without review. |
| Vendors / emergency contacts | Recommended | Facility ops list | Facility admin | ☐ | Utilities, pharmacy, physician contacts, emergency services. |
| Policies / compliance documents | Recommended | Facility docs | Admin / compliance | ☐ | Upload/source-of-truth later if document workflow is used. |

### Data load order

1. Organization, entities, facilities.
2. Rooms/beds/units.
3. Staff and user accounts.
4. Residents.
5. Resident rates/payers.
6. Responsible-party/family contacts.
7. Medication/MAR evidence after QuickMAR path is ready.
8. Vendors/emergency contacts.
9. Compliance/policy documents.

---

## 3. UAT walkthrough

**Goal:** Confirm the live app works for real users before relying on it operationally.

| Walkthrough area | Route / flow | Tester | Status | Notes |
|---|---|---|---:|---|
| Login — owner/admin | `/login` → `/admin` |  | ☐ | Confirm correct shell. |
| Login — caregiver | `/login` → `/caregiver` |  | ☐ | Confirm mobile usability. |
| Login — family, if used | `/login` → `/family` |  | ☐ | Confirm family can only see linked resident. |
| Admin dashboard | `/admin` |  | ☐ | Metrics/empty states load correctly. |
| Residents list/detail | `/admin/residents` |  | ☐ | Resident list and detail pages load. |
| Staff list/detail | `/admin/staff` |  | ☐ | Staff records load. |
| Incidents | `/admin/incidents` |  | ☐ | Create/view flow works if being used at launch. |
| Billing | `/admin/billing` |  | ☐ | Billing/rates visibility confirmed. |
| eMAR/medication shell | medication routes |  | ☐ | Confirm current limitation until QuickMAR import is built. |
| Caregiver resident workflow | `/caregiver/*` |  | ☐ | Confirm daily floor workflow usability. |
| Family messages/portal | `/family/*` |  | ☐ | Only if launch includes family access. |
| Wrong-role access test | caregiver/family → `/admin/*` |  | ☐ | Must deny/redirect. |
| Mobile viewport | caregiver routes on phone/tablet |  | ☐ | Required for floor staff adoption. |

---

## 4. Edge Functions, secrets, and cron confirmation

**Goal:** Confirm target production automation is active and using the right secrets.

| Item | Status | Evidence needed |
|---|---:|---|
| Supabase project is correct production project | ☐ | Project ref / URL confirmed. |
| Netlify env vars point to correct Supabase project | ☐ | Netlify dashboard or deploy env check. |
| Supabase Edge Function secrets present | ☐ | Supabase dashboard / CLI output. |
| Required Edge Functions deployed and active | ☐ | Supabase dashboard / CLI output. |
| Required pg_cron jobs registered | ☐ | SQL query / dashboard evidence. |
| Cron jobs are running on intended schedule | ☐ | Recent invocation evidence. |
| Notification secrets configured, if notifications used | ☐ | VAPID / dispatch secret confirmation. |
| Sentry/observability configured, if used | ☐ | Sentry project / DSN confirmation. |

### Functions previously documented as deployed/active

Prior repo records say Edge Functions and cron jobs were active as of 2026-04-10. Before go-live, re-check the current production target rather than relying on stale evidence.

---

## 5. Known waiting items

These are real, but they do not block tonight's checklist work.

| Item | Expected | Current action |
|---|---|---|
| Jessica encrypted email test | 2026-05-12 | **Confirmed.** GoDaddy Advanced Email Security delivered secure message from Jessica with one-time-code access. |
| QuickMAR upload/import build | After sample/flow confirmation | Build as a safe parser + review queue first; no direct live med overwrite. Current samples: Excel MAR workbook and PDF MAR export. |

---

## 6. Go-live KPI definitions for M19

**Purpose:** These are the ten management numbers leadership will watch during launch. Each KPI needs a data source, owner, target, threshold, and action if off-track.

| # | KPI | Business question | Data source | Owner | Cadence | Target | Launch threshold / action if off-track |
|---:|---|---|---|---|---|---|---|
| 1 | Occupancy | How full is the building? | Census / rooms-beds-residents | Executive Director / COO | Daily | Maintain target occupancy; for Homewood, compare occupied beds against 36-bed capacity. | If occupancy drops or open beds remain unfilled, review referral/admissions pipeline and discharge causes. |
| 2 | Revenue / Rate Completeness | Are residents being billed correctly? | Resident rates, payer records, billing system | CFO / Business Office | Daily during launch; weekly steady-state | 100% active residents have current payer, rate, and billing contact. | Any active resident missing payer/rate requires business-office correction. |
| 3 | Rounds Completion | Are required resident checks being completed on time? | Haven rounds/checks module | DON / Shift Lead | Daily at 9am huddle | 95%+ rounds completed on time. | Below 90% or missed high-risk resident round triggers same-day shift lead/DON review. |
| 4 | Incidents / Follow-Up Timeliness | Are falls/incidents reviewed and followed up? | Incident reports, follow-up tasks, RCA where applicable | ED / DON | Daily | No unreviewed major incidents; follow-ups completed by due date. | Any major incident or overdue follow-up escalates to ED/DON and, if needed, CFO/legal/broker. |
| 5 | Staffing Coverage | Are all required shifts covered with appropriate roles? | Schedule / staff assignments | Executive Director | Daily | 100% required shifts covered. | Any uncovered shift or missing credential coverage triggers backup staffing plan. |
| 6 | Medication / MAR Readiness | Do we have current medication/MAR visibility? | QuickMAR export / Haven medication import or manual review | DON | Daily | Latest MAR export received/reviewed daily. | Missed export or stale MAR triggers alert to Administrator, Assistant, Michelle, and Jessica. |
| 7 | Net Census Movement / Move-In Pipeline | Are we replacing discharges and filling open beds quickly enough? | Census, move-ins, discharges, admissions pipeline | Executive Director / COO | Daily | Maintain or grow occupied beds while keeping open rooms actively worked. | Any net census loss, stalled move-in, or unexpected vacancy triggers discharge/open-room/referral review. |
| 8 | Care Plan / ADL Review Completion | Do we have current care needs documented for each resident? | Care plans, ADL assessments | DON / Resident Care Director | Weekly; daily during launch cleanup | 100% active residents have current care level / ADL profile. | Any resident missing care level or service-plan basics gets assigned review owner and due date. |
| 9 | Family / Responsible-Party Contact Coverage | Can we reach the right person for every resident? | Responsible-party and emergency-contact records | Business Office Manager | Weekly; daily during launch setup | 100% active residents have responsible party, emergency contact, and communication preference. | Missing contact/authority/privacy status requires business office follow-up. |
| 10 | Staff Credential / Training Readiness | Are staff cleared and trained for assigned roles? | Staff roster, certifications, orientation, med-tech attestations | Executive Director / HR / DON | Weekly; daily during launch setup | 100% required staff have role-appropriate credential/training status documented. | Any staff member missing required credential/training is removed from restricted assignment or escalated to ED/DON. |


## Go-live decision rule

Do not call production PHI go-live complete until:

1. Pro plan and BAA are confirmed. **Done.**
2. PITR / backup posture is confirmed.
3. User roles/access matrix is complete.
4. Initial real data load plan is complete.
5. UAT walkthrough has PASS evidence for the launch scope.
6. Facility Launch Gate 2 is signed or explicitly waived for launch scope.
7. Edge Functions, secrets, and cron jobs are confirmed on the target production project.
8. Jessica encrypted email test is complete. **Done 2026-05-12.**
9. QuickMAR import is either built/reviewed or explicitly deferred with a manual medication/MAR workaround.
