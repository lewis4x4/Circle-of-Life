import copy
from datetime import date
from decimal import Decimal
import hashlib
import unittest
from unittest.mock import patch

import history_projection as h
import workbook as w


FACILITY_MAP = dict(zip(w.FACILITIES, ("facility-1", "facility-2", "facility-3", "facility-4", "facility-5")))


def cell(value, row, col, formula=False, error=False):
    return {"value": value, "formula": formula, "error": error, "address": w._address(col, row)}


def block(cells, start=1, day=date(2026, 1, 5), labels=h.CORE_LABELS, filled=True):
    if day is not None:
        cells[(start, 1)] = cell(day, start, 1)
    for col, name in enumerate(w.FACILITIES, 2):
        cells[(start + 1, col)] = cell(name, start + 1, col)
    for row, label in enumerate(labels, start + 2):
        cells[(row, 1)] = cell(label, row, 1)
        for col in range(2, 7):
            value = Decimal("17.15") if label == "overtime" else Decimal("1")
            if not filled and label in w.LABELS:
                value = None
            cells[(row, col)] = cell(value, row, col)
    return cells


def project(cells, more_sheets=(), **options):
    sheets = [{"name": "January", "path": "xl/worksheets/sheet1.xml", "cells": cells}, *more_sheets]
    with patch.object(w, "read_sheets", return_value=sheets):
        return h.project_history(b"synthetic source", FACILITY_MAP, "file-1", "source.xlsx", date(2026, 9, 7), **options)


class HistoryProjectionTests(unittest.TestCase):
    def test_hold_overtime_never_interprets_valid_invalid_or_formula_values(self):
        for raw, formula, error in ((Decimal("17.15"), False, False), (Decimal("15.65"), False, False),
                                    ("unknown", False, False), (None, False, False),
                                    ("#VALUE!", True, True), (True, False, False)):
            with self.subTest(raw=raw):
                cells = block({})
                row = 3 + h.CORE_LABELS.index("overtime")
                cells[(row, 2)] = cell(raw, row, 2, formula=formula, error=error)
                with patch.object(w, "overtime_minutes", side_effect=AssertionError("Overtime must not be interpreted")):
                    result = project(cells, hold_overtime=True)
                self.assertEqual(result["summary"]["statuses"], {"candidate": 5})
                self.assertEqual(result["projection_version"], h.HOLD_OVERTIME_VERSION)
                record = result["records"][0]
                self.assertIsNone(record["values"]["overtime_reported"])
                self.assertEqual(record["values"]["monthly_rent_roll_cents"], 100)
                self.assertEqual(record["provenance"]["schema_version"], "standup-2026-core-v1-overtime-held-v1")
                self.assertEqual(record["provenance"]["source_layout_version"], "standup-2026-core-v1")
                self.assertEqual(record["provenance"]["field_dispositions"], {"overtime_reported": "historical_unit_unconfirmed"})
                held = record["held_fields"][0]
                self.assertEqual(held["key"], "overtime_reported")
                self.assertEqual(held["reason"], "historical_unit_unconfirmed")
                self.assertEqual(held["source_cells"], record["source_inputs"]["overtime_reported"])
                self.assertEqual(held["source_cells"][0]["cell"], w._address(2, row))
                self.assertEqual(held["source_cells"][0]["value"], str(raw) if isinstance(raw, Decimal) else raw)
                self.assertNotIn("rows", result)

    def test_hold_overtime_does_not_relax_dates_other_inputs_or_layout(self):
        examples = [block({}, day=date(2026, 5, 26)), block({}, day=None),
                    block({}, labels=h.CORE_LABELS + ("overtime",)),
                    block({}, labels=tuple(label for label in h.CORE_LABELS if label != "overtime"))]
        cells = block({})
        cells[(4, 2)]["value"] = Decimal("1.25")
        examples.append(cells)
        for cells in examples:
            with self.subTest(cells=cells):
                result = project(cells, hold_overtime=True)
                self.assertEqual(result["records"][0]["status"], "held")

    def test_hold_overtime_retains_every_duplicate_raw_cell_and_holds_record(self):
        cells = block({}, labels=h.CORE_LABELS + ("overtime",))
        row = 3 + len(h.CORE_LABELS)
        cells[(row, 2)]["value"] = Decimal("98.76")
        record = project(cells, hold_overtime=True)["records"][0]
        self.assertEqual(record["status"], "held")
        self.assertEqual([source["value"] for source in record["held_fields"][0]["source_cells"]], ["17.15", "98.76"])

    def test_hold_overtime_only_content_never_manufactures_empty_report(self):
        cells = block({}, filled=False)
        row = 3 + h.CORE_LABELS.index("overtime")
        cells[(row, 2)]["value"] = Decimal("17.15")
        record = project(cells, hold_overtime=True)["records"][0]
        self.assertEqual(record["status"], "held")
        self.assertTrue(all(value is None for value in record["values"].values()))
        self.assertTrue(any(issue["code"] == "no_projectable_core_values" for issue in record["issues"]))

    def test_hold_overtime_keeps_goal_and_receivables_separate(self):
        for labels in (h.CORE_LABELS[:2] + ("uncollected ar total",) + h.CORE_LABELS[2:], ("goal",) + h.CORE_LABELS):
            record = project(block({}, labels=labels), hold_overtime=True)["records"][0]
            self.assertEqual(len(record["archived_fields"]), 1)
            self.assertEqual(record["values"]["monthly_rent_roll_cents"], 100)
            self.assertIsNone(record["values"]["overtime_reported"])

    def test_operational_mapping_change_requires_new_historical_review(self):
        with patch.object(w, "LABELS", {**w.LABELS, "new source label": "current_total_census"}):
            with self.assertRaisesRegex(w.WorkbookError, "mapping changed"):
                project(block({}))

    def test_versions_project_all_16_core_metrics_and_keep_archive_only_fields(self):
        for labels, version in h.LAYOUTS.items():
            with self.subTest(version=version):
                cells = block({}, labels=labels)
                before = copy.deepcopy(cells)
                result = project(cells)
                self.assertEqual(cells, before)
                self.assertEqual(result["summary"]["statuses"], {"candidate": 5})
                record = result["records"][0]
                self.assertEqual(set(record["values"]), set(w.KEYS))
                self.assertEqual(record["values"]["monthly_rent_roll_cents"], 100)
                self.assertEqual(record["values"]["overtime_reported"], 17.15)
                self.assertEqual(record["provenance"]["schema_version"], version)
                self.assertEqual(record["provenance"]["source_sha256"], hashlib.sha256(b"synthetic source").hexdigest())
                self.assertEqual([field["label"] for field in record["archived_fields"]], [label for label in labels if label in h.ARCHIVE_LABELS])
                self.assertNotIn("rows", result)
                self.assertTrue(result["review_only"])

    def test_uncollected_ar_preserved_separately_never_replaces_rentroll(self):
        labels = h.CORE_LABELS[:2] + ("uncollected ar total",) + h.CORE_LABELS[2:]
        cells = block({}, labels=labels)
        row = 3 + labels.index("uncollected ar total")
        cells[(row, 2)]["value"] = Decimal("9000.19")
        record = project(cells)["records"][0]
        self.assertEqual(record["values"]["monthly_rent_roll_cents"], 100)
        self.assertEqual(record["archived_fields"][0]["value"], "9000.19")
        self.assertEqual(record["archived_fields"][0]["cell"], w._address(2, row))

    def test_undated_templates_are_separate_even_when_goal_is_populated(self):
        cells = block({})
        block(cells, start=100, day=None, labels=("goal",) + h.CORE_LABELS, filled=False)
        result = project(cells)
        self.assertEqual(result["summary"]["statuses"], {"candidate": 5, "archive_only": 5})
        self.assertEqual(result["records"][0]["provenance"]["range"], "B1:B99")
        self.assertIsNone(result["records"][5]["week_start"])
        self.assertEqual(result["records"][5]["archived_fields"][0]["value"], "1")

    def test_undated_populated_source_never_gets_previous_week(self):
        cells = block({})
        block(cells, start=30, day=None)
        result = project(cells)
        self.assertEqual(result["summary"]["statuses"], {"candidate": 5, "held": 5})
        self.assertTrue(all(record["week_start"] is None for record in result["records"][5:]))

    def test_duplicate_populated_or_blank_label_is_held_not_last_wins(self):
        cells = block({}, labels=h.CORE_LABELS + ("outreach & engagements (providers, facilities, events)",))
        cells[(19, 2)]["value"] = None
        result = project(cells)
        self.assertEqual(result["summary"]["statuses"], {"held": 5})
        self.assertEqual(len(result["records"][0]["source_inputs"]["outreach_engagements"]), 2)

    def test_missing_label_is_held_instead_of_filling_zero(self):
        cells = block({}, labels=tuple(label for label in h.CORE_LABELS if label != "sp male beds open"))
        result = project(cells)
        self.assertEqual(result["summary"]["statuses"], {"held": 5})
        self.assertIsNone(result["records"][0]["values"]["sp_male_beds_open"])

    def test_invalid_minutes_are_held_with_raw_input(self):
        cells = block({})
        row = 3 + h.CORE_LABELS.index("overtime")
        cells[(row, 2)]["value"] = Decimal("15.65")
        result = project(cells)
        self.assertEqual(result["summary"]["statuses"], {"held": 1, "candidate": 4})
        record = result["records"][0]
        self.assertEqual(record["source_inputs"]["overtime_reported"][0]["value"], "15.65")
        self.assertIsNone(record["values"]["overtime_reported"])

    def test_date_is_never_corrected_or_inferred_and_future_is_held(self):
        for value in (date(2026, 5, 26), date(2026, 6, 3), date(2026, 9, 21), "January 5", None):
            with self.subTest(value=value):
                result = project(block({}, day=value))
                self.assertEqual(result["summary"]["statuses"], {"held": 5})
                self.assertEqual(result["records"][0]["week_start"], value.isoformat() if isinstance(value, date) else None)

    def test_duplicate_weeks_hold_both_copies_including_empty(self):
        cells = block({})
        block(cells, start=30, filled=False)
        result = project(cells)
        self.assertEqual(result["summary"]["statuses"], {"held": 10})
        self.assertTrue(all(any(issue["code"] == "overlapping_week" for issue in record["issues"]) for record in result["records"]))

    def test_dates_without_header_are_not_absorbed_into_previous_block(self):
        cells = block({})
        cells[(30, 1)] = cell(date(2026, 1, 12), 30, 1)
        result = project(cells)
        self.assertEqual(result["records"][0]["provenance"]["range"], "B1:B29")
        self.assertEqual(result["blocks"][1]["status"], "held")
        self.assertEqual(result["blocks"][1]["source_cells"][0]["cell"], "A30")

    def test_literal_headers_and_labels_required(self):
        cells = block({})
        cells[(2, 2)]["formula"] = True
        result = project(cells)
        self.assertEqual(result["blocks"][0]["status"], "held")
        self.assertEqual(result["records"], [])
        cells = block({})
        cells[(3, 1)]["formula"] = True
        self.assertTrue(all(record["status"] == "held" for record in project(cells)["records"]))

    def test_derived_formula_caches_are_archived_not_used_as_inputs(self):
        labels = h.CORE_LABELS[:2] + ("average rent",) + h.CORE_LABELS[2:]
        cells = block({}, labels=labels)
        cells[(5, 2)] = cell("#DIV/0!", 5, 2, formula=True, error=True)
        record = project(cells)["records"][0]
        self.assertEqual(record["status"], "candidate")
        self.assertEqual(record["derived_source_references"][0]["value"], "#DIV/0!")
        self.assertNotIn("average_rent", record["values"])

    def test_unknown_populated_blank_row_is_held(self):
        cells = block({})
        cells[(24, 2)] = cell(Decimal("2"), 24, 2)
        result = project(cells)
        self.assertEqual(result["records"][0]["status"], "held")
        self.assertEqual(result["records"][0]["unmapped_fields"][0]["cell"], "B24")

    def test_formula_numeric_bool_and_fractional_counts_are_held(self):
        for value, formula in ((Decimal("4"), True), (None, True), (True, False), (Decimal("1.25"), False)):
            with self.subTest(value=value, formula=formula):
                cells = block({})
                cells[(4, 2)] = cell(value, 4, 2, formula=formula)
                self.assertEqual(project(cells)["records"][0]["status"], "held")

    def test_zero_and_missing_remain_distinct_and_templates_not_reports(self):
        cells = block({})
        cells[(5, 2)]["value"] = None
        cells[(6, 2)]["value"] = Decimal("0")
        record = project(cells)["records"][0]
        self.assertIsNone(record["values"]["sp_female_beds_open"])
        self.assertEqual(record["values"]["sp_male_beds_open"], 0)
        self.assertEqual(project(block({}, filled=False))["summary"]["statuses"], {"empty_core": 5})


if __name__ == "__main__":
    unittest.main()
