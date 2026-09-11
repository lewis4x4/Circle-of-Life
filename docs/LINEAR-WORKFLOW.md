# Linear delivery, decision, and acceptance workflow

Contract version: `2026-09-11-v1`.

This is Haven's Linear operating contract. Linear routes work and preserves history. Haven specifications, source, hosted state, executed evidence, facility authority, clinical/business acceptance, and release records determine what is true.

## Field contract

| Linear property | Sole meaning |
|---|---|
| Issue | One bounded outcome, written acceptance criteria, and one current next actor |
| Assignee | Person whose action is next; not all stakeholders and not automatic approval authority |
| Status | State of this issue only |
| Blocks / Blocked by | Actual prerequisite or dependent work |
| Related | Context only; never a substitute for sequencing |
| Description | Current contract; link canonical decisions/evidence rather than copying them |
| Comment | Attributable history and evidence; not hidden workflow state |
| Project / milestone | Scope and rollup; not facility, clinical, customer, or launch proof |

## Required issue classes

Use the Linear templates `Delivery`, `Decision / Approval`, and `Release / Acceptance`.

### Delivery

- Assigned to the implementer.
- Contains one bounded outcome, acceptance criteria, dependencies, proof, and rollback/limitation notes.
- Done means its own acceptance criteria passed. It does not mean a broader module, hosted release, facility rollout, or clinical workflow is accepted.

### Decision / Approval

- Assigned to the person whose answer is next.
- Contains one explicit question or approval boundary, context, recommendation and alternatives when applicable, authorized decision maker, required-by event/date, affected issues, and sufficient answer.
- Done means the attributable decision is recorded. It does not mean downstream delivery is complete.

### Release / Acceptance

- Assigned to the authorized approver.
- Contains facility/environment, revision, evidence date, acceptance scope, required evidence, and explicit result.
- Closed manually by the authorized owner. Code, CI, a merge, deployment, local/native replay, synthetic fixture, or agent-written checklist cannot close it.

When delivery waits on a human, keep delivery assigned to its implementer. Create or reuse a separate Decision / Approval issue, assign it to the human, and make delivery `Blocked by` it. One decision may block many delivery issues.

## Status and finding rules

- `Todo`: eligible when blockers clear.
- `In Progress`: active execution.
- `In Review`: technical or peer review only.
- `Done`: this issue's written acceptance criteria are satisfied with evidence.

Never move a Done delivery issue back to In Review to express facility, clinical, customer, or release acceptance. Create a Release / Acceptance issue instead.

Reopen an issue only if its original acceptance criteria were not met. For a new defect, regression, or newly discovered requirement, create one actionable finding per independently fixable outcome and link it to the original issue.

## Ownership and queues

- Do not add `Brian`, `Darren Decision`, or new `owner:<person>` labels. Create saved personal views from open Decision / Approval issues assigned to the person.
- For agent-only execution, use a delegated agent/session when available. Linear app identities in this workspace are not assignable members; when delegation is unavailable, leave the human assignee empty and identify the agent in attributable updates. Never assign Brian merely as a proxy for an agent.
- Existing person labels are legacy migration markers. Before removing one, preserve its ask in a canonical Decision / Approval issue, add real dependency links, and set the next actor. Do not orphan unresolved work through bulk label removal.
- Record a decision once and link every dependent issue to it. Do not repeat an owner answer in descriptions that will become stale.
- Close release/acceptance parents manually after verifying every enumerated gate. Do not rely on parent auto-close for readiness.

## Agent updates

Use a dedicated agent/service identity when available. The current API actor may display `Brian Lewis`; while that remains true, every automated comment must begin:

> Agent update — not human acknowledgement.

An agent may report sourced evidence but must not claim that Brian, a facility operator, clinician, provider, customer, or reviewer decided, approved, accepted, signed off, or was notified without a dated attributable source.

Every closeout records what landed, branch/commit/PR, tests run and not run, facility/environment actually verified, remaining decision/acceptance issues, and the next dependency-ready action.

Track delivery lead time, decision wait time, and acceptance age separately. The combined COL board is not an engineering-throughput report.
