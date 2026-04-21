# 21 Family Portal

- Spec maturity: `PARTIAL + COL notes`
- Repo posture: family shell and admin family surfaces are present in code

## What It Covers

The controlled family-facing window into resident updates, communication, calendar events, care-plan visibility, and billing documents.

## Primary Users

- Family members
- Admin assistants and coordinators managing family workflows

## Key Workflows

- read care-plan and resident update context
- exchange messages with staff
- view calendar items
- review invoices, billing, and payment history
- support family triage and conference coordination on the admin side

## Primary Surfaces

- `/family`
- `/family/care-plan`
- `/family/messages`
- `/family/calendar`
- `/family/billing`
- `/family/invoices`
- `/family/payments`
- `/admin/family-messages`
- `/admin/family-portal`

## Data, Controls, And Automation

- family-resident linkages
- family message triage and conference support in admin workflows
- strict role separation so families see an intentionally simplified experience

## Deck Framing

- Present this as transparency without operational noise.
- Show both sides of the interaction: family experience and staff triage.
