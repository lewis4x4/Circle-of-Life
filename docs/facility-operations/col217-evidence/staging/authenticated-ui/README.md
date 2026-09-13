# Authenticated staging UI smoke

Source: `b3e1d819874c942afb737f46eaa632ba54de247c`. Target: `iwcnajanvjvynolltflw`. Synthetic corporate actor; read-only browser actions. Both requested routes returned200 and remained on their actual route at1440px and375px. No failed HTTP responses or page errors occurred in the final run. Operations included Site A selection, Today and History with the finalized synthetic receipts visible. Billing covered the actual invoice ledger and its empty September scope.

**Authenticated rendering passed; UI acceptance has open findings.**

1. **Billing contrast:** `billing-ar-overview-hero.tsx:114` shortcuts text has3.5:1 contrast against4.5:1 required. Serious axe finding at both widths, repeatable.
2. **Operations landmarks:** `PageShell/PageShell.tsx:69` nests main inside `AppShell.tsx:919`; its TopBar and AuditFooter also produce nested/duplicate landmarks. Six moderate axe rules at both widths; treat as one composition fix.
3. **Receipt state wording:** `receipt-history.tsx:64` shows `performed_missing_evidence` beside current Evidence complete/Status completed after successful finalization. Distinguish original immutable receipt state from current satisfaction; this is not a claim of backend failure.
4. **Hydration observation:** initial mobile billing load emitted one hydration mismatch; two subsequent mobile loads did not reproduce it. Candidate source pointer is the hero initial Date state/rendering, but cause remains unverified. Investigate before fixing.

`SUMMARY.json` contains exact source paths, acceptance suggestions and coverage. `report.json` is the final raw browser/axe record; `initial-report.json` retains the hydration error and initial findings. `site-selector-preflight.json` retains the harness's failed exact-label selection; corrected final selection succeeded. Screenshots cover both viewports; `operations-today-*.png` adds the Today state before History.

No business writes were performed. Parent server remains running, fixture reads are complete and fixtures were released for cleanup. This is not staff, clinical, facility or production acceptance.
