# COL Response Ingest — 2026-05-06

Source files ingested:
- `docs/specs/COL-RESPONSE-LOG-2026-05-06.md`
- `docs/specs/HAVEN-SPEC-DELTAS-2026-05-06-v2.md`
- `docs/specs/HAVEN-LAUNCH-RECAP-2026-05-06.txt`

## Confirmed Homewood / COL data now available

- Homewood first-pass scope only for M1-M7 launch discovery.
- Homewood room/bed model: 20 rooms, 36 beds, one floor, no wings.
- Rooms 1-4 are private singles; rooms 5-20 are companion doubles.
- Standard posted rates: private room $5,550/month; companion room $4,000/month.
- Actual resident rates are individually negotiated.
- Medicaid model: resident contracted private amount + provider amount, capped at posted room rate when Medicaid is involved.
- Resident status model: active, bed hold hospital, bed hold vacation, discharged; used for billable-day tracking.
- Quickmar remains live MAR in Phase 1; daily export is required and missed-export alerts go to Administrator, Assistant, Michelle, Jessica.
- Activities module replaces Donny/Dieter dietary concept; track attendance, who conducted activity, start time, initials, and alert if two required daily activities are not completed.
- Rounds: Haven owns rounds; Quickmar rounds disabled. Homewood day shift is 6a, 10a, 2p, 5:30p. Homewood night shift is every two hours. 30-minute grace period.
- Rounds location/activity vocabulary confirmed and includes OOF reasons.
- Family Portal is one-way from Haven to family; no family replies.
- Maintenance/compliance: annual inspections, menus, permits, 6 fire drills/year, 2 elopement drills/year; Terell owns maintenance task catalog follow-up.
- Dietary: breakfast/lunch/dinner ate/refused/out-of-facility; snack reminder must capture who passed snack and time; snack contents deferred.
- Employees: application, background check, references, date of hire, pre-service orientation, 30-day items, in-service confirmation, med-tech attestation, non-compliance alerts.
- Role presets: Administrator, Assistant, Cook, Medication Technician, Resident Aide, Housekeeping Aide, plus universal-worker support.
- Forms inventory: all five facilities require 1823; Plantation also requires service plan and community support plan.
- QuickBooks preferred path: QB Online API integration, pending Milton migration sign-off.

## Still open

1. Plantation rounds cadence.
2. Donna's DocuSign arbitration confirmation.
3. Encrypted email provider name.
4. Homewood document dump.
5. Milton QB Desktop to QB Online migration sign-off.
6. Terell maintenance task catalog intake.
7. Rising Oaks office pre-sheet-rock site visit.
8. Per-Medicaid-provider bed-hold billing rules.
9. Rounds vs Quickmar narrative-note duplication final UX decision.
10. Snack reminder cutoff time per facility.
