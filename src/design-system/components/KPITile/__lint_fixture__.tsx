/**
 * Lint fixture for `require-kpi-info` (S1 rule).
 *
 * Purpose: document the boundary between valid and invalid `<KPITile>` usage
 * so a reviewer can see at a glance what the rule is enforcing. The rule fires
 * when `value` is an expression (computed) but no `info` tooltip copy is
 * provided — reviewers who remove the suppression below should see
 * `ui-v2/require-kpi-info` raise an error, matching the synthetic case
 * exercised by `src/design-system/components/KPITile/lint-rule.test.ts`.
 */
import { KPITile } from "./KPITile";

const computed: number = 42;

export function ValidKPIUsage() {
  return (
    <>
      <KPITile label="Count" value={7} />
      <KPITile label="Census" value={computed} info="Residents in scope today." />
      <KPITile label="Fixed" value="99" />
    </>
  );
}

export function InvalidKPIUsageSuppressed() {
  return (
    // eslint-disable-next-line ui-v2/require-kpi-info -- fixture documents the rule; unit test proves it fires unsuppressed
    <KPITile label="No info" value={computed} />
  );
}
