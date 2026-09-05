# COL facility/entity name alignment — migration 318

**Mission alignment: pass.** Make operational labels consistent while preserving tenant relationships, tax identifiers, licenses, and historical audit records.

A read-only inspection on 2026-09-05 confirmed the five canonical facility IDs ending 001–005 and their corresponding entity IDs. The owner-supplied alignment brief provides the target display labels. [Sunbiz filing L13000146046](https://search.sunbiz.org/Inquiry/corporationsearch/SearchResultDetail?aggregateId=flal-l13000146046-5d253733-3153-46bc-a229-39c33133d891&directionType=Initial&inquirytype=EntityName&listNameOrder=SORENSENSMITH%20L140001011100&searchNameOrder=SORENSENSMITHBAY%20L130001460460&searchTerm=SORENSEN%2C%20SMITH%20) identifies **SORENSEN, SMITH & BAY LLC**. The proposed LLLC spelling is not used.

| Record | Before | After |
|---|---|---|
| Homewood facility name | Homewood Lodge ALF | Homewood Lodge, ALF |
| Homewood entity name | Sorensen, Smith & Bay, LLC | Sorensen, Smith & Bay LLC |
| Plantation facility name | Plantation ALF | The Plantation on Summers |
| Plantation entity DBA | Plantation ALF | The Plantation on Summers |
| Grande Cypress entity DBA | NULL | Grande Cypress ALF |

Oakridge and Rising Oaks labels are already consistent with the supplied targets and remain unchanged. The migration locks and verifies all five canonical mappings, organization ownership, active rows, and expected names/DBAs before updating anything. It accepts either the old or corrected values so replay performs no duplicate updates. An unexpected mapping or name stops the transaction for investigation.

The Sunbiz FEIN differs from the Homewood entity FEIN in historical seed 008. This migration does **not** reconcile or change tax identifiers. The owner must compare authoritative entity/tax documents before any tax-data correction; a matching display name alone is insufficient for that decision.

**Deployment:** local migration only until explicitly deployed. Preserve the existing foundation audit triggers. After deployment, inspect these exact records, verify audit entries and remote migration parity, and inspect labels on facility/resident documents. This is not a claim that production or exports already show the new labels.

**Focused verification:** `node scripts/test-col-name-migration.mjs` checks drift rollback, the exact five updates, audit entries, replay idempotence, and unrelated-organization preservation in a disposable PostgreSQL database using synthetic records.
