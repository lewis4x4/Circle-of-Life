# Haven — UI Design Decisions

**This document defines every UI architectural decision that affects code structure.** It does not prescribe visual design (that's yours). It prescribes the structural, behavioral, and technical decisions that must be consistent across every screen Claude Code builds.

Canonical lock: if this file conflicts with `FRONTEND-CONTRACT.md`, the contract file wins.

---

## 1. TECHNOLOGY STACK

| Layer | Technology | Version | Notes |
|-------|-----------|---------|-------|
| Framework | React | 18+ | |
| Language | TypeScript | 5+ | Strict mode. No `any` types. |
| Styling | Tailwind CSS | 3+ | Utility-first. No custom CSS files except for animations/transitions that Tailwind can't handle. |
| Components | shadcn/ui | Latest | Base component library. Customize via Tailwind theme tokens, not by forking components. |
| Icons | Lucide React | Latest | Consistent icon set. No mixing icon libraries. |
| State (client) | React Query (TanStack Query) | 5+ | All server state. Caching, background refetch, optimistic updates. |
| State (local) | Zustand | Latest | UI-only state: sidebar open/closed, selected facility, current shift, form drafts. |
| Forms | React Hook Form + Zod | Latest | All forms validated with Zod schemas that mirror the API request shapes from the specs. |
| Routing | Next.js App Router | 16+ | Do not introduce React Router/TanStack Router alongside Next routing. |
| Date/Time | date-fns | Latest | All date formatting and manipulation. Timezone conversion: `date-fns-tz` with `America/New_York`. |
| Charts | Recharts | Latest | Dashboard charts, trend lines, census graphs. |
| Tables | TanStack Table | Latest | Sortable, filterable, paginated data tables for admin views. |
| Offline | Workbox (service worker) + IndexedDB (via idb) | Latest | PWA offline queue and cache. |
| PDF | @react-pdf/renderer or jsPDF | Latest | Invoice generation, incident report export, care plan printing. |
| Build | Next.js build pipeline | 16+ | `next build` via npm scripts in this repo |
| Deploy | Next-compatible host | | Keep deployment platform aligned with Next.js runtime requirements |

---

## 2. THREE LAYOUT SHELLS

Every screen in the app uses one of exactly three layout shells. No exceptions.

### Shell A: Admin Dashboard (Web)

**Users:** owner, org_admin, facility_admin, nurse
**Viewport:** Desktop-first (1280px+), responsive down to 1024px. Below 1024px, sidebar collapses to icon-only.

```
┌──────────────────────────────────────────────────────┐
│  TOP HEADER                                          │
│  [Logo]  [Facility Selector ▼]  [Search]  [🔔] [👤] │
├────────────┬─────────────────────────────────────────┤
│            │                                         │
│  SIDEBAR   │  MAIN CONTENT AREA                      │
│            │                                         │
│  Dashboard │  ┌─────────────────────────────────┐    │
│  Residents │  │  Page Header + Breadcrumbs      │    │
│  Schedule  │  ├─────────────────────────────────┤    │
│  Incidents │  │                                 │    │
│  Staff     │  │  Page Content                   │    │
│  Billing   │  │                                 │    │
│  Reports   │  │                                 │    │
│  Settings  │  │                                 │    │
│            │  └─────────────────────────────────┘    │
│            │                                         │
└────────────┴─────────────────────────────────────────┘
```

**Sidebar navigation items (Phase 1):**
- Dashboard (facility overview)
- Residents (list, profiles, care plans, assessments)
- Daily Operations (shift view, handoffs, eMAR overview)
- Incidents (list, dashboard, trends)
- Staff (directory, certifications, schedules, time records)
- Billing (invoices, payments, AR aging)
- Settings (facility config, rate schedules, user management)

**Top header components:**
- **Facility Selector:** Dropdown showing all facilities the user can access. Selecting a facility scopes ALL data on all pages to that facility. For owner/org_admin, includes an "All Facilities" option for org-wide views. Selected facility persists in Zustand store and survives page navigation. This is the most important UI control in the app.
- **Notification bell:** Unread count badge. Dropdown shows recent alerts (overdue assessments, certification expirations, staffing ratio violations, incident follow-ups due). Tap to navigate to the relevant item.
- **User menu:** Profile, preferences, logout.

### Shell B: Caregiver Mobile (PWA)

**Users:** caregiver (CNA, LPN on the floor)
**Viewport:** Mobile-first (375px). Must work on: iPhone SE (375px), standard phones (390-430px), small tablets (768px). Nothing larger — caregivers don't use desktops.

```
┌─────────────────────────┐
│  SHIFT HEADER            │
│  [Oakridge ALF] Day Shift│
│  7:00 AM - 3:00 PM       │
│  [Sync ●]  [🔔 3]        │
├─────────────────────────┤
│                          │
│                          │
│  MAIN CONTENT            │
│  (scrollable)            │
│                          │
│                          │
│                          │
│                          │
│                          │
├─────────────────────────┤
│  BOTTOM TAB BAR          │
│  [🏠] [💊] [📋] [⚠️] [👤]│
│  Home  Meds  Log  Alert  Me│
└─────────────────────────┘
```

**Bottom tab navigation:**
- **Home:** Shift dashboard. My assigned residents. Pending tasks. Unacknowledged handoff alert.
- **Meds:** Medication pass view. Medications due now, upcoming, overdue. Tap resident → see their meds → document.
- **Log:** Quick documentation. Select resident → ADL buttons, daily log, behavioral event, condition change.
- **Alert:** Incident reporting. Active incidents. My follow-up tasks. PRN effectiveness checks due.
- **Me:** My schedule, clock in/out, swap board, my profile.

**Shift header components:**
- **Facility name + shift:** Always visible. Confirms the caregiver's current context.
- **Sync indicator:** Green dot = online and synced. Yellow dot = online, sync in progress. Red dot = offline, items queued. Tap for sync detail (X items pending upload).
- **Notification badge:** Count of actionable items (meds due, follow-ups due, handoff to acknowledge).

**Critical mobile design constraints:**
- Minimum touch target: 44×44px (Apple HIG). Caregivers wear gloves. Fat fingers. Moving fast.
- No hover states. Everything is tap or swipe.
- Text minimum 16px body, 14px secondary. Caregivers are 20-65 years old with variable vision.
- High contrast mode support. Facility lighting varies (bright dining room, dim hallway at night).
- One-hand operation assumed. Primary actions reachable with right thumb in bottom 60% of screen.
- No modals that block the full screen. Use bottom sheets that can be dismissed by swipe-down.
- Loading states must be obvious. Skeleton screens, not spinners. Caregiver needs to know if data is stale.

### Shell C: Family Portal (Web + Mobile Responsive)

**Users:** family members
**Viewport:** Responsive. Desktop (1280px+) and mobile (375px+). Most family members access from phones.

```
Desktop:
┌──────────────────────────────────────────────┐
│  HEADER                                      │
│  [Haven Logo]  [Resident Name]  [🔔]  [👤]   │
├──────────────────────────────────────────────┤
│                                              │
│  ┌────────────────────────────────────────┐  │
│  │  NAVIGATION TABS                       │  │
│  │  [Today] [Care Plan] [Messages]        │  │
│  │  [Calendar] [Billing] [Documents]      │  │
│  ├────────────────────────────────────────┤  │
│  │                                        │  │
│  │  CONTENT                               │  │
│  │                                        │  │
│  └────────────────────────────────────────┘  │
│                                              │
└──────────────────────────────────────────────┘

Mobile:
┌─────────────────────────┐
│  [Haven]  Mom  [🔔] [👤] │
├─────────────────────────┤
│                          │
│  CONTENT                 │
│  (scrollable)            │
│                          │
├─────────────────────────┤
│  [Today][Care][Chat][💰] │
└─────────────────────────┘
```

**Navigation:**
- **Today:** Daily summary (AI-generated in Phase 5, manual summary in Phase 1). Meals, activities, mood, notable events.
- **Care Plan:** Read-only view of current care plan summary. Assessment trends (charts). No clinical jargon — translated to family-friendly language.
- **Messages:** Secure messaging with facility staff. Threaded. Timestamped.
- **Calendar:** Upcoming appointments, family council meetings, facility events. RSVP.
- **Billing:** Invoices and payment history (Phase 1 view-only). Online payment integration is deferred to a later phase.
- **Documents:** Admission agreement, care plan summary, advance directives. Upload capability for family documents.

**Family portal design constraints:**
- Warm, not clinical. This is a product for anxious adult children, not healthcare professionals.
- No acronyms. No clinical abbreviations. "ADL" → "Daily Living Activities". "eMAR" never appears.
- Photo of their resident prominently displayed.
- "Last updated" timestamp on every data section so family knows information is current.
- Contact button always accessible — one tap to send a message to the facility.

---

## 3. FACILITY SELECTOR — ARCHITECTURAL COMPONENT

This is not a simple dropdown. It's the data scoping mechanism for the entire app.

**State management:**
```typescript
// Zustand store
interface FacilityStore {
  selectedFacilityId: string | null;    // null = "All Facilities" (owner/org_admin only)
  selectedFacility: Facility | null;
  availableFacilities: Facility[];
  setSelectedFacility: (id: string | null) => void;
}
```

**Behavior:**
- On login, if user has access to exactly 1 facility → auto-select it, hide the selector.
- On login, if user has access to 2+ facilities → show selector, default to primary facility.
- Owner/org_admin get an "All Facilities" option that shows aggregated data on dashboards and lists across facilities.
- Changing the selected facility immediately re-fetches all visible data. React Query cache is keyed by facility_id.
- Selected facility persists in localStorage across sessions.
- The facility selector appears in the top header of Shell A. In Shell B (mobile), the facility is set at clock-in and cannot be changed mid-shift without clocking out.

**React Query key pattern:**
```typescript
// All queries include facilityId in the key
queryKey: ['residents', facilityId, { status, search, page }]
queryKey: ['incidents', facilityId, { category, severity, dateRange }]
queryKey: ['emar', facilityId, residentId, { date }]
```

---

## 4. COLOR SYSTEM & STATUS TOKENS

Define these as Tailwind theme extensions. Every status indicator in the app uses these tokens — never raw color values.

### Acuity Levels
| Level | Token | Usage | Suggested Palette Direction |
|-------|-------|-------|---------------------------|
| Level 1 (minimal) | `acuity-1` | Badges, room indicators, census cards | Cool/calm (green or blue family) |
| Level 2 (moderate) | `acuity-2` | Same | Warm/attention (amber or yellow family) |
| Level 3 (extensive) | `acuity-3` | Same | Alert (orange or red family) |

### Incident Severity
| Severity | Token | Usage |
|----------|-------|-------|
| Level 1 | `severity-1` | Incident badges, trend charts | Low intensity |
| Level 2 | `severity-2` | Same | Medium |
| Level 3 | `severity-3` | Same | High |
| Level 4 | `severity-4` | Same | Critical — most intense color in the system |

### Bed Status
| Status | Token | Usage |
|--------|-------|-------|
| Available | `bed-available` | Census board, room maps | Should read as "open/ready" |
| Occupied | `bed-occupied` | Same | Neutral/filled |
| Hold | `bed-hold` | Same | Paused/waiting |
| Maintenance | `bed-maintenance` | Same | Out of service |

### eMAR Status
| Status | Token | Usage |
|--------|-------|-------|
| Scheduled | `emar-scheduled` | Medication pass list | Neutral/pending |
| Given | `emar-given` | Same | Success/complete |
| Refused | `emar-refused` | Same | Warning — needs attention but not an error |
| Held | `emar-held` | Same | Paused |
| Not Available | `emar-unavailable` | Same | Problem |

### Compliance Score
| Range | Token | Usage |
|-------|-------|-------|
| 90-100% | `compliance-good` | Compliance dashboard, survey readiness | |
| 70-89% | `compliance-warning` | Same | |
| <70% | `compliance-critical` | Same | |

### Cognitive Load (Phase 5, but define tokens now)
| Range | Token | Usage |
|-------|-------|-------|
| 0-5 | `load-low` | Caregiver shift dashboard | |
| 5-7 | `load-moderate` | Same | |
| 7-10 | `load-high` | Same | |

### General Status
| Status | Token | Usage |
|--------|-------|-------|
| Success/Active | `status-success` | Toast notifications, status badges | |
| Warning | `status-warning` | Expiring certs, approaching thresholds | |
| Error/Critical | `status-error` | Overdue items, ratio violations, expired certs | |
| Info | `status-info` | Informational alerts, tips | |
| Neutral | `status-neutral` | Inactive, archived, default state | |

### Tailwind Theme Extension Structure
```javascript
// tailwind.config.js
module.exports = {
  theme: {
    extend: {
      colors: {
        acuity: {
          1: { DEFAULT: '...', light: '...', dark: '...' },
          2: { DEFAULT: '...', light: '...', dark: '...' },
          3: { DEFAULT: '...', light: '...', dark: '...' },
        },
        severity: {
          1: { DEFAULT: '...', light: '...', dark: '...' },
          2: { DEFAULT: '...', light: '...', dark: '...' },
          3: { DEFAULT: '...', light: '...', dark: '...' },
          4: { DEFAULT: '...', light: '...', dark: '...' },
        },
        // ... same pattern for all status tokens
      }
    }
  }
}
```

You define the actual hex values. The token names are fixed — code references `bg-acuity-1`, `text-severity-3`, `border-compliance-warning` everywhere. Change the hex once in the config, every screen updates.

---

## 5. COMMON COMPONENT PATTERNS

These are the repeating structural patterns. Not every component — the patterns that appear in every module.

### 5.1 Data Table (Admin)
Used in: Resident list, Staff directory, Invoice list, Incident list, Certification dashboard, Time records.

Structure:
- Filter bar above table (dropdowns, search input, date range)
- Column headers (sortable, click to sort)
- Row data with status badges
- Pagination below
- Row click → navigate to detail page
- Bulk action toolbar (appears when rows selected)

Use TanStack Table. Server-side pagination and filtering (not client-side — datasets will grow).

### 5.2 Detail Page (Admin)
Used in: Resident profile, Incident detail, Staff profile, Invoice detail.

Structure:
- Header: entity name, key identifiers, status badge, action buttons (Edit, Print, etc.)
- Tab navigation below header for sub-sections
- Content area changes based on selected tab
- Sticky header (name + tabs) on scroll

### 5.3 Quick-Entry Card (Mobile)
Used in: ADL logging, eMAR documentation, activity attendance.

Structure:
- Resident photo + name + room at top
- Large tap-target buttons for common actions
- Timestamp auto-captured on tap
- Expandable detail section (tap to add notes, select options)
- Confirmation feedback (checkmark animation, haptic if available)

### 5.4 Alert/Notification Card
Used in: Shift dashboard, notification dropdown, overdue task lists.

Structure:
- Severity color bar on left edge
- Icon indicating type (fall, medication, certification, staffing)
- Title (one line)
- Subtitle (timestamp, resident name, brief context)
- Action button (tap to navigate to relevant item)

### 5.5 Census Board
Used in: Facility dashboard, org dashboard.

Structure:
- Grid or card layout showing each room
- Room number prominently displayed
- Bed status color indicator
- Resident name (if occupied)
- Acuity badge
- Key risk indicators (fall risk icon, elopement risk icon)
- Tap room → navigate to resident profile

### 5.6 Form Pattern (Admin + Mobile)
All forms follow the same pattern:

- Zod schema defines validation
- React Hook Form manages state
- Submit button disabled until form is valid
- Inline validation errors below fields (not toasts for field-level errors)
- Success: toast notification + navigate away
- Error: toast notification + stay on form + highlight problem fields
- Auto-save drafts to localStorage every 30 seconds (for long forms like incident reports)
- Offline: queue submission, show "saved locally — will submit when online" indicator

---

## 6. OFFLINE ARCHITECTURE

### Service Worker Strategy (Workbox)

| Resource Type | Cache Strategy | Notes |
|--------------|---------------|-------|
| App shell (HTML, JS, CSS) | Cache-first, update in background | App loads instantly even offline |
| API GET requests (residents, care plans, medications, schedules) | Network-first with cache fallback | Fresh data when online, cached data when offline |
| API POST/PUT requests | Queue with background sync | Stored in IndexedDB, synced when online |
| Images (resident photos, documents) | Cache-first with size limit | LRU eviction when cache exceeds 50MB |
| Supabase real-time subscriptions | Online only | Graceful degradation: show "live updates paused" |

### Offline Queue (IndexedDB)

```typescript
interface OfflineQueueItem {
  id: string;                     // UUID
  endpoint: string;               // "/residents/uuid/adl-logs"
  method: 'POST' | 'PUT';
  body: Record<string, unknown>;
  created_at: string;             // ISO timestamp from device clock
  retry_count: number;
  last_error?: string;
  status: 'pending' | 'syncing' | 'failed' | 'synced';
}
```

**Sync behavior:**
- When connectivity resumes, queue processes in FIFO order (oldest first).
- Each item retries up to 3 times with exponential backoff.
- Failed items after 3 retries → status 'failed' → surface to user as "X items could not be saved — tap to review."
- Timestamp conflicts: if two offline devices documented the same eMAR record, the server rejects the duplicate and alerts the nurse for resolution.

### Sync Indicator Component

Appears in Shell B (caregiver mobile) header. Three states:

| State | Visual | Meaning |
|-------|--------|---------|
| Online + synced | Green dot | All data current, no pending uploads |
| Online + syncing | Yellow dot + upload arrow animation | Items being uploaded |
| Offline | Red dot + "Offline" text | No connectivity. Queue count shown: "3 items pending" |

Tapping the indicator opens a sync detail panel:
- Items pending upload (count by type: "2 ADL logs, 1 incident report")
- Last successful sync time
- "Sync now" button (manual retry)
- Failed items (if any) with "Review" link

---

## 7. RESPONSIVE BREAKPOINTS

```javascript
// tailwind.config.js — standard Tailwind breakpoints
// sm: 640px   — large phones landscape
// md: 768px   — tablets
// lg: 1024px  — small laptops, tablets landscape
// xl: 1280px  — standard desktops
// 2xl: 1536px — large desktops
```

| Shell | Primary Viewport | Responsive Down To |
|-------|-----------------|-------------------|
| Admin (Shell A) | xl (1280px) | lg (1024px). Below 1024px: sidebar collapses to icons. Below 768px: sidebar becomes hamburger menu. |
| Caregiver (Shell B) | 375px (mobile) | Fixed mobile layout. Does not scale up to desktop — caregivers don't use desktops. If accessed on a tablet (768px+), content area widens but navigation stays bottom tabs. |
| Family (Shell C) | Responsive | Full desktop layout at xl. Tab navigation switches to bottom bar at md and below. |

---

## 8. AUTHENTICATION FLOW

```
App loads
  → Check Supabase session
  → If no session → Login screen
  → If session exists → Fetch user_profile (app_role, organization_id)
    → Fetch user_facility_access (available facilities)
    → Route to appropriate shell:
        - app_role IN (owner, org_admin, facility_admin, nurse) → Shell A
        - app_role = caregiver → Shell B
        - app_role = family → Shell C
        - app_role IN (dietary, maintenance_role) → Shell A (limited sidebar items)
        - app_role = broker → Shell A (limited to insurance module — Phase 4)
```

**Login screen:** Email + password. No social login (healthcare app, HIPAA — keep it simple). "Forgot password" flow via Supabase email reset. No self-registration — all users are created by facility_admin or org_admin.

**Session management:**
- Token refresh handled by Supabase client automatically.
- Session timeout: 12 hours of inactivity (configurable). On timeout → redirect to login.
- "Remember me" checkbox: extends session to 30 days.

---

## 9. NOTIFICATION SYSTEM

### In-App Notifications

```typescript
interface Notification {
  id: string;
  user_id: string;
  type: string;              // "medication_due", "incident_followup", "cert_expiring", "staffing_alert", "care_plan_review", "ar_overdue"
  title: string;
  body: string;
  severity: 'info' | 'warning' | 'critical';
  facility_id: string;
  link_to: string;           // route to navigate to
  read: boolean;
  created_at: string;
}
```

**Delivery:**
- Supabase real-time subscription on a `notifications` table filtered by user_id.
- Desktop (Shell A): notification dropdown in header. Unread badge count. Sound for critical notifications (optional, user preference).
- Mobile (Shell B): notification badge on header. Full-screen notification for Level 3+ incidents involving assigned residents.
- Push notifications (Phase 2+): Web Push API for PWA. Required for: elopement alerts, staffing emergencies, shift callout requests.

### Email Notifications
Sent via transactional email service (SendGrid/Resend):
- Daily family summary (family portal)
- Invoice sent (family + responsible party)
- Payment receipt (family)
- Certification expiration reminders (staff + admin)
- Schedule published (staff)
- Incident notification (family, when severity warrants)

### SMS Notifications
Reserved for time-critical alerts only:
- Elopement alert (administrator, owner, on-call nurse)
- Staffing ratio violation (administrator)
- Shift callout (staff who might cover)
- Level 4 incident (owner)

---

## 10. KEY SCREEN STRUCTURES — PHASE 1

These are the screens that Claude Code needs to build in Phase 1, in build order. Each references the data spec file that defines the API it consumes.

### Week 1-2 Screens (Foundation)
1. Login page
2. Admin layout shell (sidebar + header + facility selector)
3. Caregiver layout shell (bottom tabs + shift header)
4. Facility dashboard (census board, key metrics cards, recent activity)
5. Admin settings shell placeholder (user management full CRUD deferred)

### Week 3-4 Screens (Residents)
6. Resident list (data table with search, filter by status/acuity/unit)
7. Resident profile (tabbed detail page)
8. Resident create/edit form
9. Care plan viewer/editor
10. Assessment entry form (dynamic, driven by assessment_templates)
11. Assessment history (timeline + score trend charts)
12. Overdue assessments list

### Week 5-6 Screens (Daily Operations)
13. Caregiver shift dashboard (assigned residents, pending tasks)
14. eMAR — medication pass view (meds due now, upcoming, overdue)
15. eMAR — document medication event (give, refuse, hold)
16. ADL quick-log (per resident, tap-to-complete buttons)
17. Daily log entry form
18. Behavioral event form
19. Condition change report form
20. Shift handoff view + acknowledge

### Week 7-8 Screens (Incidents)
21. Incident report form (step-through guided, mobile-first)
22. Incident list (data table, filterable)
23. Incident detail page (full record, photos, follow-ups)
24. Incident follow-up task list
25. Incident dashboard (facility-level trends, open/overdue counts)

### Week 9-10 Screens (Staff)
26. Staff directory (data table)
27. Staff profile (employment detail, certs, schedule, time records)
28. Staff create/edit form
29. Certification dashboard (grid: staff × cert type, status colors)
30. Schedule builder (7-day grid, drag-drop assignments)
31. Time records list + approve
32. Clock in/out (mobile, with GPS)
33. Shift swap board

### Week 11-12 Screens (Billing)
34. Rate schedule management
35. Resident billing setup (payer configuration)
36. Invoice list
37. Invoice detail (line items, payments, collection log)
38. Invoice generation wizard (preview, review, generate batch)
39. Payment entry form
40. AR aging report
41. Revenue summary dashboard

**Total Phase 1 screens: 41**

---

## 11. DATA FETCHING PATTERN

Every screen follows this pattern. No exceptions.

```typescript
// Example: Resident list
function ResidentList() {
  const { selectedFacilityId } = useFacilityStore();

  const { data, isLoading, error } = useQuery({
    queryKey: ['residents', selectedFacilityId, { status: 'active' }],
    queryFn: () => api.residents.list({ facility_id: selectedFacilityId, status: 'active' }),
    enabled: !!selectedFacilityId,
  });

  if (isLoading) return <TableSkeleton rows={10} />;
  if (error) return <ErrorState message="Could not load residents" retry={refetch} />;
  if (!data?.length) return <EmptyState icon={Users} message="No residents found" />;

  return <ResidentTable data={data} />;
}
```

**Rules:**
- Every query is keyed by `selectedFacilityId`. When facility changes, all queries automatically refetch.
- Loading state: skeleton screens matching the layout shape (not spinners).
- Error state: consistent error component with retry button.
- Empty state: consistent empty component with relevant icon and message.
- No data fetching in useEffect. All fetching through React Query.
- Mutations use `useMutation` with `onSuccess` invalidating relevant query keys.

---

## 12. FILE STRUCTURE (Next.js App Router)

```
src/
  app/
    (admin)/
    (caregiver)/
    (family)/
    login/
    layout.tsx
    page.tsx
  components/
    ui/                     # shadcn/ui components (Button, Input, Dialog, etc.)
    layout/
      AdminShell.tsx
      CaregiverShell.tsx
      FamilyShell.tsx
      Sidebar.tsx
      FacilitySelector.tsx
      ShiftHeader.tsx
      SyncIndicator.tsx
    common/
      DataTable.tsx
      StatusBadge.tsx
      AcuityBadge.tsx
      SeverityBadge.tsx
      EmptyState.tsx
      ErrorState.tsx
      LoadingSkeleton.tsx
      NotificationBell.tsx
      ConfirmDialog.tsx
  features/
    auth/
      LoginPage.tsx
      useAuth.ts
    dashboard/
      FacilityDashboard.tsx
      CensusBoardCard.tsx
      OrgDashboard.tsx
    residents/
      ResidentList.tsx
      ResidentProfile.tsx
      ResidentForm.tsx
      CarePlanEditor.tsx
      AssessmentEntry.tsx
      AssessmentHistory.tsx
    daily-ops/
      ShiftDashboard.tsx
      MedPassView.tsx
      EmarDocumentation.tsx
      AdlQuickLog.tsx
      DailyLogForm.tsx
      BehavioralEventForm.tsx
      ConditionChangeForm.tsx
      ShiftHandoff.tsx
    incidents/
      IncidentForm.tsx
      IncidentList.tsx
      IncidentDetail.tsx
      IncidentDashboard.tsx
      FollowUpList.tsx
    staff/
      StaffDirectory.tsx
      StaffProfile.tsx
      StaffForm.tsx
      CertificationDashboard.tsx
      ScheduleBuilder.tsx
      TimeRecords.tsx
      ClockInOut.tsx
      SwapBoard.tsx
    billing/
      RateManagement.tsx
      ResidentBillingSetup.tsx
      InvoiceList.tsx
      InvoiceDetail.tsx
      InvoiceGenerator.tsx
      PaymentEntry.tsx
      ArAgingReport.tsx
      RevenueDashboard.tsx
  hooks/
    useSupabase.ts
    useFacilityStore.ts
    useOfflineQueue.ts
    useNotifications.ts
  lib/
    supabase.ts             # Supabase client initialization
    api.ts                  # API function wrappers
    offline-queue.ts        # IndexedDB queue management
    date-utils.ts           # Timezone conversion helpers
    format.ts               # Currency formatting, phone formatting
    validation/             # Zod schemas matching API specs
      residents.ts
      incidents.ts
      emar.ts
      billing.ts
  types/
    database.ts             # Generated from Supabase (supabase gen types)
    api.ts                  # API request/response shapes
```

---

## 13. ACCESSIBILITY REQUIREMENTS

| Requirement | Standard | Implementation |
|------------|----------|---------------|
| Color contrast | WCAG 2.1 AA (4.5:1 normal text, 3:1 large text) | Verify all status token colors meet ratio against backgrounds |
| Touch targets | 44×44px minimum | All interactive elements on mobile |
| Keyboard navigation | Full keyboard nav for admin shell | Tab order, focus rings, Escape to close modals |
| Screen reader | ARIA labels on all interactive elements | shadcn/ui handles most of this — verify custom components |
| Font size | 16px minimum body text, 14px minimum secondary | No text smaller than 14px anywhere |
| Motion | Respect prefers-reduced-motion | Disable animations when user preference is set |
| Language | English only Phase 1 | i18n architecture in place from day 1 (even if only en locale exists). All user-facing strings in locale files, not hardcoded. |
