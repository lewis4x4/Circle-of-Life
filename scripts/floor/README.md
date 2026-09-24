# Homewood floor tablet setup scripts (COL-677, COL-695)

Hosted SQL that Brian runs by hand against production before the Homewood go-live on 2026-10-01 (spec `docs/specs/40-floor-tablet-and-kiosk.md` section 9). The build never runs them. Each file prints a report and changes nothing unless its apply switch is set; the full explanation is in each file's header, and the order sits in `docs/homewood/timeclock-cutover.md` under "Oct 1 setup order".

| Order | File | What the apply changes |
|---|---|---|
| 1 | `homewood-pause-cadence.sql` | Puts a cadence version with no windows in force at Homewood now, and schedules the current windows to come back at the Oct 1 day shift start |
| 2 | `homewood-clear-pre-go-live.sql` | Excuses Homewood checks due before go-live that are missed or not done, dismisses their open escalations with the note `before go-live`, skips their queued texts and pushes, resolves the matching executive alerts |
| 3 | `fix-stale-app-roles.sql` | Folds retired role claims (migration 468's mapping) and gives each Homewood floor account a profile, `med_tech`, a linked staff row and Homewood access |

Every run, from the repository root in a checkout linked to production:

```bash
test "$(cat supabase/.temp/project-ref)" = "manfqmasfqppukpobpld" || { echo "WRONG LINK"; exit 1; }

# Dry run: prints the report only.
supabase db query --linked -f scripts/floor/<file>.sql

# Apply: the same file with this script's apply switch set.
{ echo "SET haven.col695_apply = '<file without .sql>';"; cat scripts/floor/<file>.sql; } > /tmp/col695-apply.sql
supabase db query --linked -f /tmp/col695-apply.sql
```

Read the dry run before applying. Each script is safe to run again: a second apply reports nothing left to do. The reports print ids, roles and counts, never resident or staff names.

## Fidelity demo on Haven HFO Staging (COL-694)

Not a Homewood script and never run against production. `seed-prototype-demo.mjs` builds one isolated organization, "Haven Demo Workspace (Fidelity)", with one facility, "Fidelity Demo - Floor Kiosk", and fills it with the prototype's fictional staff, residents, checks, tablets and visits so the floor-kiosk Playwright project and `capture-built-screens.mjs` render the reference states. It reads only `.env.staging.local`, refuses anything but `iwcnajanvjvynolltflw`, and writes device tokens, PINs and passwords to the gitignored `test-results/floor-kiosk/devices.json`. The time strategy is in its header.

```bash
node scripts/floor/seed-prototype-demo.mjs            # capture date = today, Eastern
node scripts/floor/seed-prototype-demo.mjs --ashley-off   # Ashley off the clock, for the kiosk staff states

# Remove it all again (dry run first; apply with the switch, same pattern as above):
test "$(cat supabase/.temp/project-ref)" = "iwcnajanvjvynolltflw" || { echo "WRONG LINK"; exit 1; }
supabase db query --linked -f scripts/floor/fidelity-demo-teardown.sql
{ echo "SET haven.col695_apply = 'fidelity-demo-teardown';"; cat scripts/floor/fidelity-demo-teardown.sql; } > /tmp/fidelity-demo-teardown-apply.sql
supabase db query --linked -f /tmp/fidelity-demo-teardown-apply.sql
```
