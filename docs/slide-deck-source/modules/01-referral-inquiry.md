# 01 Referral And Inquiry

- Spec maturity: `PARTIAL + COL notes`
- Repo posture: active admin surfaces exist for referral pipeline and source management

## What It Covers

The pre-admission CRM layer for capturing inquiries and referrals before a resident becomes a fully admitted case.

## Primary Users

- Admissions coordinators
- Admin assistants
- Facility leadership monitoring occupancy pipeline

## Key Workflows

- Capture leads from hospitals, agencies, families, web, and other sources
- Track referral source attribution
- Move leads through pipeline stages
- Merge duplicates and preserve minimum-necessary PHI access patterns

## Primary Surfaces

- `/admin/referrals`
- `/admin/referrals/new`
- `/admin/referrals/[id]`
- `/admin/referrals/sources`

## Data, Controls, And Automation

- `referral_sources` and `referral_leads`
- Pipeline statusing and duplicate handling
- Enhanced path for HL7/FHIR-fed intake through a shared inbound queue

## Deck Framing

- Open the resident journey here.
- Show Haven turning fragmented lead capture into a governed admissions funnel.
