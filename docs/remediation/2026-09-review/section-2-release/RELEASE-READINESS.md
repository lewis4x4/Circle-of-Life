# Section 2 release readiness

Candidate: login-safe 05c9a179, incorporating the approved Section1 prerequisite and full Section2 corrections. Both independent Section2 source lanes APPROVE. Additional caregiver retry and login hydration corrections were reviewed and regression tested.

Verified:530files/3292passingtests/twoexistingopt-in skips; formal typecheck; strictgate12PASS/oneabsentapps-webskip;336migrations/17SQLprobes; fourconcurrencycases; fiveactualbackfillchecks; full nativeSupabase336migrations and46 signed Auth/PostgREST checks; hostedpreview18 signed-cookie/browser/denialchecks across activeowner,facility-admin,caregiver fixtures; production/preview criticalconfiguration parity; privatebackup andPITR; atomicDDL+ledger cutover rehearsal.

Limitations retained: Local failure-injection browser journeys did not finish reliably because the isolated Auth/gateway environment intermittently timed out and fixture/session state aged during retries. They are not marked passed. Password login and no-JavaScript hydration guards were separately exercised; CSP was never bypassed. Named staff/device UAT remains NOT RUN and is specified in CLINICAL-ACCEPTANCE.md. The existing hosted family fixture is disabled; no access orpassword was changed to manufacture a passing result. Sentry API credentials return401; monitor via platform health/function logs and retain this observability limitation.

The release advances reviewed fixes on the existing prelaunch deployment; it is not a broad clinical launch or a substitute for staff signoff. User explicitly authorized merge, deployment and verification, superseding the earlier correction-only stop boundary. No Section3 implementation is included.

Cutover: recheck quiet rounding state and exacthead, apply330-333 atomically including migrationledger, immediately activate the already-built preview with identical criticalconfiguration, then merge the guardedPR and verify the resulting main deployment. Never roll application alone back to pre331; retain evidence and use a reviewed forward repair or paired restoration if needed. No synthetic clinical records are inserted into production.
