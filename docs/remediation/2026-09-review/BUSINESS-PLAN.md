# Business lane cleanup plan

Scope B01-B16 and B18; B17 routing is integrated by the lead. Preserve financial, workforce, dietary and external publication capabilities. No production mutations or new dependencies.

1. Add behavioral regressions for incomplete payroll export, historical insurance premium inclusion, same-name employment identity, and missing credential evidence before edits.
2. Replace destructive browser journal saves and cash/trust balance writes with validated transactional database operations. Retain immutable history, RLS, actor identity and retries.
3. Complete payroll collection paging and reject incomplete hours; keep overtime allocation explicitly unverified until approved workweek policy is available.
4. Correct transport eligibility, vendor review errors, publication ordering, staff evidence labels and trust snapshot completeness.
5. Unify dietary persistence; make training and collections failure recovery durable; resolve schedule/swap misleading completion against actual existing assignment capability.
6. Run focused regressions, typecheck/lint, migration checks/replay where available. Record each outcome and remaining integration gates in business.json.

Smells: boundary violations (non-atomic money writes), duplication (competing order contracts), misleading state (unknown evidence as current), missing failure-path tests. Source-level mitigation must not be recorded as a complete external workflow.
