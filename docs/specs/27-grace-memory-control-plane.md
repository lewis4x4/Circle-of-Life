# Grace Memory Control Plane

**Status:** FULL  
**Primary surfaces:** Obsidian vault authoring, Haven ingest pipeline, `knowledge-agent`, `semantic_kb_search`, Grace deterministic routing  
**Dependencies:** [`platform-search.md`](platform-search.md), [`26-reporting-module.md`](26-reporting-module.md), [`24-executive-intelligence.md`](24-executive-intelligence.md), [`00-foundation.md`](00-foundation.md)

---

## Purpose

Define the **memory operating system** for Grace so knowledge retrieval is governed, explainable, facility-aware, and machine-compilable.

This is not a notes feature. It is a control plane with three responsibilities:

1. **Author truth** in Obsidian using strict note schemas.
2. **Compile truth** into retrieval assets, graph links, aliases, and answer contracts.
3. **Serve truth** to Grace with provenance, trust ranking, and deterministic planning hints.

The system must support:

- facility-specific operational truth
- organization-wide doctrine
- decision lineage
- terminology / synonym mapping
- Grace answer packs for top operational prompts
- contradiction detection before stale or conflicting truth reaches operators

---

## Core Architecture

### Control-plane split

- **Obsidian vault** = human authoring, review, links, governance
- **Memory compiler** = converts markdown into runtime artifacts
- **Haven knowledge layer** = stores normalized docs, chunks, graph edges, aliases, and retrieval metadata
- **Grace** = query planner across live data + compiled memory

### Recommended vault location

Use a vault adjacent to the app repo, not inside it:

`/Users/brianlewis/Circle of Life/COL-Knowledge-Vault`

Reasons:

- avoids polluting the product repo with operational markdown churn
- keeps long-lived organizational memory separate from deploy artifacts
- supports independent sync/backup/versioning
- allows structured ingest without coupling vault edits to code commits

---

## Memory Layers

The compiler must preserve six distinct memory layers. Grace should rank and cite them differently.

### 1. Doctrine Memory

What the organization officially says should happen.

Includes:

- policies
- SOPs
- regulatory interpretations
- formal playbooks
- role guides

Use for:

- policy questions
- process questions
- what-rule-applies questions

### 2. Operational Memory

What actually happens at a facility, team, or operational lane.

Includes:

- facility overrides
- local contacts
- binder locations
- vendor knowledge
- survey-mode details
- local escalation patterns

Use for:

- facility-specific execution
- local “where / who / how here” questions

### 3. Semantic Memory

How operators talk.

Includes:

- aliases
- glossary terms
- synonyms
- module-language mappings
- route-language mappings

Use for:

- intent routing
- retrieval expansion
- clarification prompts

### 4. Decision Memory

Why the current workflow exists.

Includes:

- executive decision records
- rejected alternatives
- superseded practices
- temporary directives

Use for:

- historical reasoning
- why-we-do-it-this-way questions
- change explanations

### 5. Temporal Memory

What is true now versus historically.

Includes:

- effective dates
- review dates
- active vs archived vs superseded lifecycle
- emergency directives
- survey-mode temporary instructions

Use for:

- time-sensitive ranking
- stale truth suppression
- emergency behavior overrides

### 6. Answer Memory

Machine/human contracts for the top Grace prompts.

Includes:

- Grace Packs
- answer contracts
- preferred tables
- required clarifications
- forbidden substitutions
- exemplar answer shapes

Use for:

- deterministic routing
- runtime planning
- regression eval generation

---

## Canonical Obsidian Note Classes

Every note in the vault must declare exactly one `doc_type`.

### Canonical types

- `policy`
- `sop`
- `playbook`
- `facility_override`
- `decision_record`
- `ontology_term`
- `grace_pack`
- `role_guide`
- `source_document`
- `reference`

### Non-canonical note handling

If a note is missing `doc_type`, it is treated as `draft_reference` and must not be ranked ahead of canonical active notes.

---

## Vault Structure

Use this top-level structure:

```text
COL-Knowledge-Vault/
  00 Inbox/
  01 Doctrine/
    Policies/
    SOPs/
    Playbooks/
    Role Guides/
  02 Operations/
    Facility Overrides/
    Facility Intelligence/
      Oakridge ALF/
      Homewood Lodge ALF/
      Grande Cypress ALF/
      Plantation ALF/
      Rising Oaks/
  03 Control Plane/
    Grace Packs/
    Ontology/
    Decision Ledger/
    Scenario Packs/
  04 Sources/
    Imported PDFs/
    Vendor Docs/
    Regulatory Source Docs/
  05 Archive/
```

### Facility Intelligence subfolders

Each facility folder may contain:

- `Contacts`
- `Emergency`
- `Compliance Notes`
- `Staffing`
- `Vendors`
- `Census & Capacity`
- `Local SOP Variants`

---

## Required Frontmatter Schema

All canonical notes must include this core frontmatter:

```yaml
---
title: string
doc_type: policy|sop|playbook|facility_override|decision_record|ontology_term|grace_pack|role_guide|source_document|reference
status: draft|active|archived|superseded
organization: Circle of Life
facility_scope: all|single|multi|org|entity
facility_tags: []
entity_tags: []
module: string
roles: []
topics: []
aliases: []
owner: string
effective_date: YYYY-MM-DD|null
review_date: YYYY-MM-DD|null
source_of_truth: obsidian
grace_priority: low|medium|high|critical
grace_answerable: true|false
trust_rank: 1|2|3|4|5
supersedes: []
superseded_by: null
source_documents: []
---
```

### Field semantics

- `status`
  - `draft` = not retrieval-primary
  - `active` = retrieval-primary
  - `archived` = retrieval-suppressed unless explicitly requested
  - `superseded` = retrieval-suppressed and linked to successor
- `facility_scope`
  - `single` requires exactly one `facility_tags` value
  - `multi` requires 2+ `facility_tags`
  - `all` means all facilities under the org
  - `org` means organization-level truth
  - `entity` means legal-entity scoped truth
- `trust_rank`
  - `1` = Grace Pack / canonical answer contract
  - `2` = formal doctrine
  - `3` = decision record / approved override
  - `4` = source/reference
  - `5` = draft or low-confidence note

---

## Machine-Critical Note Types

These are the minimum required note types for the first compiler pass.

### Grace Pack

Purpose:

- define how Grace should answer a top operational prompt class
- bind language to live tables, doctrine, and clarification rules

Required fields:

- `question_patterns`
- `preferred_live_tables`
- `required_clarifications`
- `forbidden_substitutions`
- `answer_shape`
- `example_good_answers`

Required body sections:

- `# Intent`
- `# Preferred live data`
- `# Preferred doctrine`
- `# Clarify when`
- `# Forbidden substitutions`
- `# Answer contract`
- `# Example answers`

### Facility Override

Purpose:

- record local truth that overrides or specializes org-wide doctrine

Required fields:

- `base_document_refs`
- `override_reason`
- `approved_by`
- `valid_from`
- `valid_until`

Required body sections:

- `# Override summary`
- `# Base rule`
- `# Local reality`
- `# Grace retrieval behavior`
- `# Expiration / review`

### Decision Record

Purpose:

- preserve why a workflow, policy, or tool behavior exists

Required fields:

- `decision_date`
- `decision_owner`
- `rejected_options`
- `impact_domains`

Required body sections:

- `# Context`
- `# Decision`
- `# Why`
- `# Rejected alternatives`
- `# Grace implications`

### Ontology Term

Purpose:

- define vocabulary, aliases, domain mapping, and ambiguity boundaries

Required fields:

- `canonical_term`
- `alias_group`
- `maps_to_domains`
- `maps_to_tables`
- `do_not_confuse_with`

Required body sections:

- `# Canonical meaning`
- `# Aliases`
- `# Domain mappings`
- `# Clarification boundaries`
- `# Forbidden confusions`

---

## Memory Compiler Outputs

Every canonical note must compile into five runtime artifacts.

### 1. Canonical document record

Target shape:

```json
{
  "document_id": "uuid",
  "title": "Incident Reporting SOP",
  "doc_type": "sop",
  "status": "active",
  "module": "compliance",
  "roles": ["facility_admin", "nurse", "caregiver"],
  "facility_scope": "all",
  "facility_tags": [],
  "aliases": ["incident write-up", "event report", "safety report"],
  "trust_rank": 2,
  "effective_date": "2026-04-01",
  "review_date": "2026-07-01"
}
```

### 2. Structured chunks

Chunk by semantic section, not fixed token size first.

Chunk classes:

- `policy_statement`
- `procedure_step`
- `exception_rule`
- `escalation_path`
- `facility_override`
- `decision_rationale`
- `glossary_definition`
- `grace_contract`

Each chunk must carry:

- parent document metadata
- section heading
- chunk class
- aliases
- facility scope
- role scope
- trust rank

### 3. Knowledge graph edges

Required edge families:

- `implements`
- `overrides`
- `supersedes`
- `aliases`
- `belongs_to_module`
- `used_by_grace_pack`
- `supports_route`
- `related_to_facility`
- `decision_affects`

### 4. Retrieval weights

Each compiled note must emit ranking hints:

- `prefer_for_policy_questions`
- `prefer_for_facility_questions`
- `prefer_for_local_override_questions`
- `suppress_if_archived`
- `boost_if_alias_match`
- `boost_if_grace_pack`

### 5. Grace planning hints

Each compiled note may emit:

- `route_bias`
- `clarification_prompt`
- `forbidden_substitutions`
- `preferred_answer_shape`
- `live_data_dependencies`

---

## Retrieval Ranking Rules

Grace must rank memory with explicit precedence.

### Policy/process questions

Priority order:

1. matching active facility override
2. matching active Grace Pack
3. matching active policy/SOP/playbook
4. matching active decision record
5. matching reference/source document
6. archived / superseded only if explicitly requested

### Operational “how do we do it here?” questions

Priority order:

1. facility override
2. facility intelligence note
3. role guide
4. org-wide SOP
5. decision record

### Glossary / terminology questions

Priority order:

1. ontology term
2. Grace Pack alias block
3. policy glossary
4. legacy reference

### Deterministic live-data questions

Priority order:

1. live tables
2. Grace Pack answer contract
3. ontology aliases
4. doctrine notes for labeling or clarification only

Grace must not answer a live-data count question from doctrine if the live tables are available.

---

## Contradiction Detection

The compiler must flag contradictions before promotion.

### Required contradiction checks

- two active notes with same title and different meaning
- active facility override conflicting with active org doctrine
- note marked `superseded` but referenced by active Grace Pack
- ontology term mapping to conflicting domains without clarification rule
- Grace Pack answer contract conflicting with formal SOP

### Severity classes

- `P0`: active contradiction that changes operator action
- `P1`: conflicting alias/domain mapping
- `P2`: stale review or missing successor link

Contradictions must be surfaced to admins before ingest promotion.

---

## Grace Packs as Product Contracts

The first moonshot retrieval milestone is not broad coverage. It is a **top-50 Grace Pack catalog**.

### Initial required Grace Packs

- `Grace Pack - Census`
- `Grace Pack - Resident Attention`
- `Grace Pack - New Leads`
- `Grace Pack - Pending Admissions`
- `Grace Pack - Open Incidents`
- `Grace Pack - Med Queue`
- `Grace Pack - Certifications Expiring`
- `Grace Pack - Transport Trips`
- `Grace Pack - Unreplied Reviews`
- `Grace Pack - AR Watchlist`
- `Grace Pack - Open Claims`
- `Grace Pack - Executive Alerts`

### Required Grace Pack fields

```yaml
question_patterns: []
preferred_live_tables: []
preferred_doc_refs: []
required_clarifications: []
forbidden_substitutions: []
answer_shape: count|list|watchlist|summary|per_resident|per_facility
example_good_answers: []
```

---

## Governance Workflow

### Author states

- `draft`
- `review_pending`
- `active`
- `archived`
- `superseded`

### Promotion rules

A note may move to `active` only if:

- owner is set
- review date is set
- trust rank is set
- required schema for its `doc_type` is complete
- contradiction checks pass
- successor links are valid if superseding another note

### Review cadence

- `critical` Grace priority: review every 30 days
- `high`: every 60 days
- `medium`: every 90 days
- `low`: every 180 days

Expired review notes must be demoted in retrieval ranking until re-approved.

---

## Integration with Haven

### Grace runtime responsibilities

- prefer deterministic live tables when the question is operational and structured
- use compiled memory for:
  - policy answers
  - procedural answers
  - facility overrides
  - clarification prompts
  - answer contracts

### Admin UI responsibilities

Add future admin surfaces for:

- compiler status
- contradictions
- stale notes
- Grace Pack coverage
- ontology coverage
- facility override coverage

### Search / KB responsibilities

The memory compiler must write into the same knowledge search substrate as the current KB, but with richer metadata than generic document uploads.

Future ingest priorities:

- Obsidian note import API
- note-type aware chunking
- graph-edge persistence
- trust-rank aware ranking
- Grace Pack-aware retrieval boosts

---

## Acceptance Criteria

This memory control plane is complete when:

1. Obsidian notes follow canonical schemas.
2. Grace Packs exist for the top operational prompts.
3. Compiler emits document records, chunks, graph edges, weights, and planning hints.
4. Facility overrides outrank generic doctrine when valid.
5. Archived or superseded notes do not outrank active truth.
6. Grace provenance can name:
   - live tables used
   - memory docs used
   - facility scope used
   - time window used
7. Contradictions are flagged before promotion.
8. Retrieval quality improves because Grace can distinguish:
   - doctrine
   - local override
   - terminology
   - decision lineage
   - answer contract

---

## First Implementation Slice

Build in this order:

1. Obsidian vault bootstrap
2. note templates for the canonical note classes
3. Grace Pack starter set
4. ontology starter set
5. compiler metadata extraction
6. compiler chunking and graph edges
7. ranking and contradiction checks
8. Grace provenance surfacing

The first shipping milestone should be:

- one vault
- four note templates
- twelve Grace Packs
- one ontology glossary
- one compiler that emits metadata + chunks

That is enough to start improving Grace materially without trying to solve the entire retrieval system in one pass.
