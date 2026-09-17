# Admission and discharge register, visitor log, survey print pack

Homewood Lodge keeps a paper admission and discharge log, a paper visitor sign in sheet, and printed survey binders. Haven now prints all three from what it already records. This runbook is the order the change happens in. It is phases, not a calendar: each phase finishes when its own exit condition is met, and the next one starts then.

Nothing here retires the physical fire census board or the evacuation headcount. Those stay exactly as they are.

## Phase: Start

Turn the Visitor Log on at the front desk and keep the paper sign in sheet in parallel. Both are filled in for every visitor. The desk signs a visitor in on the Visitors tab of Front desk: name, type, and whether they are visiting a resident, a staff member, or the facility. The resident picker offers only residents who hold a bed in this building.

At the end of a shift the desk signs out anyone still showing in `In the building now`. Anyone left open past 04:00 reads `Still signed in from` and a date. Haven never closes an entry on its own; somebody decides.

A wrong entry is voided with a reason, never deleted and never typed over. The voided entry stays visible underneath.

Exit condition: the desk is signing every visitor into Haven without being reminded, and the paper sheet and Haven agree for a full week.

## Phase: Compare

Michelle prints a Survey Print Pack for a range and compares it against the binder and the paper admission and discharge log for the same range.

To print: Compliance, Survey print pack. The range defaults to the prior six months. Tick the register, the census record and the visitor log. Choose whether the register shows bed holds; the paper log lists only admissions and discharges, so leave bed holds off for a like-for-like comparison. Print. In Chrome, leave Headers and footers on in the print dialog so each page is numbered.

Every difference is resolved one of two ways and no other:

- **Haven is missing a change.** Correct the resident's status through the flow that owns it, and the register follows. There is no way to edit a register row, by design: a register somebody can type into is the paper log again.
- **The paper log carries a column Haven does not.** Record it as a TBD against the open question in `docs/specs/38-admission-discharge-register-visitor-log.md`. Do not invent a field for it here.

The census record prints days physically present and billable days as separate columns. They differ whenever a resident was at a hospital or away on leave, because a held bed is billable and the resident is not in the building. That is the intended reading, not a discrepancy to reconcile.

Exit condition: Michelle has compared at least one full range, every difference is either traced to a status correction or written down as a TBD, and she says the pack stands in for the binder.

## Phase: Retire

After Michelle approves, the paper visitor sign in sheet and the paper admission and discharge log stop. The binders stay for records that predate Haven, and are not added to.

Nothing is retired before that approval. A binder that stops early is a binder with a gap in it.

Exit condition: the paper sheets are out of the building's daily routine and the binders are archive only.

## Phase: Surveyor walk in

The front desk signs the surveyor in as `Surveyor or regulator`, visiting the facility.

The administrator opens Compliance, Survey print pack, sets the range the surveyor asked for, and prints. The pack is handed over.

Every print writes an audit event naming the building, the sections and the range. It carries no resident name and no visitor name. That event is the record of what was provided, so there is no separate log to keep by hand.

If the print cannot be recorded, the pack does not render and the screen says so. Print again rather than working around it: a pack with no audit row is a pack nobody can account for afterwards.

## What this does not change

- The physical fire census board and the evacuation headcount are unchanged. Haven is not a substitute for either.
- Billing is unchanged. The census record reads the same billable rule Haven already bills on.
- The resident status flows are unchanged. Admitting, discharging, hospital holds and leave happen exactly where they happened before; the register only reads them.
