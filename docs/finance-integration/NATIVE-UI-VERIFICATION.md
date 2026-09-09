# Native Finance UI verification

The actual Accounting review route now has native Auth/API/browser evidence. Root verified real owner sign-in, a shared-entity25-dollar payment event, explicit empty local-batch/rule states, and both /admin/finance/integration and /finance/integration. The native fixture uses only synthetic records; its platform SELECT grants were verified against hosted metadata and applied locally without RLS or financial write changes.

Actual browser checks found header text contrast below4.5. AppShell now uses its existing foreground token for control/navigation/incident labels, preserving layout, links and the incident accent. Mobile tables also required keyboard access: named focusable tables now scroll with arrow keys, and their inward outline remains visible inside the overflow wrapper. No data or mutation behavior changed.

Independent final validation: zero Axe violations in light/dark desktop1440 and mobile390; no page-width overflow; visible focus contains1418 ring-color pixels in each mobile theme (previously0); arrow scrolling still works;26 component tests and source diagnostics/lint pass. Visual verdict95. The whole HFA-NATIVE-UI gate passed with345 migrations/26 SQL probes, build, lint, stress,8 route/viewport screenshots and2 authenticated routed Axe checks before the final outline-offset-only adjustment; final focused checks cover that adjustment.

The first broad gate failed because a115-byte tsx Unix socket path exceeded the local104-byte sockaddr_un path field. Reusing an83-byte path beneath the same private run fixed the environment; checks and timing budgets were unchanged. Original gate, focus and flaky-test failures remain retained.

Evidence is in test-results/finance-integration/native-ui. This is synthetic owner Chrome evidence, not complete assistive-technology/platform accessibility certification, hosted/provider/business acceptance or release approval. Populated batch/rule browser journeys and other actor journeys remain open.
