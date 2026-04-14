---
title: Grace Pack - <Topic>
doc_type: grace_pack
status: draft
organization: Circle of Life
facility_scope: all
facility_tags: []
entity_tags: []
module: <module>
roles: [owner, org_admin, facility_admin, manager]
topics: [<topic>]
aliases: [<alias-1>, <alias-2>]
owner: <owner>
effective_date: null
review_date: null
source_of_truth: obsidian
grace_priority: critical
grace_answerable: true
trust_rank: 1
supersedes: []
superseded_by: null
source_documents: []
question_patterns:
  - <pattern-1>
  - <pattern-2>
preferred_live_tables:
  - <table-1>
  - <table-2>
preferred_doc_refs: []
required_clarifications:
  - <clarification-1>
forbidden_substitutions:
  - <wrong-domain-1>
  - <wrong-domain-2>
answer_shape: count
example_good_answers:
  - <gold-answer-1>
---

# Intent

What question class this pack covers and what the user actually means.

# Preferred live data

- `<table-1>`
- `<table-2>`

# Preferred doctrine

- `[[Related SOP]]`
- `[[Related Policy]]`

# Clarify when

- missing facility scope
- missing time window
- domain collision with `<neighboring-domain>`

# Forbidden substitutions

- never answer from `<wrong-domain-1>`
- never answer from `<wrong-domain-2>`

# Answer contract

- output shape: `count|list|watchlist|summary|per_resident|per_facility`
- must include scope used
- must include time window used
- must not add unrelated metrics unless explicitly asked

# Example answers

1. `<good answer one>`
2. `<good answer two>`
