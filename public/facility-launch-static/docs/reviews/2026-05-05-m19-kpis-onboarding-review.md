# Facility Launch Center — M19 "Reports / Dashboards / KPIs" Onboarding UX Review

**Date:** 2026-05-05
**Scope:** `src/intakeCatalog.js` (lines 262–281), rendering path in `src/app.js` (lines 258–352), seed copy in `src/seedData.js` (lines 26, 48), styling in `styles.css`.
**Mode:** Read-only review. No source files modified.
**Audience for the rewrite:** Non-technical executives and operators (CEO, CFO, COO, Executive Director, DON, Sales/Admissions, Business Office Manager) filling this out during Homewood go-live onboarding.
**Author:** JARVIS

---

## Context / Scope

M19 is the last of the 19 launch modules and is the only module that talks about *measuring* the launch instead of running it. It currently presents itself as a BI/analyst form: "Define the dashboards, KPIs, owners, cadence, and launch success metrics…" with a `kpiDefinitions` collection whose required fields include `businessQuestion`, `dataSource`, `refreshCadence`, `launchThreshold`, and `actionIfOffTrack`.

That language is correct for a data team. It is the wrong language for an Executive Director at hour 18 of onboarding, and it is the wrong language for the people who actually own these numbers (COO, ED, DON). Three observable problems:

1. **The framing implies "build a BI spec," when the real ask is "list the numbers we're going to stare at for the first 30 days."** Operators read "KPI definitions" and either freeze (they're not analysts) or copy in policy boilerplate (which is exactly the "policy fiction" that M8's renderer warns against — `intakeCatalog.js:64`).
2. **The required-field set blocks completion on jargon.** `businessQuestion`, `dataSource`, `launchThreshold`, and `audience` are all required (`intakeCatalog.js:275`), so M19 cannot reach 100% without filling nine columns per row. The scoring path (`scoring.js:120–128`) requires *at least one fully complete row* per collection, so the friction is real, not cosmetic.
3. **The render path gives M19 no special treatment.** `renderOperationalIntakeModules` (`app.js:332–352`) emits the same `<details>` + checklist-grid + record-form/table that M5–M18 use. There is no intro that distinguishes "this is the scoreboard, not another data-entry table." The checklist (`Census, Occupancy, Revenue/rates, Incidents, Staffing, Rounds completion, Med/diet exceptions, Admissions pipeline, Open work orders, Launch success criteria`) reads as a list of *modules* the operator already entered — making M19 feel like a duplicate rather than a synthesis.

Compounding this: per the prior M15–M18 review (`docs/reviews/2026-05-05-m15-m18-ux-review.md`), the checklist chips render as button-shaped tiles (`styles.css:80–82`) but are non-interactive. That bug applies here too — M19's checklist looks more clickable than any other element in the module.

---

## Findings

### Finding 1 — "KPI definitions" is the wrong frame for this audience

The collection is labeled **"Dashboard/KPI definitions"** with addLabel **"Add KPI definition"** (`intakeCatalog.js:273–274`). The seed source-of-truth note in `seedData.js:48` reinforces it: `["COO", "Executive Reporting", "Launch dashboard/KPI definitions"]`.

This naming has two costs:

- **It's intimidating.** EDs and DONs do not write "KPI definitions." They watch occupancy, rounds completion, and incident counts. The module is asking them to formalize what they already track informally — but the form makes it look like they need to invent a measurement program.
- **It misrepresents the deliverable.** What this module actually produces is *a launch scoreboard*: the short list of numbers leadership will look at every day for 30 days to know whether the facility is healthy. Nobody is building Tableau dashboards in this app.

**Recommendation: reframe away from "KPI definitions."**

Rename the module and the collection in plain operator language. My recommended phrase set, in priority order:

| Surface | Today | Recommended |
|---|---|---|
| `moduleName` (`seedData.js:26`) | `Reports / Dashboards / KPIs` | **`Launch Scoreboard / Operating Reports`** |
| `priority` (`intakeCatalog.js:263`) | `Executive operating visibility` | **`Executive go-live visibility`** |
| `purpose` (`intakeCatalog.js:264`) | `Define the dashboards, KPIs, owners, cadence, and launch success metrics executives need to run the facility after go-live.` | **`Lock the short list of numbers leadership will check every day for the first 30 days, who owns each number, where it comes from, and what we do when it slips. This is the launch scoreboard — not a BI spec.`** |
| `recommendedModuleOwners[M19]` source (`seedData.js:48`) | `Launch dashboard/KPI definitions` | **`Launch scoreboard worksheet`** |
| `collections[0].label` (`intakeCatalog.js:273`) | `Dashboard/KPI definitions` | **`Numbers we'll watch at go-live`** |
| `collections[0].addLabel` (`intakeCatalog.js:274`) | `Add KPI definition` | **`Add a number to watch`** |
| `collections[0].key` | `kpiDefinitions` | **Keep as-is.** Renaming the data key is a state-migration cost with no user benefit; only the rendered label needs to change. |

If the team prefers to keep "KPI" in the module name for continuity with the executive guide, the alternative is `Launch Scoreboard (Reports / Dashboards / KPIs)`. The user-facing collection label and addLabel should still be plain English.

---

### Finding 2 — Scalar fields and required-field labels speak analyst, not operator

Today's three scalar fields (`intakeCatalog.js:265–269`):

```
executiveDashboardAudience  → "Dashboard audience"
reportCadence               → "Report cadence"
kpiOwner                    → "KPI owner"
```

And the per-row required fields (`intakeCatalog.js:275–278`):

```
kpiName, businessQuestion, dataSource, owner,
refreshCadence, target, launchThreshold, audience, actionIfOffTrack
```

Three problems with the labels themselves:

- **"Cadence" is consultant-ese.** Operators say "how often."
- **"Business question" reads as homework.** They will write "Are we tracking occupancy?" — which is tautological. The intent is *why this number matters*. Say that.
- **"Threshold" vs "Target" is confusable.** Two numbers, both green/red, no clue which trips which alert. Make the time horizon explicit.

**Recommendation: rewrite the labels and reduce required cognitive load.**

Scalar fields:

| Key | Today's label | Recommended label | Recommended `sampleValue` |
|---|---|---|---|
| `executiveDashboardAudience` | Dashboard audience | **Who reviews these numbers** | `CEO, CFO, COO, ED, DON` *(unchanged — already concrete)* |
| `reportCadence` | Report cadence | **How often we review them** | `Daily 9am huddle for first 30 days; weekly executive rollup after that` |
| `kpiOwner` | KPI owner | **Scoreboard owner** | `COO — assembles the daily scoreboard and chases gaps` |

Per-row collection fields (`requiredFields` line 275, `fields` line 278):

| Key | Today's label | Recommended label | Recommended placeholder/sample |
|---|---|---|---|
| `kpiName` | KPI | **Number we're watching** | `Rounds completion %` |
| `businessQuestion` | Business question | **Why we watch it** | `Are required resident checks happening on time? Missed rounds = safety + survey risk.` |
| `dataSource` | Data source | **Where the number comes from** | `App rounds log, exported each morning by night-shift lead` |
| `owner` | Owner | **Person on the hook** | `DON — Maria Hayes` |
| `refreshCadence` | Refresh cadence | **How often it's updated** | `Refreshed every morning by 8am` |
| `target` | Target | **Steady-state target (after day 30)** | `≥ 98% rounds completed on time` |
| `launchThreshold` | Launch threshold | **Day-1-to-30 floor (alert if below)** | `≥ 95% for the first 14 days, then re-baseline` |
| `audience` | Audience | **Who sees this number** | `COO, ED, DON on the daily huddle` |
| `actionIfOffTrack` | Action if off-track | **What we do if it slips** | `DON pulls the assignment sheet at huddle, reassigns, documents reason in app` |

Field-level rationale:

- **Splitting "target" and "launch threshold" into "steady-state target" and "day-1-to-30 floor"** removes the most common confusion and makes the pair self-explanatory without a tooltip.
- **"Person on the hook" beats "Owner".** `Owner` is also used in the launch-accountability matrix (`app.js:209`); keeping the same word here implies the same role, which it isn't. The scoreboard owner is the *single accountable human* per number, distinct from the module data owner.
- **"Where the number comes from"** also primes the operator to flag numbers that have *no* automated source yet — which is the early-warning signal the COO actually wants from this exercise.

Optional: consider making `audience` non-required. It is almost always a subset of `executiveDashboardAudience` (the scalar). Demanding it on every row produces copy-paste data with no decision value, and removing it from `requiredFields` drops the per-row required count from 9 to 8 without weakening the model.

---

### Finding 3 — The intro copy and checklist do not orient the reader

Today's intro in the rendered module is built from two pieces (`app.js:340–341`):

```
<strong>Executive operating visibility</strong> — Define the dashboards, KPIs, owners, cadence, and launch success metrics executives need to run the facility after go-live.
[Required capture checklist]
✓ Census  ✓ Occupancy  ✓ Revenue/rates  ✓ Incidents  ✓ Staffing
✓ Rounds completion  ✓ Med/diet exceptions  ✓ Admissions pipeline
✓ Open work orders  ✓ Launch success criteria
```

The checklist reads as a list of M5–M18 modules the operator just finished. That is exactly wrong: it makes M19 feel redundant when it is actually the *only* place those modules connect into a single executive view.

**Recommendation A: replace `priority` + `purpose` with one paragraph that states the job-to-be-done.**

The combined intro should read (rendered output):

> **Executive go-live visibility** — Lock the short list of numbers leadership will check every day for the first 30 days, who owns each number, where it comes from, and what we do when it slips. This is the launch scoreboard — not a BI spec. If a number isn't on this list, no one will look at it during go-live.

The closing sentence ("If a number isn't on this list…") is the operator-friendly equivalent of the policy-fiction warning M8 already uses.

**Recommendation B: rewrite the checklist from "data domains" to "scoreboard guardrails."**

The current checklist conflates two things: (a) "topics your scoreboard should cover" and (b) "fields you need to fill in." Operators read it as the latter and panic. Replace with a short, actionable guardrail list:

| Today's checklist item | Recommended replacement |
|---|---|
| Census | **At least one resident-safety number (e.g., rounds completion, incidents)** |
| Occupancy | **At least one census/occupancy number** |
| Revenue/rates | **At least one revenue or billing-health number** |
| Incidents | **At least one staffing-coverage number** |
| Staffing | **At least one admissions/move-in pipeline number** |
| Rounds completion | **Each number has a single named owner (not a department)** |
| Med/diet exceptions | **Each number has a documented source (system, log, or person)** |
| Admissions pipeline | **Each number has both a day-1-to-30 floor and a steady-state target** |
| Open work orders | **Each number has a written "what we do if it slips" action** |
| Launch success criteria | **Daily review cadence and reviewer roster confirmed for the first 30 days** |

This checklist now describes *the shape of a healthy scoreboard* instead of duplicating the upstream modules. It also gives the COO a concrete completeness test ("do we have one number per category, each with an owner and an action?") that is impossible to read off the current list.

If shortening is preferred, the minimal viable subset is:

1. Resident-safety number with owner + source
2. Census/occupancy number with owner + source
3. Revenue number with owner + source
4. Staffing number with owner + source
5. Admissions number with owner + source
6. Daily review cadence and reviewer roster confirmed

---

### Finding 4 — One sample row is not enough scaffolding

The catalog ships exactly one `sampleRecord` (`intakeCatalog.js:276`), for "Rounds completion." Operators staring at a one-row example tend to (a) duplicate it for every metric or (b) leave the table empty because they do not know what shape the *other* numbers should take.

**Recommendation: keep the data structure (one `sampleRecord` per collection is the catalog convention), but supply additional examples in the intro copy or as placeholder text in the form fields.** The placeholders proposed in Finding 2 already do half this work; the other half is a 3–5 row reference set the operator can paste from. Suggested examples to include in the intro paragraph or a new `examples` array on the spec:

- **Census / occupancy** — "Occupied beds vs licensed beds, refreshed daily from the move-in log." Owner: ED. Floor: ≥ 85% by day 30. Action if off: weekly sales pipeline review with COO.
- **Revenue health** — "Billed revenue vs budget, refreshed monthly from QuickBooks." Owner: CFO. Floor: within 5% of budget for first 60 days. Action if off: CFO + ED rate-and-concession review.
- **Resident safety** — "Rounds completion %, refreshed daily from app logs." Owner: DON. Floor: ≥ 95% first 14 days. Action if off: huddle reassignment + documented reason.
- **Staffing coverage** — "Open shifts vs scheduled shifts, refreshed daily from schedule." Owner: ED. Floor: ≤ 2 open shifts/day for first 30 days. Action if off: agency authorization + ED sign-off.
- **Admissions pipeline** — "Tours-to-deposit conversion %, refreshed weekly from CRM/spreadsheet." Owner: Sales/Admissions Director. Floor: ≥ 1 deposit/week for first 8 weeks. Action if off: ED + Sales joint review.

Storing these as a `referenceExamples` array on the M19 spec (and rendering them as a subdued "Borrow from these examples" panel above the form) is the cleanest path. This is purely additive to the catalog schema; existing rendering still works.

---

### Finding 5 — Render-path implications (no edits, but flag for the implementer)

The rewrites above are mostly copy. Three small render-path observations the implementer should keep in mind when applying:

1. **Checklist chips still look clickable.** `styles.css:80–82` gives `.checklist-grid li` a button-like treatment (rounded, bordered, `font-weight: 750`, `cursor: default` is set but the visual still reads as a button). Either tone the styling down for M19 (drop the border + fill, use `disc` markers) or wire the chips to a real interaction. Per the M15–M18 review this is a cross-cutting fix, not M19-specific — but M19's checklist is the *most* misleading because it overlaps with module names elsewhere in the app.
2. **The "0 record(s)" badge implies trivial completion.** With the new field labels, an empty M19 collection means "no scoreboard exists yet" — which is the most consequential gap in the entire app at go-live. Consider giving M19 a stronger empty-state message than the generic `"No dashboard/kpi definitions entered yet. This module cannot come alive until this data is captured."` (`app.js:323`). Suggested empty-state copy: **"No scoreboard numbers yet. The COO cannot run the daily go-live huddle until at least one number per category is entered here."**
3. **`renderScalarIntakeFields` puts the three scalar fields in a 2-column grid (`app.js:248`).** With the renamed label "Scoreboard owner," the third field will wrap awkwardly. Either widen to a 3-column grid for M19 only, or accept the wrap — minor cosmetic issue, not a blocker.

None of these requires code in this review; they are notes for the implementer applying the catalog rewrites.

---

## Recommendations (concrete rewrite, ready to paste)

### `src/seedData.js`

- Line 26: change `moduleName` from `"Reports / Dashboards / KPIs"` to **`"Launch Scoreboard / Operating Reports"`** (or, if the team wants to preserve continuity with the executive guide, **`"Launch Scoreboard (Reports / Dashboards / KPIs)"`**).
- Line 48: change source label from `"Launch dashboard/KPI definitions"` to **`"Launch scoreboard worksheet"`**.

### `src/intakeCatalog.js` — full rewrite of M19 (lines 262–281)

```javascript
M19: {
  priority: "Executive go-live visibility",
  purpose: "Lock the short list of numbers leadership will check every day for the first 30 days, who owns each number, where it comes from, and what we do when it slips. This is the launch scoreboard — not a BI spec. If a number isn't on this list, no one will look at it during go-live.",
  fields: [
    { key: "executiveDashboardAudience", label: "Who reviews these numbers", sampleValue: "CEO, CFO, COO, ED, DON" },
    { key: "reportCadence", label: "How often we review them", sampleValue: "Daily 9am huddle for first 30 days; weekly executive rollup after that" },
    { key: "kpiOwner", label: "Scoreboard owner", sampleValue: "COO — assembles the daily scoreboard and chases gaps" }
  ],
  checklist: [
    "At least one resident-safety number (e.g., rounds completion, incidents)",
    "At least one census/occupancy number",
    "At least one revenue or billing-health number",
    "At least one staffing-coverage number",
    "At least one admissions/move-in pipeline number",
    "Each number has a single named owner (not a department)",
    "Each number has a documented source (system, log, or person)",
    "Each number has both a day-1-to-30 floor and a steady-state target",
    "Each number has a written action for when it slips",
    "Daily review cadence and reviewer roster confirmed for the first 30 days"
  ],
  collections: [{
    key: "kpiDefinitions",
    label: "Numbers we'll watch at go-live",
    addLabel: "Add a number to watch",
    requiredFields: ["kpiName", "businessQuestion", "dataSource", "owner", "refreshCadence", "target", "launchThreshold", "actionIfOffTrack"],
    sampleRecord: {
      kpiName: "Rounds completion %",
      businessQuestion: "Are required resident checks happening on time? Missed rounds = safety + survey risk.",
      dataSource: "App rounds log, exported each morning by night-shift lead",
      owner: "DON — Maria Hayes",
      refreshCadence: "Refreshed every morning by 8am",
      target: "≥ 98% rounds completed on time",
      launchThreshold: "≥ 95% for the first 14 days, then re-baseline",
      audience: "COO, ED, DON on the daily huddle",
      actionIfOffTrack: "DON pulls the assignment sheet at huddle, reassigns, documents reason in app"
    },
    fields: [
      { key: "kpiName",            label: "Number we're watching" },
      { key: "businessQuestion",   label: "Why we watch it" },
      { key: "dataSource",         label: "Where the number comes from" },
      { key: "owner",              label: "Person on the hook" },
      { key: "refreshCadence",     label: "How often it's updated" },
      { key: "target",             label: "Steady-state target (after day 30)" },
      { key: "launchThreshold",    label: "Day-1-to-30 floor (alert if below)" },
      { key: "audience",           label: "Who sees this number" },
      { key: "actionIfOffTrack",   label: "What we do if it slips" }
    ]
  }]
}
```

Notes on the rewrite:

- **Data keys are unchanged.** Only labels, copy, and checklist content move. No state migration, no scoring change, no export/markdown change beyond the rendered text.
- **`audience` was dropped from `requiredFields`** (was 9 required fields, now 8). It is still captured and still rendered — it just no longer blocks completion. If the team prefers strict parity, restore it; the rest of the rewrite stands.
- **`businessQuestion` retains its key** but its label and sample now describe *why this number matters* in operator terms, not "what question does the dashboard answer."

### Optional follow-on (additive, not blocking)

Add a `referenceExamples` array of 4–5 prefilled rows to the M19 spec and render them as a "Borrow from these examples" subdued panel above the form. Suggested rows are listed in Finding 4. This is the single highest-leverage UX add for this module — it converts a blank-form-paralysis problem into a "pick three to start" problem. Worth a separate ticket.

---

## Summary

- **Reframe the module away from "KPI definitions."** Rename to **Launch Scoreboard / Operating Reports**; rename the collection to **Numbers we'll watch at go-live**, addLabel **Add a number to watch**. Keep the data key `kpiDefinitions` as-is.
- **Rewrite all nine collection field labels and three scalar field labels in operator language**, with the most consequential change being to split `target` and `launchThreshold` into "Steady-state target (after day 30)" vs "Day-1-to-30 floor (alert if below)."
- **Replace the 10-item topic checklist with 10 scoreboard-guardrail items** that describe what a healthy scoreboard looks like instead of listing the upstream modules.
- **Rewrite the intro copy** to state the job-to-be-done in one paragraph and end with the policy-fiction-style warning ("If a number isn't on this list, no one will look at it during go-live").
- **Optionally drop `audience` from `requiredFields`** to lower per-row friction without weakening the model.
- **Optionally add a `referenceExamples` panel** of 4–5 prefilled scoreboard rows the operator can borrow from. Highest-leverage add; not strictly required.
- **Render-path notes:** the misleading-button checklist styling (`styles.css:80–82`) and the generic empty-state message (`app.js:323`) are cross-cutting issues already flagged in the M15–M18 review; M19 amplifies both.
