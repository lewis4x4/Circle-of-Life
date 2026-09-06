# Migration ordering

The integrated repository contains **328 migration files** with numbered sequence **`001`–`325`**. The hosted ledger is recorded through **`318`**. Versions `317` and `318` are the deployed referral-closure and facility/entity-name migrations; preserve both their files and hosted history.

The seven remediation migrations created through the Supabase CLI now use versions **`319`–`325`**. Their SQL behavior is unchanged by renaming. They remain pending for controlled hosted deployment. The next free numbered version is **`326`**.

The replay harness uses ordinary filename ordering. The three historical May timestamp migrations retain their original names and positions. Production also records six historical August timestamp migrations, including numbered equivalents; do not replay these or alter their history merely to silence a CLI mismatch.

Supabase CLI mixed-length ordering issue: https://github.com/supabase/cli/issues/6036. Inspect hosted history, deploy only the seven pending remediation migrations in ascending order, and rerun local replay plus remote parity checks before release.

**Integrated verification (2026-09-06):** the required native PostgreSQL 17 replay passed all 328 files plus 10 SQL probes through a repository run-owned socket path; the scratch cluster was stopped and cleaned after proof. The canonical UI-inclusive integrated segment gate is `test-results/agent-gates/2026-09-06T22-51-06-713Z-REVIEW-LIVE-MERGE-20260906.json`. Its Docker replay was optional and successfully skipped because Docker was unavailable; do not represent that skip as the database replay PASS.
