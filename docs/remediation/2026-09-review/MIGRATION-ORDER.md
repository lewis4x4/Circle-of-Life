# Migration ordering

The seven new migrations were created through the Supabase CLI, then assigned the repository's next unused numbered versions317–323 before any database deployment. This keeps them after the established001–316 chain under ordinary filename/version ordering. Their SQL behavior is unchanged. The three historical May timestamp migrations retain their original names and positions.

The replay harness uses ordinary filename ordering again; it does not move new files to a special tail. Validate the target's migration history before rollout. No production migration history has been changed.

Supabase's CLI has documented mixed-length version-ordering issues: https://github.com/supabase/cli/issues/6036. Use a CLI incorporating the upstream fix when reconciling the repository's existing mixed history; do not repair production history merely to silence a mismatch.
