# 14 Dietary And Nutrition

- Spec maturity: `PARTIAL`
- Repo posture: dietary hub and clinical-review surfaces are shipped

## What It Covers

Diet orders, restrictions, status tracking, nutrition operations, and the bridge between dietary service and clinical medication context.

## Primary Users

- Dietary lead
- Dietary aides
- Nurses and admins reviewing diet safety

## Key Workflows

- review active diet orders and status
- create or update dietary records
- perform clinical dietary review alongside medication context
- align meal service with restrictions, textures, and fluid needs

## Primary Surfaces

- `/dietary`
- `/admin/dietary`
- `/admin/dietary/new`
- `/admin/dietary/clinical-review`

## Data, Controls, And Automation

- dietary orders and nutrition status
- advisory hints for medication and diet interactions
- IDDSI-focused texture and fluid guidance in the review layer

## Deck Framing

- Show Haven connecting kitchen operations to resident safety, not treating dietary as a side module.
- Use a “service plus clinical safety” framing.
