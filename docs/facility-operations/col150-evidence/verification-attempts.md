# Verification attempts

The first full suite had one timeout in the unchanged AppShell destination-search test while broad checks ran concurrently. All 11 AppShell tests passed unchanged in isolation. The full rerun uses four workers with unchanged timeouts; its authoritative output is vitest-verified.log.

The first strict gate failed the native ownership probe: COALESCE combined task assigned_role (text) and pinned owner_role (public.app_role). The projection now casts the pinned enum to text. This is an implementation correction, not a waived check. A subsequent strict gate must pass the actual SQL probe before closeout. Both gate attempts are retained.

A test fixture used unsupported evidence status satisfied; it was corrected to the real complete enum value. All nine classification tests passed afterward. Runtime evidence logic was unchanged.

A missing TypeScript sourcemap warning and React act warning do not change test outcomes. No hosted verification is claimed.
