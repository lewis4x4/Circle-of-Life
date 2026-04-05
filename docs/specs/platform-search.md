# Platform Search Index (Phase 3.5)

**Segment:** `platform-search-index`  
**Migration:** `053_*`  
**Dependencies:** [`00-foundation.md`](00-foundation.md), optional [`00-foundation-regulatory.md`](00-foundation-regulatory.md) for facility context.

---

## Purpose

Provide a **single searchable index** for admin workflows (survey visit mode, executive drill-down, vendor lookup) with RLS aligned to org/facility access — without duplicating full row payloads in the index.

---

## Scope

### Extension

- Enable **`pgvector`** in the project for future hybrid (lexical + embedding) search; v1 may use tsvector only.

### Table: `search_documents`

| Column | Type | Notes |
|--------|------|--------|
| `id` | uuid PK | |
| `organization_id` | uuid FK | RLS anchor |
| `facility_id` | uuid nullable | When document is facility-scoped |
| `source_table` | text | e.g. `residents`, `staff`, `vendors`, `incidents` |
| `source_id` | uuid | FK target id |
| `content_tsv` | tsvector | GIN indexed |
| `updated_at` | timestamptz | |

**RLS:** SELECT/INSERT/UPDATE/DELETE per org + facility access mirrors source table policy intent (service role for trigger maintenance).

### Triggers

- On **`residents`, `staff`, `vendors`, `incidents`** (minimum set): maintain `search_documents` on INSERT/UPDATE/DELETE of searchable fields (name, identifiers, titles — **no PHI blobs** in v1 unless policy allows).

---

## Performance

- Document **GUC `facility_ids`** or equivalent session pattern for policies on high-volume tables (see README Phase 3.5 “Scale and technology fixes”).

---

## Acceptance

1. Migration `053_*` creates table, indexes, triggers, RLS.
2. Explainability: each row traceable to `source_table` + `source_id`.
3. Segment gates pass.
