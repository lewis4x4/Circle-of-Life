# Homewood decision sheet — what only a person can answer

Prepared 2026-09-10 for COL-140 (HFO-26, Homewood's approved task profile). COL-140 stays unapproved and unstarted until the questions below are answered; none of them blocks the shared application (COL-145, COL-146, COL-148 and later issues build the same workflow for every facility). Until an answer is recorded, every affected rule stays `needs_confirmation` and is never activated; an unknown schedule still allows actual recording without a due judgment. Record each answer with the fields in `TOMORROW-QUESTIONS.md` ("Capture answers without losing their authority"): question id, affected AL items, exact answer, facilities and roles, policy or form and version, effective date, responder, approver, exceptions, and whether it is an existing rule or a proposed change.

## Homewood administrator, with the manager or assistant

| Q | Ask | What it unblocks |
|---|---|---|
| Q01 | Which version of the Admin Log is current at Homewood, what was added, retired or changed, and what belongs in the unnamed checklist columns (Weekly H1, Quarterly C1:H1, Yearly I1, Mental Health C1:M1)? | The Homewood applicability map: which of the 91 catalog items apply, which are retired, which columns are unknown slots rather than duties. |
| Q02 | For each item, who performs it, who checks it, who covers absence, and from what date? Is "manager" the same role as "administrator assistant" in Haven? | The published recorder, reviewer and backup lists per activity; until then ownership is never inferred from a role name and issues stay unassigned until someone names an owner. |
| Q04 | Which "Daily" items run seven days, weekdays, mail-delivery days or only on an event? Who handles weekends and holidays, and when is each due? | The daily schedule rules (the evaluator can express each meaning; no site rule exists yet). |
| Q14 | What exactly is checked for emergency food, AED, generator and CO, inspections, menus, meal substitutions, filters and sanitation, and which equipment exists at Homewood? | Typed inputs, readings and evidence rules per activity; asset bindings (which equipment is a subject). Also needs facilities, dietary and safety input. |
| Q09 | What is Homewood's hood-cleaning schedule and which equipment makes it applicable? | One yearly rule and its asset binding; the Oakridge answer does not transfer. |

## Operations (with Finance for Q05, with a domain reviewer for Q10)

| Q | Ask | What it unblocks |
|---|---|---|
| Q05 | For weekly, monthly, quarterly and yearly work, what is the exact due rule, deadline, grace period and reminder lead time (calendar date, business day, anniversary or expiry)? | Deadline and grace on every non-daily rule; the census "first business day" versus "first couple of business days" rule. |
| Q10 | For each item, what exactly allows someone to mark it done: saved data, a document, a physical check, a signature, a submission receipt or someone else's acceptance? What happens on failure or "not applicable"? | Which evidence rule and review rule each activity carries; the receipt vocabulary (performed, failed, not performed, missing evidence, awaiting verification) already expresses every option without choosing one. |
| Q01 (shared) | See above; Operations confirms which facilities use which log version. | |

## Safety and compliance owner (with HR for Q07)

| Q | Ask | What it unblocks |
|---|---|---|
| Q06 | How many actual fire and elopement drills per year at Homewood, in which months and shifts, which must be outside normal hours, and what is the separate review cadence? | The drill rules; the workbook's "(6)" and "(2)" are not adopted as monthly counts. |
| Q07 | Does "Bi-Annual Facility License Renewal" mean twice a year or every two years? What does "Manager 12 Hour Update Biannually" mean, and which date starts each clock? | The two ambiguous yearly and employee-file rules; neither is translated into a six-month or two-year schedule without the governing document. |
| Q09 (shared) | Hood-cleaning applicability and frequency at Homewood. | |

## Mental-health site administrator and caseworker liaison

| Q | Ask | What it unblocks |
|---|---|---|
| Q08 | Is the Community Support Plan checked monthly, renewed every six months, or both? Are "community support plan" and "support plan" different documents? Which facility is "Hope"? | The monthly review rule separated from the six-month renewal; the facility mapping is never guessed. |

## Brian with Operations

| Q | Ask | What it unblocks |
|---|---|---|
| Q30 | Who reviews the working application at Homewood (named administrator and assistant), on which devices, which second site is used for isolation testing, and what proves it saves work? | The operational acceptance walkthrough and device plan for COL-20 and COL-21; reviewer names never block the build. |

## Owner rulings (Brian): confirm or change the tested defaults

These are engineering choices already implemented, tested and reported in `OWNER-DECISIONS.md`; each is a small change if a different rule is preferred, and none blocks development.

- Item 1: workbook header text naming two people (AL-Y02, AL-C08) kept verbatim in the catalog seed; redact or accept before migration 336 is applied.
- Item 2: whole-run fail-closed automation on a population mismatch versus per-organisation continuation.
- 3a–3f: the evaluator, occurrence, receipt, issue-lifecycle and evidence policies (including the checksum mechanism now verified in source against the Storage eTag).
- 3g (COL-145, on delivery): the governing recorder list may correct and reverse; a correction is a full restatement; the late rule for a correction is anchored on the original recording; evidence carries across a correction chain and never across a reversal; a correction always reopens review when the rule requires it; a reversal returns the occurrence to pending or missed by its deadline; legacy writers refuse managed rows rather than being translated.
- 3h (COL-146, on delivery): drafts live server-side under the actor and expire after 24 hours; a resume replays the stored arguments only; the same person may resume from a new session and nobody else; the browser keeps nothing beyond memory.

## Integrator actions (before any hosted change)

- Finance-first ordering, a fresh hosted-ledger read and final migration numbers (`OWNER-DECISIONS.md` item 5); the completed-export-list policy (item 4); the catalog backfill dry-run (item 6).
- The hosted Storage proof for COL-143 (`STAGING-INTEGRATION-PACKAGE.md`), including the eTag confirmation step. COL-143 closes only when that record exists.
