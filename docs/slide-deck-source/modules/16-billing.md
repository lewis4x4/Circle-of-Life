# 16 Billing And Collections

- Spec maturity: `FULL + COL notes`
- Repo posture: billing operations are shipped

## What It Covers

Resident billing, rates, invoice generation, payments, collections, and AR visibility.

## Primary Users

- Facility admins
- Back-office billing staff
- Families consuming read-only billing views

## Key Workflows

- manage rate schedules
- generate and review invoices
- record payments and collection activities
- monitor AR aging at facility and organization scope

## Primary Surfaces

- `/admin/billing/rates`
- `/admin/billing/invoices`
- `/admin/billing/invoices/[id]`
- `/admin/billing/invoices/generate`
- `/admin/billing/payments/new`
- `/admin/billing/collections`
- `/admin/billing/ar-aging`
- `/admin/billing/revenue`
- `/admin/billing/org-ar-aging`
- `/admin/residents/[id]/billing`
- `/family/billing`
- `/family/invoices`
- `/family/payments`

## Data, Controls, And Automation

- rates, payers, invoices, line items, payments, collection activities
- invoice sequencing and aging models
- monthly invoice generation and AR check automation

## Deck Framing

- Show that Haven handles the business side of residency, not just clinical documentation.
- Pair billing screens with executive rollups and family-facing visibility.
