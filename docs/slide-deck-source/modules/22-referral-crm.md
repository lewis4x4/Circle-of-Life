# 22 Referral CRM

- Spec maturity: `historically treated as STUB in planning tables, but meaningful slices are shipped in repo`
- Repo posture: HL7 inbound queue and referral operations are active surfaces

## What It Covers

The structured CRM and integration layer around referral pipeline operations, especially inbound HL7 referral traffic and related admin tooling.

## Primary Users

- Admissions and intake staff
- Admin assistants
- Operators monitoring external referral flow

## Key Workflows

- review HL7 inbound referral messages
- manually draft leads from processed inbound rows
- filter, search, export, and hand off referral queue data
- connect pipeline analytics back to source channels

## Primary Surfaces

- `/admin/referrals`
- `/admin/referrals/hl7-inbound`
- `/admin/referrals/hl7-inbound/new`
- `/admin/referrals/sources`

## Data, Controls, And Automation

- `referral_hl7_inbound`
- `process-referral-hl7-inbound` Edge Function
- CSV export, raw-message copy, search, and status filtering

## Deck Framing

- Use this module to prove Haven can absorb external operational feeds, not just manual forms.
- Show the inbound queue as an operations console for messy real-world intake.
