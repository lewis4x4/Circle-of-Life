# Section 1 interface repairs

All four findings are prepared for independent review. This record reports local source and test evidence only. It does not claim authenticated staff acceptance, production deployment, or clinical sign-off.

## NAV-001

Status: `source_verified_review_pending`.

The reconciled source baseline already contained canonical page modules for finance forecast, close, and trust; report history detail; in-service creation; and transportation request creation/detail. The focused regression verifies each page module exists and that `next.config.ts` includes the actual legacy redirect segment for each workflow.

Evidence: `src/lib/navigation/canonical-admin-route-registry.test.ts` and the seven page modules listed in `roadmap-status.json`.

Command: `npx vitest run --reporter=verbose src/lib/navigation/canonical-admin-route-registry.test.ts`.

Limit: This does not exercise redirects in an authenticated browser.

## NAV-006

Status: `implemented_review_pending`.

Executive primary destinations are normal focusable route links with `aria-current`; the navigation no longer presents incomplete tab-widget semantics. Overview and Alerts mount the responsive navigation directly, so its mobile Sections trigger is available at narrow widths.

Evidence: `src/app/(admin)/executive/executive-hub-nav.tsx`, `src/components/executive/ExecutiveOverviewPageClient.tsx`, and `src/app/(admin)/executive/alerts/page.tsx`.

Command: `npx vitest run --reporter=verbose src/app/(admin)/executive/executive-hub-nav.test.tsx src/app/(admin)/executive/executive-hub-nav.source.test.ts src/app/(admin)/executive/alerts/page.test.tsx src/components/executive/ExecutiveOverviewPageClient.test.tsx`.

Limit: Rendered interaction coverage proves normal link focusability and trigger mounting but does not claim an authenticated mobile-browser or assistive-technology certification.

## BUS-005

Status: `implemented_review_pending`.

The certification form distinguishes a successful empty facility from a failed active-staff retrieval. Failures display a retry action and retain all entered certification form values.

Evidence: `src/app/(admin)/certifications/new/page.tsx` and its page test.

Command: `npx vitest run --reporter=verbose src/app/(admin)/certifications/new/page.test.tsx`.

Limit: The test uses a mocked retrieval failure; an authenticated RLS or network failure was not executed.

## FL-009

Status: `implemented_review_pending`.

Both controlled-substance count entry points join the supported resident identity and display the legal name, optional preferred name, medication name, strength/form/route/frequency, and stable `resident_medications` record identifier. The witness receipt repeats this same identity. An absent resident join blocks the shared-console count rather than presenting an ambiguous record.

Evidence: `src/components/controlled-substance/ControlledCountConsole.tsx`, `src/components/medication/CountInitiationModal.tsx`, `src/components/controlled-substance/PendingCountReceipt.tsx`, and their focused tests.

Command: `npx vitest run --reporter=verbose src/components/controlled-substance/controlled-medication-identity.test.tsx src/components/controlled-substance/ControlledCountConsole-wall-clock-source.test.ts`.

Limit: This is clinically consequential and requires later GPT-6 Astra High review. No clinical action, live count, or production data was used.
