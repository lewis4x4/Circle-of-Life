# ADR — Admission intake path UI (tabs vs admission source dropdown)

**Segment:** Admissions intake hardening  
**Date:** 2026-05-17  
**Status:** Decision pending product sign-off

## Context

The new admission case form (`/pipeline/admissions/new`, alias of `/admin/admissions/new`) currently uses **three path tabs**:

- Existing inquiry
- Referral lead
- Direct admit

Product asked whether this should be replaced with a single field **Admission source \*** at the top of one form (Option B), with the prerequisite picker adapting to the chosen source.

Option B is favored for downstream analytics (commission tracking, referral ROI): **source is an explicit persisted field**, not inferred from implicit tab UI state.

## Options

| | Option A (current) | Option B (proposed) |
|---|---------------------|---------------------|
| IA | Three tabs; prerequisite control changes per tab | One form; primary `Admission source` drives which picker renders |
| Pros | Strong visual separation; easy discovery for first-time operators | Fewer clicks; source is first-class model value; no tab-switch state loss |
| Cons | Tab choice must be mapped to persisted source; switching tabs can confuse | Slightly denser UI; onboarding may need clearer labels |

## Decision

**Open — halt shipping Option B** until product explicitly chooses **A** or **B** in writing (issue comment, Slack decision, or update to this file).

Implementation in repo as of this ADR retains **Option A** (tabs) pending that sign-off.

**Engineering recommendation:** Option B when product is ready, for cleaner attribution.

## Acceptance

When product selects an option:

1. Update **Status** above to `Accepted`.
2. Record **Chosen option**, **Approver**, and **Date**.
3. If Option B is chosen, implement in the same admissions route without splitting into a separate segment if tied to intake hardening.
