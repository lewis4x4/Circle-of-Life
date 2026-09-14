# COL-160 independent rebased-source review

Verdict: **FAIL — P2 due-date provenance validation**. Mandatory final UI segment gate remains pending.

Reviewed head `e55bc3df65e9da5ed21c726d62b8b9d06a2b9b3a`; exact frozen20file manifest `bd9e341251db89ac27bccefb47e6637b4c9991002308219d09a219be2f8cb88a` and original21file commit diff remain unchanged after corrected-main rebase.

Authenticated direct `configure` RPC accepts a due date with whitespace-only `due_provenance`, stores the provenance as NULL, and marks the due state documented. The HTTP schema rejects this input, but authenticated RPC is independently callable. Add bounded nonempty SQL validation before mutation and a native regression; repeat final exact-source gates.

Fresh independent checks pass: focused36 tests, native371 probe, concurrency7 cases, actual Front Office parser/protocol harness with zero calls, Stand Up Python120, and diff whitespace check. All review-owned native databases were dropped.

Full machine-readable identity, reproduction and evidence hashes: `rebased-source-review.json`. This artifact does not approve hosted, production, staff, provider, live Front Office receipt or operating acceptance.
