# Role Shells And Navigation

## Navigation Model

Haven is not a single generic dashboard. It is a role-routed system with different shells, routes, priorities, and first-screen expectations per user type.

## Canonical Shells

### Admin shell

- Primary users: owner, org admin, facility admin, manager, admin assistant, coordinator, nurse, broker, maintenance, some dietary users.
- Canonical prefix: `/admin/*`
- Primary purpose: operational control, back-office workflows, analytics, and oversight.
- Design note: most business-module slides should use the admin shell as the visual container.

### Caregiver shell

- Primary users: caregiver, housekeeper.
- Canonical prefix: `/caregiver/*`
- Primary purpose: phone-first shift execution, resident tasks, rounds, documentation, handoff.
- Design note: show speed, urgency, and simple actions.

### Med-tech shell

- Primary users: med-tech, nurse in med workflows.
- Canonical prefix: `/med-tech/*`
- Primary purpose: medication pass, controlled counts, med-related exception handling.
- Design note: present it as a tighter, medication-specific cockpit.

### Dietary shell

- Primary users: dietary lead, dietary aide.
- Canonical prefix: `/dietary`
- Primary purpose: diet orders, meal readiness, restrictions, clinical review alignment.
- Design note: make it feel operational and kitchen-ready rather than clinical-admin heavy.

### Family shell

- Primary users: family members linked to residents.
- Canonical prefix: `/family/*`
- Primary purpose: care summary, messages, calendar, billing visibility.
- Design note: simplify terminology and remove internal operator noise.

### Onboarding shell

- Primary users: onboarding or discovery users.
- Canonical prefix: `/onboarding/*`
- Primary purpose: intake questionnaires, process discovery, configuration capture.
- Design note: frame it as implementation/discovery, not day-to-day facility operations.

## Role Landing Logic

- Owners and org admins land in executive intelligence.
- Facility admins and managers land in facility command surfaces.
- Admin assistants land in coordination-heavy dashboards.
- Coordinators land in care-plan, assessment, and family workflows.
- Nurses land in clinical risk and medication-heavy surfaces.
- Caregivers and med-tech users land in phone-first execution shells.
- Families land in a stripped-down engagement portal.

## Navigation Principles To Explain In The Deck

- Facility scope is selected in shell context, not encoded in every URL.
- Many short paths are legacy aliases; `/admin/*` is the canonical admin namespace.
- Admin routes are domain-based: referrals, admissions, residents, incidents, staff, billing, finance, insurance, vendors, executive, reports, and more.
- Caregiver routes are task-based: meds, rounds, resident actions, PRN follow-up, handoff, clock.

## Best Way To Visualize This

- Use a “control tower plus role workbenches” metaphor.
- Show one central platform, then branch into role shells with example routes and tasks.
- Repeat the rule that different roles see different first screens because the system is workload-shaped, not just permission-shaped.
