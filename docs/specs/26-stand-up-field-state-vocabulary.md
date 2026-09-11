# Stand Up field-state vocabulary

Version 1. Written from the September 11, 2026 review of Haven Weekly Stand Up and Front Desk. Two identical copies exist: Haven `docs/specs/26-stand-up-field-state-vocabulary.md` and Front Office `docs/specs/stand-up-field-state-vocabulary.md`. A change to one is a change to both; the fix-run gate diffs them.

## 1. Purpose

A facility administrator before the 8:45 a.m. target and a manager on the 9:15 a.m. call must read the same word for the same fact in both applications. Every report has exactly one report state. Every metric on every report has exactly one field state. Every absent figure says why it is absent. Nothing here changes a business decision; the open questions are listed in section 11.

## 2. Report state

One per facility per Monday. The display text is the contract; both applications render it verbatim.

| Display text | Meaning | Haven derivation (workspace payload) | Front Desk derivation (signed feed) |
|---|---|---|---|
| `Not started` | No administrator has entered anything for this facility and Monday | No report, or `entry_origin = initialized` with zero populated fields | `{facility}_reported = 0` |
| `Draft` | Haven holds administrator-entered or recovered figures that have not been submitted | `status = draft`, no submission recorded, `entry_origin` is `manual` or `recovery` (or absent on a legacy record) | reported, not ready, `entry_origin` is 2 or 3 (or absent on a legacy payload), no submission epoch |
| `Imported, awaiting review` | Figures came from the workbook import; no administrator has submitted them in Haven | `status = draft`, no submission recorded, `entry_origin = imported` | reported, not ready, `entry_origin = 1`, no submission epoch |
| `Submitted` | An administrator submitted the report in Haven | `status = ready` | `{facility}_ready = 1` |
| `Changes awaiting resubmission` | The report was submitted and a later draft changed it | `status = draft` and `last_submitted_at` present | `{facility}_needs_resubmission = 1` |

A held or invalid figure never changes the report state. Homewood with an unreadable overtime notation is `Draft`; the problem is carried by the field state of the overtime metric.

Secondary lines under the state (timing, action) are informational and may differ by surface, but they never introduce a second state word. Front Desk uses `Not submitted in Haven; figures from the Google sheet` under `Imported, awaiting review`, and `Submission timing not recorded` where Haven uses the same fact.

## 3. Field state

One per metric per report.

| Token | Code | Display text | Meaning |
|---|---|---|---|
| `provided` | 0 | the formatted value | A value is present and readable |
| `not_provided` | 1 | `Not provided` | An administrator left the figure blank on a Haven-authored report |
| `held_unit_unconfirmed` | 2 | `Held: unit unconfirmed` | Imported overtime withheld because the legacy HH.MM notation is unconfirmed; the raw value stays in provenance and is never converted |
| `needs_duration_review` | 3 | `Needs duration review` | A saved overtime notation that is not valid hours and minutes (today Homewood 15.65 on the open period). The raw value is shown beside the label where the surface has room: `Needs duration review · entered 15.65` |
| `source_held` | 4 | `Source held for review` | The whole source block for that facility and Monday is held for review and was not imported (the March 9, May 25 and June 1 groups). Reserved; see section 8 |
| `no_report` | none | `No report` | No Haven record exists for that facility and Monday, or the record has never been populated |

`no_report` has no numeric code because an unreported facility carries no per-metric rows in the feed; the consumer derives it from `{facility}_reported = 0`.

Display text is used wherever a value would otherwise appear: tables, tiles, facility details, Haven reference lines under fields, Haven history rows, the Haven review screen, and the CSV. Blank is never rendered as zero and zero is always rendered as `0` (or `$0.00`, `0h 00m`).

## 4. Derivation

### 4.1 Haven, per report and metric

Order of evaluation, first match wins:

1. No report, or `entry_origin = initialized` with zero populated fields: `no_report`.
2. Metric is `overtime_reported` and the report's `overtime_issue` is true, or the stored notation does not convert to whole minutes: `needs_duration_review`.
3. Value is null and the report's `field_dispositions[metric]` is `historical_unit_unconfirmed`: `held_unit_unconfirmed`.
4. Value is null: `not_provided`.
5. Otherwise: `provided`.

`field_dispositions` is exposed on every report by the workspace, save and recovery responses. It is read from the revision provenance written by the historical import (`provenance.row.field_dispositions`). When a later revision leaves the metric null, the disposition of the most recent revision that carried one is kept, so a held import stays held until an administrator enters a value. Once a value is entered the disposition no longer applies.

The all-facilities overview, the sticky save bar and the review screen count only `provided` metrics. A held raw value is not counted.

### 4.2 Haven publisher, per report and metric

The latest feed and the rolling history archive publish, for every reported facility and every one of the sixteen metrics, a row `{facility}_{metric}_state` carrying the code from section 3, derived by the rules in 4.1 from the same exported report. The publisher also publishes one global row `field_state_version` with value `1`.

The publisher publishes states only when every report in the payload carries `field_dispositions`. If any report lacks it (Haven not yet migrated), the payload is published without `field_state_version` or state rows and is a legacy payload.

Unreported facilities carry no state rows. Nothing about the sixteen raw metric rows, the canonical minutes, the status rows or the observation-time rows changes.

### 4.3 Front Desk, versioned payload

A payload carrying `field_state_version = 1` is versioned. For a reported facility, the state of each metric is the published code. A missing state row for a reported facility under version 1 is treated as `not_provided` when the value is absent and `provided` when it is present. For an unreported facility every metric is `no_report`.

Validation (whole snapshot withheld on failure, matching the existing fail-closed rule): a code outside 0 to 4; a state row for an unreported facility; code 0 with the value absent; code 1, 2 or 4 with the value present; code 3 on any metric other than overtime, or on overtime when the raw notation converts and no issue flag is set.

### 4.4 Front Desk, legacy payload

A payload without `field_state_version` derives exactly the facts available today: unreported facility is `no_report`; overtime with an issue is `needs_duration_review`; any other absent value is `not_provided`; present values are `provided`. A legacy payload never yields `held_unit_unconfirmed` or `source_held`.

## 5. Transport encoding and `field_state_version`

- Global row `field_state_version`, integer, value `1` for this version.
- Per-facility rows `{facility}_{metric}_state` for the five facility prefixes (`homewood`, `oakridge`, `rising_oaks`, `plantation`, `grande_cypress`) and the sixteen metric keys, integer code 0 to 4.
- Both datasets, `standup_weekly` (latest) and `standup_weekly_history`, gain these names in their allowed metric lists. History validation accepts the new names as optional.
- Every existing name keeps its meaning. No name is removed. The signed envelope, sequence, idempotency, source-as-of monotonicity and retention rules are untouched.

A later version increments `field_state_version` and documents its own rules here; consumers treat an unknown version as legacy.

## 6. Freshness

Front Desk footer, current feed:

- One pill, `Feed received {age}`, colored only by the age of the newest admitted receipt against the latest-feed thresholds registered in `scripts/register-stand-up.mjs`: within 300 seconds fresh (success tone), past 300 seconds stopped-warning (warning tone), past 900 seconds stopped (destructive tone). The age wording is plain: `29 s ago`, `6 min ago`, `2 h ago`.
- One neutral sentence, never colored: `Observation time: unknown` when any reported facility in the full source report lacks its own timestamp, otherwise `Observation time: {timestamp} ET`.
- The receipt timestamp stays visible.

Missing observation time never colors the pill. Server-side delivery health is still returned in the payload but no longer drives the pill.

Weekly history dataset thresholds stay 25,200 and 43,200 seconds; the history footer keeps `History last synced` as today.

## 7. Rules carried forward unchanged

- Blank is not zero. A real zero is entered and shown as `0`.
- Census, open beds and monthly rent roll are snapshots; they are never summed across weeks.
- Imported data never manufactures a submission time or an observation time.
- Overtime is integer minutes, entered as hours plus minutes. Legacy HH.MM is retained as raw evidence and is never converted when it does not validate.
- Money is integer cents in any new column.
- A held value is never counted as provided and never enters a total.
- No resident or staff names enter the numeric feeds.

## 8. Decision record: `source_held`

The desktop-pane review asked for a distinct answer for the held source blocks, and the goal handoff folded them into `no_report`. This vocabulary keeps the token because a manager asking why March 9 is empty deserves "the source block is held for review", not "no report existed".

Finding of the fix run: Haven holds no record for a held source block. The held groups live only in the private review projection on the import operator's machine and were never imported. The publisher reads Haven only, so it cannot derive `source_held` from a stored fact, and a status that cannot be traced to a stored fact is not published.

Decision for version 1: the publisher publishes `no_report` for those weeks. Both applications render `Source held for review` if the code ever arrives, and the CSV carries the token. TBD: once the held groups are resolved (section 11, items 4 and 5), either import them as held records with a provenance disposition, or record the held Mondays in Haven so the publisher can state the fact. Until then the trend rows for those Mondays read `No report`.

## 9. Aggregates and CSV

For a headline tile or a trend point that has no usable figure:

- `No report` when no facility in the selection has a report for that week.
- Otherwise the shared state of the absent fields when they agree.
- Otherwise the most severe in this order: `source_held`, `held_unit_unconfirmed`, `needs_duration_review`, `not_provided`.

Coverage (`n/5 facilities`) is shown beside every aggregate as today.

The CSV keeps its numeric `Value` column empty when the figure is absent, renders the display text in `Formatted value`, and adds a `Field state` column carrying the token (`provided` when a figure is present). No other column changes meaning.

## 10. Deployment order and compatibility

1. Front Office: apply the allowlist and validator migration, deploy the application. It renders legacy payloads by section 4.4 until the publisher changes.
2. Haven: apply the `field_dispositions` migration, deploy the application, then update the publisher. The publisher starts sending versioned payloads on its next poll.

If the publisher is updated before the Front Office migration, the ingest endpoint refuses the batch because of the unknown metric names, the publisher records the rejection without advancing its sequence, and the batch is accepted on the next poll after the migration. No figure is lost and nothing is shown wrongly in the meantime. The consumer never needs the publisher to be updated first.

## 11. Open items (TBD, business decisions, not implemented by the fix run)

1. Who submits for each ALF and who is the backup.
2. Homewood September 7 overtime `15.65`: 16h 05m typo, 15.65 decimal hours, or other.
3. Historical overtime convention before the current period (HH.MM, decimal or mixed). All imported overtime stays `held_unit_unconfirmed` until answered.
4. Held record groups: March 9 (missing bed label), May 26 (Tuesday date), June 3 (Wednesday date, duplicated census), January 19 Grande Cypress fractional outreach.
5. Whether held groups are imported as held records or recorded as held Mondays (section 8).
6. Partial submission: whether a blank may be submitted by 8:45 a.m. or blocks submission (today it blocks).
7. `Current AR` versus `Monthly rent roll` label.
8. Metric definitions absent from both UIs.
9. Whether management sees the raw held value in Front Desk (this version assumes yes) and whether owners see the roster empty state (this version assumes yes).
10. Who prepares the editable backup for an internet outage and where it lives.
