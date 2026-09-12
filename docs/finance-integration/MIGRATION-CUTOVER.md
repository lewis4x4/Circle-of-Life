# Migration and cutover preparation

Status: preparation only. No production schema, provider write or cutover has been activated.

Forward migrations use the current repository numbered sequence; original migrations remain intact. Local replay runs synthetic/stubbed auth assertions inside a disposable UTF8 PostgreSQL 17 database. Existing historical records are never silently reclassified, summed across legacy/new trust ledgers, re-exported, or deleted.

Before hosted release, review exact source/migration hashes, Auth/PostgREST/Edge/runtime compatibility and stop controls. Read-only shadow compares opening TB/AR/AP/trust/cash/payroll to approved source evidence and official books. Opening AR must have a typed cutover bridge approved by the controller, never generic revenue. All production outbound stays off until a named, precisely scoped activation record identifies entity/company/generation/account mapping/payload/transaction types.

Recovery must test a restore to before source creation and separately before external posting. Immutable command membership, source versions, mapping/policy and approval evidence must survive lost operational DB metadata. A local migration rollback test does not satisfy that recovery gate. Down migrations and database restore are not accounting rollback; preserve posted effects and prepare authorized linked adjustments.
