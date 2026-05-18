# Constitution lint rules

The `npm run lint:constitution` pass enforces Quiet Operator UI constraints on the active Smart Rounding segment. Set `CONSTITUTION_LINT_SCOPE=all` to audit all `src/` consumers.

## Sentence-case UI

Flags Tailwind `text-uppercase`, `uppercase`, and `tracking-widest` outside shared primitive areas. Operator labels, headers, pills, and buttons should be sentence case. Acronyms such as AHCA, ADL, EHR, POLST, DNR, DNI, and NKA remain valid when the copy itself is an acronym.

## Primitive form controls

Flags native `<select>`, `<input type="date">`, and `<input type="datetime-local">` outside primitive files. Product routes should use shared `Select`, `DatePicker`, `DateTimePicker`, or `Combobox` primitives so styling, empty states, and accessibility behavior stay consistent.

## Value-derived semantic rendering

Flags static alert-color hex styling applied directly in UI components. Red, amber, and green treatments must come from value-derived primitives such as `StatusPill`, `FilterPill`, and `MetricCard`.

Example: pass `value`, `defaultValue`, or thresholds into the primitive; do not hard-code a red border because a row “looks urgent.”

## Operator-facing error copy

Flags `error.message` in JSX/TSX. Raw data-layer errors can disclose implementation details and frequently use non-operator vocabulary. UI copy should be stable and action-oriented, with raw errors confined to logs.

## Operator vocabulary

Flags user-facing strings that mention data-layer concepts such as “source returns rows,” “fetch failed,” or “query error.” Empty and error states should describe the clinical workflow, not the database or API mechanism.
