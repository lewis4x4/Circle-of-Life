# Migration ordering

The integrated repository contains **328 migration files** with numbered sequence **`001`–`325`**. The hosted ledger is recorded through **`318`**. Versions `317` and `318` are the deployed referral-closure and facility/entity-name migrations; preserve both their files and hosted history.

The seven remediation migrations created through the Supabase CLI now use versions **`319`–`325`**. Their SQL behavior is unchanged by renaming. They remain pending for controlled hosted deployment. The next free numbered version is **`326`**.

The replay harness uses ordinary filename ordering. The three historical May timestamp migrations retain their original names and positions. Production also records six historical August timestamp migrations, including numbered equivalents; do not replay these or alter their history merely to silence a CLI mismatch.

Supabase CLI mixed-length ordering issue: https://github.com/supabase/cli/issues/6036. Inspect hosted history, deploy only the seven pending remediation migrations in ascending order, and rerun local replay plus remote parity checks before release.
