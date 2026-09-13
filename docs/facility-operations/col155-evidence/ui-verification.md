# COL155 UI verification

Local source proof only; no hosted/native clinical acceptance claimed.

- Exact canonical mapping: 36 source items, 41 components; only resident record_review mappings expose source-review selection. Other kinds retain native/manual fallback.
- 12 focused source-review/history tests pass. Nine picker tests plus 30 existing work-page tests passed together (39 total) before adding the three isolated history tests.
- npm run typecheck and targeted ESLint pass.
- Structural axe passed for open picker/form; color contrast requires actual browser proof.
- Tests cover selected source-version and existing findings payload, unsupported native action fallback, bytewise uncertain retry, period and actor request abort/reset, wrong task reply rejection, pagination, unavailable history redaction and explicit recheck history.
- Initial test harness attempt had six failures because fireEvent.toggle is not a supported helper; replaced with actual userEvent summary clicks. This was a harness failure, not an application defect. Subsequent tests passed.
- Native backend authorization, SQL concurrency, full strict gate and authenticated browser proof remain parent/backend obligations. The UI does not create care, arrival, provider signatures or clinical approval.
