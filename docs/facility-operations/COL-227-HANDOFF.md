# COL-227 invoice refresh shortcut

The sole application change removes the inner overview-only return from the R-key case. The existing outer route guard, typing checks and command/control exclusions remain; heading, timestamp and contrast changes are preserved.

Fresh before proof on the reviewed heading prerequisite shows invoices R=0 and overview R=1, with visible Refresh=1 at375/1440. Final after proof shows R=1 and button=1 on both routes and widths, with each required scoped invoice refetch returning HTTP200 and zero fixture rows. Focus, facility scope, slash search and E export behavior are preserved. Six guard cases produce no refresh: actual search input, native typing in explicit temporary textarea/select/contenteditable fixtures, and synthetic Ctrl/meta keyboard events that avoid browser reload. The temporary controls are removed before axe/screenshots.

All four after cases have zero axe/page/console/HTTP errors.11 existing billing tests/typecheck/lint and all11 mandatory checks pass, including369 migrations/49 probes. Final gate:2026-09-13T07-53-51-349Z-COL-227-INVOICE-REFRESH.json. Independent review:[PROOF PASS — CLEAN].

The initial baseline exposed the separate Action queue heading-order finding, repaired in COL228/PR501 and mergedac96fe84. Its earlier failing artifacts remain preserved. COL227 resumed from reviewed source53f988ec and did not combine the semantic heading repair into this R change.

The same owned synthetic fixture was retained during the prerequisite; login-only setup renewed its session without recreating or reactivating it. It is now fully retired: actor banned/inactive, zero grants, exact site/entity retired, owned4343 closed. COL228's retained-fixture obligation is fulfilled. No invoice, financial-policy or production write occurred.

Main integration and production release remain pending at this source closeout. Revert only this bounded handler change if required; retain audit/proof history. No operating acceptance is inferred.
