# Insurance acceptance evidence

Synthetic source fixtures in tests/fixtures/insurance are invented test data and do not establish actual coverage or extraction accuracy. Use them to prove workflow invariants: shared premium counted once; no automatic policy publication; source-cited manual correction; contradictory dates stay unresolved; dated endorsement preserves inception; cancellation enters human queue.

Required implementation evidence: actual SQL migration replay and auth/approval probes; request validation and trusted-ingestion tests; rendered operator journey tests; browser routes and accessibility; full lint/typecheck/build/test gates; exact-change independent review.

Production enablement remains distinct: scoped actual entity roster, named insurance reviewers, extractor credentials and allowed document families, representative authorized/redacted scanned/rotated/mixed/encrypted/unreadable corpus, agreed field accuracy and correction thresholds, private document access and live role tests, broker/client acceptance. No model confidence value or synthetic test score substitutes for this. Extraction can remain explicitly disabled while manual reviewed records work.

No automatic sends or certificate issuance are performed by implementation testing. Existing claims/WC records remain separate from clinical incidents, and no employee/claimant medical data belongs in the generic policy extractor.
