# Grace Memory Compiler & Runtime Schema

**Status:** FULL  
**Segment:** `grace-memory-compiler`  
**Migration:** `176_grace_memory_compiler.sql`  
**Dependencies:** [`27-grace-memory-control-plane.md`](27-grace-memory-control-plane.md), [`platform-search.md`](platform-search.md), [`00-foundation.md`](00-foundation.md), existing KB migrations `126`, `130`, `132`

---

## Purpose

Take the Obsidian control-plane vault and compile it into runtime-safe retrieval artifacts inside Haven without inventing a second disconnected knowledge system.

This spec extends the existing KB substrate:

- `documents`
- `chunks`
- `kb_job_runs`
- `kb_analytics_events`

It adds:

- compiler metadata on `documents`
- structured aliases
- graph relationships
- planning hints for Grace
- contradiction tracking
- compiler run lineage

The design principle is:

- **author in Obsidian**
- **compile into the existing Haven KB**
- **retrieve from one governed runtime**

---

## Runtime Model

### Existing tables reused

- `documents`
  Canonical document record for every promoted memory artifact.
- `chunks`
  Runtime retrieval chunks and semantic sections.
- `kb_job_runs`
  Background ingest / recompile lineage.
- `kb_analytics_events`
  Retrieval and runtime analytics.

### New tables

- `document_aliases`
- `document_relationships`
- `document_planning_hints`
- `knowledge_contradictions`
- `memory_compiler_runs`

---

## `documents` extensions

The compiler must extend `documents` rather than fork it.

### New columns

| Column | Type | Purpose |
|---|---|---|
| `doc_type` | `text` | Canonical note class (`policy`, `grace_pack`, `ontology_term`, etc.) |
| `source_system` | `text` | `manual_upload`, `obsidian`, `api`, `imported_pdf` |
| `source_path` | `text` | Obsidian vault-relative path |
| `canonical_slug` | `text` | Stable compiler key |
| `lifecycle_status` | `text` | `draft`, `active`, `archived`, `superseded`, `review_pending` |
| `facility_scope` | `text` | `single`, `multi`, `all`, `org`, `entity` |
| `facility_tags` | `text[]` | Facility scopes as names or stable facility slugs |
| `entity_tags` | `text[]` | Entity scope tags |
| `role_tags` | `text[]` | Roles intended for this memory |
| `topic_tags` | `text[]` | Canonical retrieval topics |
| `alias_terms` | `text[]` | Inline alias expansion from frontmatter |
| `grace_priority` | `text` | `low`, `medium`, `high`, `critical` |
| `grace_answerable` | `boolean` | Whether the note is retrieval-primary for Grace |
| `trust_rank` | `integer` | 1–5 trust precedence |
| `effective_date` | `date` | Time validity |
| `review_date` | `date` | Governance freshness |
| `owner_name` | `text` | Non-user-bound source owner from Obsidian |
| `compiled_at` | `timestamptz` | Last compiler success |
| `compiler_version` | `text` | Compiler contract version |

### Constraints

- `doc_type` is nullable only for legacy KB docs
- `lifecycle_status` defaults to `published`-compatible behavior via:
  - `published` docs map to `active`
- `trust_rank` must be `1..5` when present
- `grace_priority` must be one of `low|medium|high|critical`

### Indexes

- `(workspace_id, doc_type)` where `deleted_at IS NULL`
- `(workspace_id, lifecycle_status)` where `deleted_at IS NULL`
- `(workspace_id, canonical_slug)` unique where `canonical_slug IS NOT NULL`
- GIN on `facility_tags`, `entity_tags`, `role_tags`, `topic_tags`, `alias_terms`

---

## `chunks` expectations

The compiler keeps using `chunks`, but the runtime contract changes.

### Existing columns reused

- `chunk_type`
- `section_title`
- `metadata`

### Required `metadata` keys for compiled memory

```json
{
  "chunk_class": "policy_statement",
  "source_heading": "Answer contract",
  "doc_type": "grace_pack",
  "canonical_slug": "grace-pack-census",
  "facility_scope": "all",
  "facility_tags": [],
  "role_tags": ["facility_admin", "manager"],
  "topic_tags": ["census", "resident-count"],
  "trust_rank": 1
}
```

### Canonical chunk classes

- `policy_statement`
- `procedure_step`
- `exception_rule`
- `escalation_path`
- `facility_override`
- `decision_rationale`
- `glossary_definition`
- `grace_contract`

These values belong in `metadata.chunk_class`; `chunk_type` may remain compatible with existing usage.

---

## New table: `document_aliases`

Purpose:

- normalize aliases into searchable units
- keep alias matching auditable and update-safe

### Schema

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` PK | |
| `workspace_id` | `uuid` FK | RLS anchor |
| `document_id` | `uuid` FK → `documents.id` | cascade delete |
| `alias` | `text` | original alias |
| `alias_normalized` | `text` | lowercase / normalized |
| `alias_kind` | `text` | `frontmatter`, `derived`, `ontology`, `manual` |
| `created_at` | `timestamptz` | default now |

### Indexes

- unique `(document_id, alias_normalized)`
- `(workspace_id, alias_normalized)`

---

## New table: `document_relationships`

Purpose:

- knowledge graph edges between notes

### Schema

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` PK | |
| `workspace_id` | `uuid` FK | RLS anchor |
| `from_document_id` | `uuid` FK → `documents.id` | |
| `to_document_id` | `uuid` FK → `documents.id` | |
| `relationship_type` | `text` | `implements`, `overrides`, `supersedes`, `aliases`, `used_by_grace_pack`, `supports_route`, `related_to_facility`, `decision_affects` |
| `metadata` | `jsonb` | optional edge detail |
| `created_at` | `timestamptz` | default now |

### Indexes

- `(workspace_id, relationship_type)`
- `(from_document_id, relationship_type)`
- `(to_document_id, relationship_type)`

---

## New table: `document_planning_hints`

Purpose:

- runtime planning data for Grace without embedding operational control logic in prose

### Schema

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` PK | |
| `workspace_id` | `uuid` FK | RLS anchor |
| `document_id` | `uuid` FK → `documents.id` | one-to-one with planning hints |
| `route_bias` | `text` | e.g. `census`, `referral_pipeline`, `resident_attention` |
| `clarification_prompt` | `text` | short operator-safe fallback |
| `forbidden_substitutions` | `text[]` | runtime guardrails |
| `preferred_answer_shape` | `text` | `count`, `summary`, `watchlist`, etc. |
| `preferred_live_tables` | `text[]` | deterministic runtime tables |
| `metadata` | `jsonb` | extra planner hints |
| `created_at` | `timestamptz` | default now |
| `updated_at` | `timestamptz` | default now |

### Indexes

- unique `(document_id)`
- `(workspace_id, route_bias)`

---

## New table: `knowledge_contradictions`

Purpose:

- track compiler-detected contradictions before they reach retrieval

### Schema

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` PK | |
| `workspace_id` | `uuid` FK | RLS anchor |
| `left_document_id` | `uuid` FK → `documents.id` | |
| `right_document_id` | `uuid` FK → `documents.id` | nullable when contradiction is intra-note |
| `severity` | `text` | `p0`, `p1`, `p2` |
| `contradiction_type` | `text` | `active_conflict`, `stale_override`, `alias_collision`, `supersession_gap`, `grace_pack_conflict` |
| `description` | `text` | human-readable detail |
| `status` | `text` | `open`, `acknowledged`, `resolved`, `suppressed` |
| `metadata` | `jsonb` | compiler payload |
| `detected_at` | `timestamptz` | default now |
| `resolved_at` | `timestamptz` | nullable |
| `resolved_by` | `uuid` FK → `auth.users.id` | nullable |

### Indexes

- `(workspace_id, status, severity)`
- `(left_document_id)`
- `(right_document_id)`

---

## New table: `memory_compiler_runs`

Purpose:

- explicit lineage for vault compiles separate from generic `kb_job_runs`

### Schema

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` PK | |
| `workspace_id` | `uuid` FK | nullable for bootstrap |
| `source_system` | `text` | `obsidian` |
| `vault_path` | `text` | local or remote logical path |
| `status` | `text` | `pending`, `running`, `succeeded`, `failed`, `partial` |
| `compiler_version` | `text` | |
| `documents_seen` | `integer` | |
| `documents_compiled` | `integer` | |
| `contradictions_found` | `integer` | |
| `metadata` | `jsonb` | |
| `started_at` | `timestamptz` | default now |
| `completed_at` | `timestamptz` | nullable |

### Indexes

- `(workspace_id, started_at desc)`
- `(status, started_at desc)`

---

## RLS Policy Model

### Principle

Compiled memory must obey the same workspace/facility/role boundaries as the existing KB.

### `document_aliases`

- authenticated users may `SELECT` aliases only for documents they can view
- writes reserved to `service_role`

### `document_relationships`

- authenticated users may `SELECT` edges if the `from_document_id` document is visible
- writes reserved to `service_role`

### `document_planning_hints`

- authenticated users may `SELECT` only when the parent document is visible
- writes reserved to `service_role`

### `knowledge_contradictions`

- `owner`, `org_admin`, `facility_admin` may `SELECT`
- `owner`, `org_admin` may `UPDATE status/resolution`
- writes from compiler via `service_role`

### `memory_compiler_runs`

- `owner`, `org_admin`, `facility_admin` may `SELECT` within org
- writes reserved to `service_role`

---

## Compiler Pipeline

### Stage 1: Vault scan

Input:

- markdown files from the Obsidian vault

Outputs:

- manifest of canonical notes
- invalid-note report
- compiler run row

### Stage 2: Frontmatter normalization

Normalize:

- scalar fields
- arrays
- dates
- aliases
- canonical slug

Rules:

- missing `doc_type` => legacy/draft note, not retrieval-primary
- invalid `status` => compiler error
- missing required canonical fields => contradiction/error

### Stage 3: Semantic sectioning

Split notes by heading boundaries first, token windows second.

Chunk output:

- chunk content
- chunk class
- source heading
- retrieval tags

### Stage 4: Alias extraction

Create alias rows from:

- frontmatter aliases
- note title
- ontology alias groups
- compiler-derived normalized forms

### Stage 5: Relationship extraction

Extract explicit links from:

- `supersedes`
- `superseded_by`
- `base_document_refs`
- `preferred_doc_refs`
- Obsidian wikilinks

### Stage 6: Planning-hint extraction

For `grace_pack` notes:

- route bias
- clarifications
- forbidden substitutions
- answer shape
- preferred live tables

### Stage 7: Contradiction detection

Flag:

- duplicate active slugs
- conflicting active override/base pairs
- grace pack conflicts
- alias collisions
- supersession gaps

### Stage 8: Runtime publish

Upsert:

- `documents`
- `chunks`
- `document_aliases`
- `document_relationships`
- `document_planning_hints`

Then:

- record `compiled_at`
- close compiler run
- persist contradictions

---

## Ingest Strategy

### Phase 1: file-system compiler

Run locally or in CI against the Obsidian vault path and emit normalized compiler artifacts.

Primary command surface:

```bash
node scripts/obsidian/validate-vault.mjs
```

Later commands:

```bash
node scripts/obsidian/compile-vault.mjs
node scripts/obsidian/publish-vault.mjs
```

### Phase 2: service-role publisher

Publisher takes compiler output and upserts it into Supabase using service-role credentials.

### Phase 3: scheduled refresh

Run compile/publish on:

- vault changes
- nightly governance sweep
- explicit admin “recompile memory” action

---

## Grace Runtime Contract

When compiled memory is live, Grace should:

1. prefer deterministic live-data tables for operational counts and lists
2. query planning hints for routing and clarification
3. use aliases and relationships for recall expansion
4. use doctrine / overrides / decisions for process answers
5. surface provenance including document titles and live-table usage

Grace must not:

- answer from archived or superseded documents unless explicitly asked
- ignore facility overrides when facility scope is exact
- use low-trust drafts ahead of active Grace Packs

---

## Initial Migration Deliverables

Migration `176_grace_memory_compiler.sql` must:

1. extend `documents`
2. create all five new tables
3. add indexes
4. enable RLS
5. create policies
6. add comments

No existing KB rows should be broken by the migration.

---

## Acceptance Criteria

This slice is complete when:

1. the schema exists for compiled Obsidian memory
2. canonical note metadata fits into `documents`
3. aliases, graph edges, contradictions, and planning hints have tables
4. RLS mirrors existing KB visibility intent
5. the vault can be validated locally before publish
6. the next implementation slice can add `compile-vault.mjs` without redesigning storage
