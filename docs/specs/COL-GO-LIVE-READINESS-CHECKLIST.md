# Circle of Life / Haven — Go-Live Readiness Checklist

**Last updated:** 2026-05-11  
**Purpose:** Single operational checklist for getting Circle of Life ready to use Haven with real users and real facility data. This is not a feature wishlist; it is the minimum go-live evidence list.

## Current summary

| Area | Status | Notes |
|---|---:|---|
| Supabase Pro plan | **CONFIRMED** | Owner confirmed 2026-05-11. |
| Supabase BAA | **CONFIRMED** | Owner confirmed 2026-05-11. |
| Supabase PITR / backup posture | **OPEN** | Must confirm in Supabase dashboard before PHI production reliance. |
| Jessica encrypted email test | **CONFIRMED** | Received 2026-05-12 from `jessicamurphy@circleoflifecommunities.com` via GoDaddy Advanced Email Security / `cloud-protect.net`; one-time-code reader flow worked; message expires in 30 days. |
| QuickMAR upload/import | **WAITING / FUTURE BUILD** | Samples received: `Brian MAR.xlsx` and `PatientMAR.pdf` (QuickMAR/eMAR PDF, 6 pages, text-extractable). Build path: upload/dropbox → parse → review queue → approved write with provenance. |
| User roles/access | **OPEN TONIGHT** | Need named users, roles, facility access, and least-privilege review. |
| Real data load plan | **OPEN TONIGHT** | Need source files/owners/order for facilities, rooms, residents, staff, rates/payers, contacts, vendors, and policies. |
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
| Organization / legal entities | Yes | Facility Launch Center intake / owner confirmation | Brian | Captured — validate/import | Owner states facility/entity data is captured in the Facility Launch Center; validate from JSON export before production import. |
| Facilities | Yes | Facility Launch Center intake / owner confirmation | Brian | Captured — validate/import | Owner states facility data is captured in the Facility Launch Center; validate from JSON export before production import. |
| Rooms / beds / units | Yes | Facility Launch Center intake | Facility admin | Captured — validate/import | Facility Launch export reports M3 Rooms / Beds / Units at 100% completeness; validate actual room/bed rows from JSON export before production import. |
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

## Go-live decision rule

Do not call production PHI go-live complete until:

1. Pro plan and BAA are confirmed. **Done.**
2. PITR / backup posture is confirmed.
3. User roles/access matrix is complete.
4. Initial real data load plan is complete.
5. UAT walkthrough has PASS evidence for the launch scope.
6. Edge Functions, secrets, and cron jobs are confirmed on the target production project.
7. Jessica encrypted email test is complete. **Done 2026-05-12.**
8. QuickMAR import is either built/reviewed or explicitly deferred with a manual medication/MAR workaround.
