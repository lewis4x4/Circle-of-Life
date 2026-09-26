-- COL-849 Homewood test window: open and wipe scripts, end to end.
--
-- Runs scripts/floor/homewood-test-window-open.sql and scripts/floor/homewood-test-window-wipe.sql
-- (and the COL-695 and COL-735 scripts that put Homewood in its production shape) against
-- test activity driven through the real functions, then checks:
--   * 100% of window rows removed from every inventory table, 0 pre-window rows removed
--     or changed (row hashes), rows at other facilities and from other producers kept;
--   * every guard trigger enabled afterwards;
--   * cadence, escalation, routes, care-event policies, template binding, incident counter
--     and timeclock settings equal to their values before the open; timeclock off;
--   * outside alerts during the window reached Brian only (the delivery fence);
--   * the col695-homewood-timeclock-on cron job untouched; a second open and a second wipe
--     change nothing.
-- The scripts commit, so this probe copies the replayed database, runs in the copy and
-- drops it; the replay's own database is never written. The scripts refuse to open the
-- window at or after 2026-10-01 00:00+00, so from then on the probe reports a skip.

SELECT current_database() AS col849_source_db, (now() >= '2026-10-01 00:00:00+00') AS col849_closed \gset
\if :col849_closed
\echo 'review_homewood_test_window: the COL-849 window closed on 2026-10-01; the one-shot scripts are history and the probe is skipped'
\else
\c postgres
DROP DATABASE IF EXISTS col849_probe;
CREATE DATABASE col849_probe TEMPLATE :"col849_source_db";
\c col849_probe
\ir ../../scripts/floor/fixtures/homewood-test-window-proof.sql
\c postgres
DROP DATABASE col849_probe;
\endif
