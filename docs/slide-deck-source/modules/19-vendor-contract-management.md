# 19 Vendor And Contract Management

- Spec maturity: `PARTIAL + COL notes`
- Repo posture: vendor operations hub is shipped

## What It Covers

Vendor master data, facility links, contracts, purchase orders, invoices, payments, insurance tracking, and spend visibility.

## Primary Users

- Facility admins
- Finance teams
- Maintenance and operations staff

## Key Workflows

- manage vendor records and facility relationships
- maintain contracts and term visibility
- create purchase orders
- review vendor invoices and payments
- analyze spend and vendor risk

## Primary Surfaces

- `/admin/vendors`
- `/admin/vendors/directory`
- `/admin/vendors/[id]`
- `/admin/vendors/contracts`
- `/admin/vendors/contracts/[id]`
- `/admin/vendors/purchase-orders`
- `/admin/vendors/purchase-orders/new`
- `/admin/vendors/purchase-orders/[id]`
- `/admin/vendors/invoices`
- `/admin/vendors/invoices/[id]`
- `/admin/vendors/payments`
- `/admin/vendors/spend`

## Data, Controls, And Automation

- vendor, contract, PO, invoice, payment, insurance, and scorecard models
- links into finance and COI oversight
- eventual three-way match and scorecard intelligence posture

## Deck Framing

- Show that Haven operationalizes third-party dependence, not just internal staff work.
- Use procurement and spend views to expand the business-operations narrative.
