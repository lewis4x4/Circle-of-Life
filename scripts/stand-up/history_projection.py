"""Read-only, review-only projection of versioned 2026 Stand Up source layouts.

This does not create an import payload or call Haven/Drive. It deliberately retains
undated templates, unsupported blocks and raw archive-only fields in the result.
The operational workbook parser and writer remain independent and unchanged.
"""
from __future__ import annotations

import argparse
from collections import Counter, defaultdict
from datetime import date
from decimal import Decimal
import hashlib
import json
import os
from pathlib import Path

import workbook as w

VERSION = "standup-history-projection-v1"
HOLD_OVERTIME_VERSION = "standup-history-projection-overtime-held-v1"
ARCHIVE_LABELS = {
    "uncollected ar total", "goal", "potential census", "percentage", "occupancy percentage",
}
REFERENCE_LABELS = {"average rent", "total beds open"}
SECTION_LABELS = w.HEADINGS - REFERENCE_LABELS | {
    "expected admissioins this week", "expected admission this week",
}
# Freeze label order and key meaning for this review version. A later operational
# mapping change must fail closed here until its historical meaning is reviewed.
CORE_LABELS = (
    "current ar", "current total census", "sp female beds open", "sp male beds open",
    "sp male or female beds open", "private beds open", "admissions expected",
    "total at the hospital & rehab", "expected discharges", "call outs last week",
    "terminations last week", "current open positions", "overtime", "tours expected",
    "activities on the calendar to be completed by home health providers",
    "outreach & engagements (providers, facilities, events)",
)
CORE_KEYS = (
    "monthly_rent_roll_cents", "current_total_census", "sp_female_beds_open", "sp_male_beds_open",
    "sp_flexible_beds_open", "private_beds_open", "admissions_expected", "hospital_and_rehab_total",
    "expected_discharges", "callouts_last_week", "terminations_last_week", "current_open_positions",
    "overtime_reported", "tours_expected", "provider_activities_expected", "outreach_engagements",
)
LAYOUTS = {
    CORE_LABELS: "standup-2026-core-v1",
    CORE_LABELS[:2] + ("uncollected ar total",) + CORE_LABELS[2:]: "standup-2026-uncollected-ar-v1",
    ("goal",) + CORE_LABELS: "standup-2026-goal-v1",
    ("goal",) + CORE_LABELS[:2] + ("potential census", "percentage") + CORE_LABELS[2:]: "standup-2026-capacity-percentage-v1",
    ("goal",) + CORE_LABELS[:2] + ("potential census", "occupancy percentage") + CORE_LABELS[2:]: "standup-2026-capacity-occupancy-percentage-v1",
}
MAX_BLOCKS = 200


def populated(cell):
    return bool(cell and (cell["formula"] or cell["error"] or (
        cell["value"] is not None and str(cell["value"]).strip() != "")))


def source_cell(cell, address):
    """Exact decimal text and type; formulas are retained as untrusted cached values."""
    cell = cell or {"value": None, "formula": False, "error": False}
    value = cell["value"]
    kind = "decimal" if isinstance(value, Decimal) else "date" if isinstance(value, date) else type(value).__name__
    return {"cell": address, "value": str(value) if isinstance(value, (Decimal, date)) else value,
            "value_type": kind, "formula": cell["formula"], "error": cell["error"]}


def project_history(raw, facility_map, file_id, filename, through_week, *, hold_overtime=False):
    """Return candidate/held records and all other block dispositions for human review.

    A new block begins at every first-column parsed date OR one row above any
    recognized facility header, including undated/malformed headers. Nothing below
    an undated header is ever attached to the preceding dated block. A date must
    immediately precede all five unique headers; dates are never inferred or moved.
    """
    if set(facility_map) != set(w.FACILITIES) or len(set(facility_map.values())) != 5:
        raise w.WorkbookError("Exact reviewed mappings for all five facilities required")
    if tuple(w.LABELS.items()) != tuple(zip(CORE_LABELS, CORE_KEYS)) or tuple(w.KEYS) != CORE_KEYS:
        raise w.WorkbookError("Operational mapping changed; review the historical projection version")
    if not all(isinstance(value, str) and value.strip() for value in facility_map.values()):
        raise w.WorkbookError("Facility identifiers must be nonempty strings")
    if not file_id or not filename:
        raise w.WorkbookError("Source identity required")
    if not isinstance(through_week, date) or through_week.weekday() != 0:
        raise w.WorkbookError("Explicit Monday review cutoff required")
    digest = hashlib.sha256(raw).hexdigest()
    projection_version = HOLD_OVERTIME_VERSION if hold_overtime else VERSION
    records, blocks, sheets_held = [], [], []
    identities = defaultdict(list)
    for sheet in w.read_sheets(raw):
        cells = sheet["cells"]
        dates = {row for (row, col), cell in cells.items() if col == 1 and w.parsed_day(cell["value"])}
        headers = {row for (row, _), cell in cells.items() if cell["value"] in w.FACILITIES}
        starts = sorted(dates | {row - 1 for row in headers if row > 1})
        if len(starts) > MAX_BLOCKS:
            raise w.WorkbookError("Too many history blocks in one worksheet")
        if not starts or any(row == 1 for row in headers):
            sheets_held.append({"sheet": sheet["name"], "code": "unmapped_sheet_or_header", "source_sha256": digest})
            continue
        max_row = max((row for row, _ in cells), default=1)
        for index, start in enumerate(starts):
            end = starts[index + 1] - 1 if index + 1 < len(starts) else max_row
            date_cell = cells.get((start, 1))
            day = w.parsed_day(date_cell["value"]) if date_cell else None
            facility_headers = [(col, cell) for (row, col), cell in cells.items() if row == start + 1 and cell["value"] in w.FACILITIES]
            names = [cell["value"] for _, cell in facility_headers]
            block_id = f"{sheet['name']}!A{start}:G{end}"
            block = {"block": block_id, "date": source_cell(date_cell, f"A{start}"), "records": []}
            blocks.append(block)
            if (len(names) != 5 or set(names) != set(w.FACILITIES)
                    or {col for col, _ in facility_headers} != set(range(2, 7))
                    or any(cell["formula"] or cell["error"] for _, cell in facility_headers)):
                block["issues"] = [{"code": "facility_headers", "message": "Five literal unique facility headers in B:F required immediately after date row"}]
                block["status"] = "held"
                block["source_cells"] = [source_cell(cell, w._address(col, row)) for (row, col), cell in cells.items()
                                         if start <= row <= end and populated(cell)]
                continue
            rows = sorted({row for row, _ in cells if start + 1 < row <= end})
            labels = [(row, w.normalized(cells.get((row, 1), {}).get("value"))) for row in rows]
            signature = tuple(label for _, label in labels if label and label not in SECTION_LABELS | REFERENCE_LABELS)
            layout = LAYOUTS.get(signature)
            for col, header in facility_headers:
                issues = []
                values = dict.fromkeys(w.KEYS)
                core_sources, archived, references, unknown = {}, [], [], []
                core_populated = False
                projectable_populated = False
                if not layout:
                    issues.append({"code": "unsupported_layout", "message": "Input label order/multiplicity does not match a reviewed version"})
                for row, label in labels:
                    label_cell = cells.get((row, 1))
                    if label_cell and (label_cell["formula"] or label_cell["error"]):
                        issues.append({"code": "computed_label", "cell": f"A{row}"})
                    cell = cells.get((row, col))
                    entry = {"label": label, **source_cell(cell, w._address(col, row))}
                    if label in ARCHIVE_LABELS:
                        archived.append(entry)
                    elif label in REFERENCE_LABELS:
                        references.append(entry)
                    elif label in w.LABELS:
                        key = w.LABELS[label]
                        core_sources.setdefault(key, []).append(entry)
                        core_populated |= populated(cell)
                        if not (hold_overtime and key == "overtime_reported"):
                            projectable_populated |= populated(cell)
                        if len(core_sources[key]) > 1:
                            issues.append({"code": "duplicate_core_label", "key": key, "cell": entry["cell"]})
                            continue
                        if hold_overtime and key == "overtime_reported":
                            # Every historical duration is deliberately excluded,
                            # regardless of apparent numeric validity or formula.
                            continue
                        try:
                            if cell and (cell["formula"] or cell["error"]):
                                raise w.WorkbookError("Input contains formula/error; cached results are not accepted")
                            values[key] = w.cell_number(cell, key)
                        except w.WorkbookError as exc:
                            issues.append({"code": "invalid_input", "key": key, "cell": entry["cell"], "message": str(exc)})
                    elif populated(cell):
                        # Even values under blank/section labels are not thrown away.
                        unknown.append(entry)
                        issues.append({"code": "unmapped_value", "cell": entry["cell"], "label": label})
                missing = sorted(set(w.KEYS) - set(core_sources))
                if missing:
                    issues.append({"code": "missing_core_labels", "keys": missing})
                if hold_overtime and core_populated and not projectable_populated:
                    issues.append({"code": "no_projectable_core_values", "message": "Only withheld overtime has source content"})
                if day is None:
                    issues.append({"code": "undated_block", "message": "Date was not inferred from adjacent blocks or sheet name"})
                else:
                    if date_cell["formula"] or date_cell["error"]:
                        issues.append({"code": "computed_date", "message": "Literal reporting date required"})
                    if day.weekday() != 0:
                        issues.append({"code": "non_monday", "message": "Owner must resolve date; it was not shifted"})
                    if day > through_week:
                        issues.append({"code": "after_review_cutoff"})
                content = "core_populated" if core_populated or unknown else "archive_only" if any(populated(item) for item in archived) else "empty_core"
                status = "held" if content == "core_populated" and issues else "candidate" if content == "core_populated" else "archive_only" if content == "archive_only" else "empty_core"
                record = {
                    "facility_id": facility_map[header["value"]], "facility_name": header["value"],
                    "week_start": day.isoformat() if day else None, "status": status, "content": content,
                    "values": values, "source_inputs": core_sources, "archived_fields": archived,
                    "derived_source_references": references, "unmapped_fields": unknown, "issues": issues,
                    "provenance": {"file_id": file_id, "source_file_name": filename, "source_sha256": digest,
                                   "sheet": sheet["name"], "range": f"{w._address(col,start)}:{w._address(col,end)}",
                                   "schema_version": f"{layout}-overtime-held-v1" if hold_overtime and layout else layout or "unmapped",
                                   "source_layout_version": layout or "unmapped", "projection_version": projection_version},
                }
                if hold_overtime:
                    record["held_fields"] = [{"key": "overtime_reported", "reason": "historical_unit_unconfirmed",
                                              "source_cells": core_sources.get("overtime_reported", [])}]
                    record["provenance"]["field_dispositions"] = {"overtime_reported": "historical_unit_unconfirmed"}
                records.append(record)
                block["records"].append(len(records) - 1)
                if day:
                    identities[(record["facility_id"], record["week_start"])].append(record)
    for same_week in identities.values():
        if len(same_week) > 1:
            for record in same_week:
                record["issues"].append({"code": "overlapping_week", "message": "All copies held; no authoritative copy was chosen"})
                record["status"] = "held"
    candidates = [record for record in records if record["status"] == "candidate"]
    return {
        "projection_version": projection_version, "review_only": True, "through_week": through_week.isoformat(),
        "source_sha256": digest, "source_file_id": file_id, "records": records,
        "blocks": blocks, "sheets_held": sheets_held,
        "summary": {"records": len(records), "statuses": dict(Counter(record["status"] for record in records)),
                    "candidate_weeks": len({record["week_start"] for record in candidates}),
                    "candidate_layouts": dict(Counter(record["provenance"]["schema_version"] for record in candidates)),
                    "held_issues": dict(Counter(issue["code"] for record in records if record["status"] == "held" for issue in record["issues"])),
                    "undated_records": sum(record["week_start"] is None for record in records)},
    }


def main():
    parser = argparse.ArgumentParser(description="Create a private review projection. Never imports or changes the workbook.")
    parser.add_argument("workbook")
    parser.add_argument("--facility-map", required=True)
    parser.add_argument("--file-id", required=True)
    parser.add_argument("--through-week", required=True, type=date.fromisoformat)
    parser.add_argument("--hold-overtime", action="store_true", help="Project 15 other metrics; archive every raw overtime cell without interpreting it")
    parser.add_argument("--output", required=True)
    args = parser.parse_args()
    result = project_history(Path(args.workbook).read_bytes(), json.loads(Path(args.facility_map).read_text()),
                             args.file_id, Path(args.workbook).name, args.through_week, hold_overtime=args.hold_overtime)
    # Exclusive creation, private permissions; no overwritten files or import keys.
    fd = os.open(args.output, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, "w") as handle:
        json.dump(result, handle, indent=2)
        handle.write("\n")
    print(json.dumps(result["summary"]))


if __name__ == "__main__":
    main()
